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

test('AppError metric filters and alarms are configured with FunctionName dimension', () => {
  const app = new cdk.App();
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStackMetrics', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  const template = Template.fromStack(stack);

  // Assert all 3 MetricFilters exist with FunctionName dimension
  const metricFilters = template.findResources('AWS::Logs::MetricFilter');
  const appErrorFilters = Object.values(metricFilters).filter(
    (mf) => mf.Properties.MetricTransformations?.[0]?.MetricName === 'AppErrors'
  );
  expect(appErrorFilters).toHaveLength(3);
  for (const filter of appErrorFilters) {
    expect(filter.Properties.MetricTransformations[0].Dimensions).toEqual([
      {
        Key: 'FunctionName',
        Value: expect.any(Object),
      },
    ]);
  }

  // Assert all 3 Alarms exist for AppErrors with FunctionName dimension
  const alarms = template.findResources('AWS::CloudWatch::Alarm');
  const appErrorAlarms = Object.values(alarms).filter(
    (alarm) => alarm.Properties.MetricName === 'AppErrors'
  );
  expect(appErrorAlarms).toHaveLength(3);
  for (const alarm of appErrorAlarms) {
    expect(alarm.Properties.Dimensions).toEqual([
      {
        Name: 'FunctionName',
        Value: expect.any(Object),
      },
    ]);
  }
});
