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

test('AppError metric filters and alarms are configured per function', () => {
  const app = new cdk.App();
  const stack = new Infrastructure.InfrastructureStack(app, 'MyTestStackMetrics', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  const template = Template.fromStack(stack);

  const expectedMetrics = [
    'ApiHandler-AppErrors',
    'ActivityFetchWorker-AppErrors',
    'ActivitySyncWorker-AppErrors',
  ];

  // Assert all 3 MetricFilters exist with their per-function metric names
  const metricFilters = template.findResources('AWS::Logs::MetricFilter');
  const appErrorFilters = Object.values(metricFilters).filter(
    (mf) => expectedMetrics.includes(mf.Properties.MetricTransformations?.[0]?.MetricName)
  );
  expect(appErrorFilters).toHaveLength(3);

  for (const filter of appErrorFilters) {
    // Ensure no dimensions are set on the MetricTransformation (AWS requires valid log selectors)
    expect(filter.Properties.MetricTransformations[0].Dimensions).toBeUndefined();
    expect(filter.Properties.MetricTransformations[0].MetricNamespace).toBe('StravaGcal/Application');
    expect(filter.Properties.MetricTransformations[0].MetricValue).toBe('1');
  }

  // Assert all 3 Alarms exist for each function's AppError metric
  const alarms = template.findResources('AWS::CloudWatch::Alarm');
  const appErrorAlarms = Object.values(alarms).filter(
    (alarm) => expectedMetrics.includes(alarm.Properties.MetricName)
  );
  expect(appErrorAlarms).toHaveLength(3);

  const alarmNames = appErrorAlarms.map((a) => a.Properties.AlarmName);
  expect(alarmNames).toContain('StravaGcal-AppError-ApiHandler-Alarm');
  expect(alarmNames).toContain('StravaGcal-AppError-ActivityFetchWorker-Alarm');
  expect(alarmNames).toContain('StravaGcal-AppError-ActivitySyncWorker-Alarm');
});
