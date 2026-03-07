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
import * as path from 'path';
import * as fs from 'fs';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

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

    // 2. Lambda Function
    const stravaSyncLambda = new NodejsFunction(this, 'StravaSyncFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/app.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
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
    const httpApi = new apigwv2.HttpApi(this, 'StravaSyncApi', {
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          'PATCH' as apigwv2.CorsHttpMethod,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
      },
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
      methods: ['PATCH' as apigwv2.HttpMethod],
      integration: lambdaIntegration,
    });

    // 4. Activity Fetch Queue and Worker
    const activityFetchQueue = new sqs.Queue(this, 'ActivityFetchQueue', {
      visibilityTimeout: cdk.Duration.seconds(300) // 5 minutes, give it time to fetch all pages
    });

    const activityFetchWorker = new NodejsFunction(this, 'ActivityFetchWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/workers/fetch-worker.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
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
      visibilityTimeout: cdk.Duration.seconds(60)
    });

    const activitySyncWorker = new NodejsFunction(this, 'ActivitySyncWorker', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../src/workers/sync-worker.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_MONTHS,
      environment: {
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
    activityFetchQueue.grantSendMessages(stravaSyncLambda);
    stravaSyncLambda.addEnvironment('FETCH_QUEUE_URL', activityFetchQueue.queueUrl);

    // 7. Frontend S3 Bucket
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: false,
        ignorePublicAcls: true,
        restrictPublicBuckets: false
      }),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // For dev convenience
    });

    // 8. Deploy Frontend Assets and Dynamic Config
    const deployment = new s3deploy.BucketDeployment(this, 'DeployFrontendWithConfig', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
        s3deploy.Source.jsonData('config.json', {
          VITE_API_URL: httpApi.apiEndpoint,
          VITE_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
          VITE_STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || ''
        })
      ],
      destinationBucket: frontendBucket,
      prune: false,
    });

    // Ensure the API exists before we try to extract its endpoint
    deployment.node.addDependency(httpApi);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: frontendBucket.bucketWebsiteUrl,
      description: 'URL for the frontend SPA',
    });
  }
}
