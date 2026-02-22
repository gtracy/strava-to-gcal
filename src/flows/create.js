const stravaService = require('../services/strava');
const googleCalendarService = require('../services/googleCalendar');
const authService = require('../services/auth');
const userRepository = require('../repositories/user-repository');
const logger = require('../logger');
const { google } = require('googleapis');
const { buildEventDescription, buildEventLocation } = require('../utils/strava-formatter');

async function handleCreate(user, stravaActivityId) {
    logger.debug({ stravaActivityId, googleUserId: user.googleUserId }, 'Handling create flow');

    // 0. Refresh Tokens
    let stravaAccessToken = user.stravaAccessToken;
    let tokensUpdated = false;

    try {
        const stravaTokens = await authService.refreshStravaToken(user.stravaRefreshToken);
        stravaAccessToken = stravaTokens.access_token;
        if (stravaTokens.access_token !== user.stravaAccessToken) {
            user.stravaAccessToken = stravaTokens.access_token;
            user.stravaRefreshToken = stravaTokens.refresh_token;
            tokensUpdated = true;
        }
    } catch (e) {
        logger.error({ errMessage: e.message, status: e.status || e.response?.status }, 'Failed to refresh Strava token');
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

        if (googleCredentials.access_token !== user.googleAccessToken) {
            user.googleAccessToken = googleCredentials.access_token;
            if (googleCredentials.refresh_token) {
                user.googleRefreshToken = googleCredentials.refresh_token;
            }
            tokensUpdated = true;
        }
    } catch (e) {
        logger.error({ errMessage: e.message, status: e.status || e.response?.status }, 'Failed to refresh Google token');
        throw e;
    }

    if (tokensUpdated) {
        try {
            await userRepository.saveUser(user);
        } catch (e) {
            logger.warn({ errMessage: e.message, name: e.name }, 'Failed to save user tokens');
        }
    }

    // 1. Check Idempotency
    const calendarId = user.selectedCalendarId || 'primary';
    const existingEvent = await googleCalendarService.findEventByStravaId(googleAuthClient, stravaActivityId, calendarId);
    if (existingEvent) {
        logger.info({ stravaActivityId, eventId: existingEvent.id }, 'Event already exists, routing to update flow to force sync');
        const updateFlow = require('./update');
        await updateFlow.handleUpdate(user, stravaActivityId, { force: true });
        return;
    }

    // 2. Fetch Data from Strava
    let activity;
    try {
        activity = await stravaService.getActivity(stravaAccessToken, stravaActivityId);
    } catch (error) {
        logger.error({ errMessage: error.message, status: error.status || error.response?.status, stravaActivityId }, 'Failed to fetch activity from Strava');
        throw error;
    }

    // 3. Create Event
    const startDate = new Date(activity.start_date); // UTC
    const endDate = new Date(startDate.getTime() + activity.elapsed_time * 1000);

    const eventLocation = await buildEventLocation(activity);

    const eventData = {
        summary: activity.name,
        location: eventLocation,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        description: buildEventDescription(activity, user.metricPreference),
        extendedProperties: {
            shared: {
                strava_id: String(stravaActivityId),
                activity_type: activity.type,
            },
        },
    };

    await googleCalendarService.createEvent(googleAuthClient, eventData, calendarId);
    logger.info({ stravaActivityId }, 'Successfully created Google Calendar event');
}

module.exports = { handleCreate };
