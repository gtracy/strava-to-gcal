#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfrastructureStack } from '../lib/infrastructure-stack';

import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

// Attempt to load account/region from env.json if not in environment
const envPath = path.join(__dirname, '../../env.json');
let manualEnv: cdk.Environment | undefined;

if (fs.existsSync(envPath)) {
  const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  const variables = envConfig.StravaSyncFunction || Object.values(envConfig)[0];

  if (variables && typeof variables === 'object') {
    const region = variables.AWS_REGION;
    let account = '';

    // Attempt to extract account ID from SQS URL if available
    const queueUrl = variables.SYNC_QUEUE_URL || variables.FETCH_QUEUE_URL;
    if (queueUrl && typeof queueUrl === 'string') {
      const match = queueUrl.match(/amazonaws\.com\/(\d+)\//);
      if (match) account = match[1];
    }

    if (region || account) {
      manualEnv = {
        account: account || process.env.CDK_DEFAULT_ACCOUNT,
        region: region || process.env.CDK_DEFAULT_REGION
      };
      console.log(`Using environment from env.json: ${manualEnv.account}/${manualEnv.region}`);
    }
  }
}

new InfrastructureStack(app, 'InfrastructureStack', {
  env: manualEnv || {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
});
