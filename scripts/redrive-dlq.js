const { SQSClient, StartMessageMoveTaskCommand, GetQueueUrlCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const readline = require('readline');

// The SDK uses standard AWS environment variables for authentication/region.
const sqsClient = new SQSClient({});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const getQueueArn = async (queueName) => {
    try {
        const { QueueUrl } = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));
        const { Attributes } = await sqsClient.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
        return Attributes.QueueArn;
    } catch (e) {
        throw new Error(`Failed to get ARN for queue ${queueName}: ${e.message}`);
    }
};

const redrive = async () => {
    console.log('Select the DLQ to redrive:');
    console.log('1. ActivityFetchDLQ (StravaGcal-ActivityFetchDLQ)');
    console.log('2. ActivitySyncDLQ (StravaGcal-ActivitySyncDLQ)');
    console.log('3. Cancel');

    rl.question('Enter choice (1-3): ', async (choice) => {
        let queueName;
        if (choice === '1') {
            queueName = 'StravaGcal-ActivityFetchDLQ';
        } else if (choice === '2') {
            queueName = 'StravaGcal-ActivitySyncDLQ';
        } else {
            console.log('Cancelled.');
            rl.close();
            return;
        }

        try {
            console.log(`\nResolving Queue ARN for ${queueName}...`);
            const sourceArn = await getQueueArn(queueName);

            console.log(`Starting redrive task for ${sourceArn}...`);

            // StartMessageMoveTask drives messages from the source DLQ back to their original queue
            const command = new StartMessageMoveTaskCommand({
                SourceArn: sourceArn
            });
            const response = await sqsClient.send(command);
            console.log('✅ Task started successfully!');
            console.log('TaskHandle:', response.TaskHandle);
            console.log('\nThe messages are now being processed asynchronously back into the main queue.');
        } catch (error) {
            console.error('\n❌ Failed to start redrive task:', error.message);
        }

        rl.close();
    });
};

redrive();
