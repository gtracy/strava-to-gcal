import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import * as Infrastructure from '../lib/infrastructure-stack';

test('Lambda log groups are configured with 90-day retention', () => {
  const app = new cdk.App();
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStack', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  const template = Template.fromStack(stack);

  // Assert that 3 LogGroups have 90 days retention (Three Months)
  template.resourcePropertiesCountIs('AWS::Logs::LogGroup', {
    RetentionInDays: 90,
  }, 3);
});

test('AlertsTopic has an email subscription configured', () => {
  const app = new cdk.App();
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStackAlerts', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SNS::Subscription', {
    Protocol: 'email',
    Endpoint: 'gtracy+stravagcal@gmail.com',
  });
});
