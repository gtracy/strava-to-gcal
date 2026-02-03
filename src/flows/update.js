const stravaService = require('../services/strava');
const googleCalendarService = require('../services/googleCalendar');
const authService = require('../services/auth');
const userRepository = require('../repositories/user-repository');
const logger = require('../logger');
const { google } = require('googleapis');

async function handleUpdate(user, stravaActivityId, updates) {
    logger.debug({ stravaActivityId, googleUserId: user.googleUserId, updates }, 'Handling update flow');

    // 0. Refresh Tokens
    let stravaAccessToken = user.stravaAccessToken;
    let tokensUpdated = false;

    try {
        const stravaTokens = await authService.refreshStravaToken(user.stravaRefreshToken);
        stravaAccessToken = stravaTokens.access_token;
        user.stravaAccessToken = stravaTokens.access_token;
        user.stravaRefreshToken = stravaTokens.refresh_token; // Strava might rotate refresh token
        tokensUpdated = true;
    } catch (e) {
        logger.error({ err: e }, 'Failed to refresh Strava token');
        throw e;
    }

    let googleAuthClient;
    try {
        const googleCredentials = await authService.refreshGoogleToken(user.googleRefreshToken);
        googleAuthClient = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        googleAuthClient.setCredentials(googleCredentials);

        // Check if access token changed (it usually does on refresh)
        if (googleCredentials.access_token !== user.googleAccessToken) {
            user.googleAccessToken = googleCredentials.access_token;
            // Google generally returns refresh_token only if requested or sometimes not on refresh, 
            // but if it does, we should save it.
            if (googleCredentials.refresh_token) {
                user.googleRefreshToken = googleCredentials.refresh_token;
            }
            tokensUpdated = true;
        }
    } catch (e) {
        logger.error({ err: e }, 'Failed to refresh Google token');
        throw e;
    }

    if (tokensUpdated) {
        try {
            await userRepository.saveUser(user);
        } catch (e) {
            logger.warn({ err: e }, 'Failed to save user tokens, proceeding anyway');
        }
    }


    // 1. Filter Updates
    const relevantKeys = ['title', 'type', 'private'];
    const hasRelevantUpdates = Object.keys(updates).some(key => relevantKeys.includes(key));

    if (!hasRelevantUpdates) {
        logger.info({ stravaActivityId, updates }, 'No relevant updates found, skipping');
        return;
    }

    // 2. Locate Event
    const calendarId = user.selectedCalendarId || 'primary';
    const existingEvent = await googleCalendarService.findEventByStravaId(googleAuthClient, stravaActivityId, calendarId);
    if (!existingEvent) {
        logger.warn({ stravaActivityId }, 'Event not found for update, skipping');
        return;
    }

    // 3. Fetch Data from Strava
    let activity;
    try {
        activity = await stravaService.getActivity(stravaAccessToken, stravaActivityId);
    } catch (error) {
        logger.error({ err: error, stravaActivityId }, 'Failed to fetch activity from Strava');
        throw error;
    }

    // 4. Patch Event
    const startDate = new Date(activity.start_date);
    const endDate = new Date(startDate.getTime() + activity.elapsed_time * 1000);

    const eventUpdates = {
        summary: activity.name,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        description: `View on Strava: https://strava.com/activities/${stravaActivityId}\n\nType: ${activity.type}\nDistance: ${(activity.distance / 1000).toFixed(2)} km`,
        extendedProperties: {
            shared: {
                strava_id: String(stravaActivityId),
                activity_type: activity.type,
            },
        },
    };

    await googleCalendarService.patchEvent(googleAuthClient, existingEvent.id, eventUpdates, calendarId);
    logger.info({ stravaActivityId, eventId: existingEvent.id }, 'Successfully updated Google Calendar event');
}

module.exports = { handleUpdate };
