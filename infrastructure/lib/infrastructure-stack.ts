import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

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

    // 2. Lambda Function
    const stravaSyncLambda = new NodejsFunction(this, 'StravaSyncFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/app.js'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        LOG_LEVEL: 'info',
        // These will be injected at deploy time or via AWS Secrets Manager in a real setup
        // But for parity with the template.yaml, we'll leave placeholders or expect them in the environment
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
        STRAVA_VERIFY_TOKEN: process.env.STRAVA_VERIFY_TOKEN || 'strava-verify-token-fallback',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
        JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-for-cdk-synth'
      },
    });

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

    // 4. Frontend S3 Bucket
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS, // Modern S3 requires this to allow public read via policy
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true, // For dev convenience
    });

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
