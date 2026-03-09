import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';

import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as path from 'path';
import * as fs from 'fs';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
// Attempt to load env.json securely at synth time
const envPath = path.join(__dirname, '../../env.json');
if (fs.existsSync(envPath)) {
  const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  let variables = envConfig;
  if (envConfig.StravaSyncFunction) {
    variables = envConfig.StravaSyncFunction;
  } else {
    const firstValue = Object.values(envConfig)[0];
    if (typeof firstValue === 'object' && firstValue !== null) {
      variables = firstValue as Record<string, string>;
    }
  }
  Object.assign(process.env, variables);
  console.log("Loaded environment variables from env.json for CDK synth.");
}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. DynamoDB Table
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'StravaGcal-Users',
      partitionKey: { name: 'googleUserId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test. Change to RETAIN for prod.
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: 'StravaAthleteIndex',
      partitionKey: { name: 'stravaAthleteId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 1.5 Security: KMS for encrypting user tokens in DynamoDB
    const kmsKey = new kms.Key(this, 'TokenKey', {
      alias: 'alias/StravaToGcalTokens',
      description: 'Key for encrypting user tokens in DynamoDB',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev
    });

    // 1.8 Custom Domain: Route 53 DNS (Phase 1)
    const domainName = 'clockingsweat.com';
    const hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: domainName,
      comment: 'Hosted zone for Strava to GCal Sync App',
    });

    // 2. Lambda Function
    const stravaSyncLambda = new NodejsFunction(this, 'StravaSyncFunction', {
      functionName: 'StravaGcal-ApiHandler',
      description: 'API Gateway handler for authentication, user management, and Strava webhooks',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/app.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
        NODE_OPTIONS: '--no-deprecation',
        USERS_TABLE_NAME: usersTable.tableName,
        LOG_LEVEL: 'info',
        KMS_KEY_ID: kmsKey.keyId,
        STRAVA_VERIFY_TOKEN: process.env.STRAVA_VERIFY_TOKEN || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
      },
    });

    // Permissions
    kmsKey.grantEncryptDecrypt(stravaSyncLambda);

    // Grant Lambda permissions to DynamoDB Table
    usersTable.grantReadWriteData(stravaSyncLambda);

    // 3. HTTP API (API Gateway V2)
    // 3.1 Backend ACM Certificate & Custom Domain
    const apiDomainName = `api.${domainName}`;
    const apiCert = new certificatemanager.Certificate(this, 'ApiCertificate', {
      domainName: apiDomainName,
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    const apiCustomDomain = new apigwv2.DomainName(this, 'ApiCustomDomain', {
      domainName: apiDomainName,
      certificate: apiCert,
    });

    const httpApi = new apigwv2.HttpApi(this, 'StravaSyncApi', {
      apiName: 'StravaGcal-Api',
      description: 'API Gateway for the Strava-to-GCal service',
      defaultDomainMapping: {
        domainName: apiCustomDomain,
      },
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          'PATCH' as apigwv2.CorsHttpMethod,
          'DELETE' as apigwv2.CorsHttpMethod,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
      },
    });

    // 3.2 DNS Record for API Gateway
    new route53.ARecord(this, 'ApiAliasRecord', {
      zone: hostedZone,
      recordName: 'api',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          apiCustomDomain.regionalDomainName,
          apiCustomDomain.regionalHostedZoneId
        )
      ),
    });

    const lambdaIntegration = new HttpLambdaIntegration('LambdaIntegration', stravaSyncLambda);

    // Add Routes
    httpApi.addRoutes({
      path: '/webhook',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/google',
      methods: [apigwv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/auth/strava',
      methods: [apigwv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/user/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/user/calendars',
      methods: [apigwv2.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: '/user',
      methods: ['PATCH' as apigwv2.HttpMethod, 'DELETE' as apigwv2.HttpMethod],
      integration: lambdaIntegration,
    });

    // 3.1 API Rate Limiting
    // Configure throttling on the auto-created $default stage
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
      };
      defaultStage.routeSettings = {
        'POST /auth/google': {
          ThrottlingBurstLimit: 10,
          ThrottlingRateLimit: 5,
        },
        'POST /auth/strava': {
          ThrottlingBurstLimit: 10,
          ThrottlingRateLimit: 5,
        },
        'POST /webhook': {
          ThrottlingBurstLimit: 100,
          ThrottlingRateLimit: 50,
        },
        'GET /webhook': {
          ThrottlingBurstLimit: 10,
          ThrottlingRateLimit: 5,
        },
      };
    }

    // --- APIGW METRICS ---
    const apigwMetrics = {
      count: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Count',
        dimensionsMap: { ApiId: httpApi.apiId },
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.minutes(1),
      }),
      error4xx: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4XXError',
        dimensionsMap: { ApiId: httpApi.apiId },
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.minutes(1),
      }),
      error5xx: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: { ApiId: httpApi.apiId },
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.minutes(1),
      })
    };

    // 3.5 Monitoring & Dead Letter Queues
    const alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: 'StravaGcal-AlertsTopic',
    });

    const activityFetchDLQ = new sqs.Queue(this, 'ActivityFetchDLQ', {
      queueName: 'StravaGcal-ActivityFetchDLQ',
      retentionPeriod: cdk.Duration.days(14),
    });

    const fetchAlarm = new cloudwatch.Alarm(this, 'ActivityFetchDLQAlarm', {
      alarmName: 'StravaGcal-ActivityFetch-DLQ-Alarm',
      metric: activityFetchDLQ.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    fetchAlarm.addAlarmAction(new cw_actions.SnsAction(alertsTopic));

    const activitySyncDLQ = new sqs.Queue(this, 'ActivitySyncDLQ', {
      queueName: 'StravaGcal-ActivitySyncDLQ',
      retentionPeriod: cdk.Duration.days(14),
    });

    const syncAlarm = new cloudwatch.Alarm(this, 'ActivitySyncDLQAlarm', {
      alarmName: 'StravaGcal-ActivitySync-DLQ-Alarm',
      metric: activitySyncDLQ.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    syncAlarm.addAlarmAction(new cw_actions.SnsAction(alertsTopic));

    // --- APP-LEVEL ERRORS METRIC FILTER ---
    const appErrorMetricName = 'AppErrors';
    const appErrorMetricNamespace = 'StravaGcal/Application';

    const appErrorMetric = new cloudwatch.Metric({
      namespace: appErrorMetricNamespace,
      metricName: appErrorMetricName,
      statistic: cloudwatch.Stats.SUM,
      period: cdk.Duration.minutes(5),
    });

    // We will attach the metric filter to the log groups of all three Lambdas later
    // once the workers are instantiated below.

    const appErrorAlarm = new cloudwatch.Alarm(this, 'AppErrorAlarm', {
      alarmName: 'StravaGcal-AppError-Alarm',
      metric: appErrorMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    appErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alertsTopic));

    // 4. Activity Fetch Queue and Worker
    const activityFetchQueue = new sqs.Queue(this, 'ActivityFetchQueue', {
      queueName: 'StravaGcal-ActivityFetchQueue',
      visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes, give it time to fetch all pages
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: activityFetchDLQ
      }
    });

    const activityFetchWorker = new NodejsFunction(this, 'ActivityFetchWorker', {
      functionName: 'StravaGcal-ActivityFetchWorker',
      description: 'Worker process that fetches historical and recent activities from Strava',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/workers/fetch-worker.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
        NODE_OPTIONS: '--no-deprecation',
        USERS_TABLE_NAME: usersTable.tableName,
        LOG_LEVEL: 'info',
        KMS_KEY_ID: kmsKey.keyId,
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
      }
    });

    kmsKey.grantEncryptDecrypt(activityFetchWorker);

    activityFetchWorker.addEventSource(new SqsEventSource(activityFetchQueue));

    // 5. Activity Sync Queue and Worker
    const activitySyncQueue = new sqs.Queue(this, 'ActivitySyncQueue', {
      queueName: 'StravaGcal-ActivitySyncQueue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: activitySyncDLQ
      }
    });

    const activitySyncWorker = new NodejsFunction(this, 'ActivitySyncWorker', {
      functionName: 'StravaGcal-ActivitySyncWorker',
      description: 'Worker process that synchronizes fetched Strava activities to Google Calendar',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/workers/sync-worker.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
        NODE_OPTIONS: '--no-deprecation',
        USERS_TABLE_NAME: usersTable.tableName,
        LOG_LEVEL: 'info',
        KMS_KEY_ID: kmsKey.keyId,
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
      }
    });

    kmsKey.grantEncryptDecrypt(activitySyncWorker);

    activitySyncWorker.addEventSource(new SqsEventSource(activitySyncQueue));

    // 6. Permissions and Routing

    // Fetch Worker needs to read users and push to Sync Queue
    usersTable.grantReadWriteData(activityFetchWorker);
    activitySyncQueue.grantSendMessages(activityFetchWorker);
    activityFetchWorker.addEnvironment('SYNC_QUEUE_URL', activitySyncQueue.queueUrl);

    // Sync Worker needs to read users
    usersTable.grantReadWriteData(activitySyncWorker);

    // Existing App/Webhook Router needs to push to Sync Queue & Fetch Queue
    activitySyncQueue.grantSendMessages(stravaSyncLambda);
    stravaSyncLambda.addEnvironment('SYNC_QUEUE_URL', activitySyncQueue.queueUrl);
    // Enable metric filters on Log Groups
    // We have to specify the default CDK log group names since we used logRetention on the functions
    const attachMetricFilter = (lambdaFn: NodejsFunction, id: string) => {
      new logs.MetricFilter(this, id, {
        logGroup: lambdaFn.logGroup,
        metricNamespace: appErrorMetricNamespace,
        metricName: appErrorMetricName,
        filterPattern: logs.FilterPattern.stringValue('$.level', '=', '50'),
        metricValue: '1',
      });
    };

    attachMetricFilter(stravaSyncLambda, 'ApiHandlerErrorFilter');
    attachMetricFilter(activityFetchWorker, 'FetchWorkerErrorFilter');
    attachMetricFilter(activitySyncWorker, 'SyncWorkerErrorFilter');

    // --- CLOUDWATCH DASHBOARD ---
    const dashboard = new cloudwatch.Dashboard(this, 'StravaGcalDashboard', {
      dashboardName: 'StravaGcal-Monitoring'
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway HTTP Requests',
        left: [apigwMetrics.count],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway HTTP Errors',
        left: [apigwMetrics.error4xx, apigwMetrics.error5xx],
        width: 12
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Application Errors (Pino Level 50)',
        left: [appErrorMetric],
        width: 12
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Dead Letter Queues (Failed Jobs)',
        metrics: [
          activityFetchDLQ.metricApproximateNumberOfMessagesVisible({ label: 'Fetch DLQ' }),
          activitySyncDLQ.metricApproximateNumberOfMessagesVisible({ label: 'Sync DLQ' })
        ],
        width: 12
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SQS Backlog (Messages Waiting)',
        left: [
          activityFetchQueue.metricApproximateNumberOfMessagesVisible({ label: 'Fetch Queue' }),
          activitySyncQueue.metricApproximateNumberOfMessagesVisible({ label: 'Sync Queue' })
        ],
        width: 24
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          stravaSyncLambda.metricInvocations({ label: 'API Handler' }),
          activityFetchWorker.metricInvocations({ label: 'Fetch Worker' }),
          activitySyncWorker.metricInvocations({ label: 'Sync Worker' })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          stravaSyncLambda.metricErrors({ label: 'API Handler' }),
          activityFetchWorker.metricErrors({ label: 'Fetch Worker' }),
          activitySyncWorker.metricErrors({ label: 'Sync Worker' })
        ],
        width: 12
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Throttled Requests (429s)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: { ApiId: httpApi.apiId },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(1),
            label: '4XX Errors (includes 429s)',
          }),
        ],
        width: 24
      })
    );

    // 7. Frontend S3 Bucket (Private, accessed only via CloudFront)
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // For dev convenience
    });

    // 8. CloudFront & CSP Security Headers
    const cspHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      comment: 'Security headers policy including strict CSP',
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups', override: true }
        ]
      },
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: `default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://*.googletagmanager.com; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://accounts.google.com/gsi/ https://*.amazonaws.com https://${apiDomainName} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; frame-src 'self' https://accounts.google.com/gsi/; img-src 'self' data: https://* https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com;`,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
          preload: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    // 8.1 Frontend ACM Certificate (Must be us-east-1 for CloudFront)
    const frontendCert = new certificatemanager.DnsValidatedCertificate(this, 'FrontendCertificate', {
      domainName: domainName,
      subjectAlternativeNames: [`www.${domainName}`],
      hostedZone,
      region: 'us-east-1', // CloudFront certificates MUST be provisioned in us-east-1
      cleanupRoute53Records: true, // cleans up validation records
    });

    const frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cspHeadersPolicy,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      certificate: frontendCert,
      domainNames: [domainName, `www.${domainName}`],
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        }
      ],
    });

    // 8.2 DNS Records for Frontend (Root and www)
    new route53.ARecord(this, 'FrontendAliasRecord', {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(frontendDistribution)),
    });

    new route53.ARecord(this, 'FrontendWwwAliasRecord', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(frontendDistribution)),
    });

    // 9. Deploy Frontend Assets and Dynamic Config
    const deployment = new s3deploy.BucketDeployment(this, 'DeployFrontendWithConfig', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
        s3deploy.Source.jsonData('config.json', {
          VITE_API_URL: `https://${apiDomainName}`,
          VITE_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
          VITE_STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || ''
        })
      ],
      destinationBucket: frontendBucket,
      distribution: frontendDistribution,
      distributionPaths: ['/*'],
      prune: false, // Prevents deleting files that shouldn't be deleted, consider making true later
    });

    // Ensure the API exists before we try to extract its endpoint
    deployment.node.addDependency(httpApi);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${frontendDistribution.distributionDomainName}`,
      description: 'CloudFront URL for the frontend SPA',
    });

    new cdk.CfnOutput(this, 'DomainNameServers', {
      value: cdk.Fn.join(', ', hostedZone.hostedZoneNameServers as string[]),
      description: 'Name servers for the Route 53 Hosted Zone (Copy these to Namecheap Custom DNS)',
    });
  }
}
