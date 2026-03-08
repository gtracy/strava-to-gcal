const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const userRepository = require('../repositories/user-repository');
const createFlow = require('../flows/create');
const updateFlow = require('../flows/update');
const deleteFlow = require('../flows/delete');

exports.handler = async (event) => {
    logger.info({ event }, 'ActivitySyncWorker received event');

    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);
            const { userId, activityId, aspectType, updates = {} } = body;
            logger.info({ userId, activityId, aspectType, updates }, 'Processing sync record');

            const user = await userRepository.getUserByStravaAthleteId(userId.toString());
            if (!user) {
                logger.warn({ userId }, 'User not found in database, skipping sync');
                continue;
            }

            if (aspectType === 'create') {
                await createFlow.handleCreate(user, activityId);
            } else if (aspectType === 'update') {
                await updateFlow.handleUpdate(user, activityId, updates);
            } else if (aspectType === 'delete') {
                await deleteFlow.handleDelete(user, activityId);
            } else {
                logger.warn({ aspectType }, 'Unknown aspect type in sync record');
            }

        } catch (error) {
            if (error.name === 'RateLimitError') {
                logger.warn({ userId, activityId, provider: error.provider }, 'Rate limit hit. Re-throwing to trigger SQS retry with visibility timeout backoff.');
                throw error; // Let SQS retry
            }

            logger.error({ errMessage: error.message, stack: error.stack }, 'Error processing sync record');
            // Re-throw to trigger SQS retry or send to DLQ
            throw error;
        }
    }
};
