const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const userRepository = require('../repositories/user-repository');
const authService = require('../services/auth');
const stravaService = require('../services/strava');
const queueService = require('../services/queue');

exports.handler = async (event) => {
    logger.info({ event }, 'ActivityFetchWorker received event');

    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);
            const { userId, days } = body;
            logger.info({ userId, days }, 'Processing fetch record');

            const user = await userRepository.getUserByStravaAthleteId(userId.toString());
            if (!user) {
                logger.warn({ userId }, 'User not found in database, skipping fetch');
                continue;
            }

            // Refresh Strava Token if needed (for simplicity, we always use the refresh token here or check expiry if we had one)
            // Assuming refreshStravaToken gives a new access token
            let stravaData;
            try {
                stravaData = await authService.refreshStravaToken(user.stravaRefreshToken);
                user.stravaAccessToken = stravaData.access_token;
                user.stravaRefreshToken = stravaData.refresh_token;
                await userRepository.saveUser(user);
            } catch (err) {
                logger.error({ errMessage: err.message, userId }, 'Failed to refresh Strava token');
                throw err;
            }

            // Calculate epoch times
            const nowEpoch = Math.floor(Date.now() / 1000);
            const pastEpoch = nowEpoch - (days * 24 * 60 * 60);

            // Fetch activities
            const activities = await stravaService.listActivities(user.stravaAccessToken, pastEpoch, nowEpoch);
            logger.info({ userId, activityCount: activities.length }, 'Fetched activities from Strava');

            if (activities.length > 0) {
                const batch = activities.map(act => ({
                    activityId: act.id.toString(),
                    aspectType: 'create' // treat backfill as 'create' event
                }));

                await queueService.enqueueActivitySyncBatch(userId, batch);
            }

        } catch (error) {
            logger.error({ errMessage: error.message, stack: error.stack }, 'Error processing fetch record');
            // Re-throw so SQS can retry or send to DLQ
            throw error;
        }
    }
};
