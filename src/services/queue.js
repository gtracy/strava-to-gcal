const { SQSClient, SendMessageCommand, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Initialize SQS Client
let clientOptions = {};
if (process.env.AWS_REGION) {
    clientOptions.region = process.env.AWS_REGION;
} else {
    clientOptions.region = 'us-east-1'; // fallback
}
const sqsClient = new SQSClient(clientOptions);

class QueueService {
    /**
     * Enqueue a request to fetch activities for a given user.
     * @param {string} userId - Strava athlete ID
     * @param {number} days - Number of days back to fetch
     */
    async enqueueActivityFetch(userId, days) {
        if (!process.env.FETCH_QUEUE_URL) {
            logger.warn('FETCH_QUEUE_URL not defined, printing message to log instead.');
            logger.info({ userId, days }, 'enqueueActivityFetch (mock)');
            return;
        }

        const params = {
            QueueUrl: process.env.FETCH_QUEUE_URL,
            MessageBody: JSON.stringify({ userId: userId.toString(), days })
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
            logger.info({ userId, days }, 'Enqueued to ActivityFetchQueue');
        } catch (error) {
            logger.error({ errMessage: error.message, userId }, 'Failed to enqueue to ActivityFetchQueue');
            throw error;
        }
    }

    /**
     * Enqueue a single activity for syncing to Google Calendar.
     * @param {string} userId - Strava athlete ID
     * @param {number|string} activityId - Strava activity ID
     * @param {string} aspectType - 'create', 'update', or 'delete'
     * @param {object} updates - The updates object from Strava webhook (optional)
     */
    async enqueueActivitySync(userId, activityId, aspectType, updates = {}) {
        if (!process.env.SYNC_QUEUE_URL) {
            logger.warn('SYNC_QUEUE_URL not defined, printing message to log instead.');
            logger.info({ userId, activityId, aspectType, updates }, 'enqueueActivitySync (mock)');
            return;
        }

        const params = {
            QueueUrl: process.env.SYNC_QUEUE_URL,
            MessageBody: JSON.stringify({ userId: userId.toString(), activityId: activityId.toString(), aspectType, updates })
        };

        try {
            const command = new SendMessageCommand(params);
            await sqsClient.send(command);
            logger.info({ userId, activityId, aspectType }, 'Enqueued to ActivitySyncQueue');
        } catch (error) {
            logger.error({ errMessage: error.message, userId, activityId }, 'Failed to enqueue to ActivitySyncQueue');
            throw error;
        }
    }

    /**
     * Batch enqueue a list of activities for syncing to Google Calendar.
     * @param {string} userId - Strava athlete ID
     * @param {Array<{activityId: string, aspectType: string}>} activities
     */
    async enqueueActivitySyncBatch(userId, activities) {
        if (!process.env.SYNC_QUEUE_URL) {
            logger.warn('SYNC_QUEUE_URL not defined, printing batch to log instead.');
            logger.info({ userId, activityCount: activities.length }, 'enqueueActivitySyncBatch (mock)');
            return;
        }

        // SQS allows max 10 messages per batch
        const batchSize = 10;
        for (let i = 0; i < activities.length; i += batchSize) {
            const chunk = activities.slice(i, i + batchSize);
            const entries = chunk.map((activity, index) => ({
                Id: `msg_${Date.now()}_${i}_${index}`,
                MessageBody: JSON.stringify({ userId: userId.toString(), activityId: activity.activityId.toString(), aspectType: activity.aspectType })
            }));

            const params = {
                QueueUrl: process.env.SYNC_QUEUE_URL,
                Entries: entries
            };

            try {
                const command = new SendMessageBatchCommand(params);
                await sqsClient.send(command);
                logger.info({ userId, batchLength: entries.length }, 'Enqueued batch to ActivitySyncQueue');
            } catch (error) {
                logger.error({ errMessage: error.message, userId }, 'Failed to enqueue batch to ActivitySyncQueue');
                throw error;
            }
        }
    }
}

module.exports = new QueueService();
