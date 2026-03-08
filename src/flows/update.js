const stravaService = require('../services/strava');
const googleCalendarService = require('../services/googleCalendar');
const authService = require('../services/auth');
const userRepository = require('../repositories/user-repository');
const logger = require('../logger');
const { google } = require('googleapis');
const { buildEventDescription, buildEventLocation } = require('../utils/strava-formatter');
const { TokenRevokedError } = require('../utils/api-errors');

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
        if (e instanceof TokenRevokedError) {
            logger.warn({ googleUserId: user.googleUserId, provider: e.provider }, 'Token revoked during update flow, marking user as disconnected');
            await userRepository.markDisconnected(user.googleUserId, e.provider);
            return;
        }
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
        if (e instanceof TokenRevokedError) {
            logger.warn({ googleUserId: user.googleUserId, provider: e.provider }, 'Token revoked during update flow, marking user as disconnected');
            await userRepository.markDisconnected(user.googleUserId, e.provider);
            return;
        }
        logger.error({ errMessage: e.message, status: e.status || e.response?.status }, 'Failed to refresh Google token');
        throw e;
    }

    if (tokensUpdated) {
        try {
            await userRepository.saveUser(user);
        } catch (e) {
            logger.warn({ errMessage: e.message, name: e.name }, 'Failed to save user tokens, proceeding anyway');
        }
    }


    // 1. Proceed with Update
    // We used to filter by specific 'relevantKeys', but this skips updates for other fields
    // and causes issues when forcing updates from backfills. We now proceed with the update.
    logger.debug({ stravaActivityId }, 'Proceeding with calendar event update');

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
        logger.info({
            city: activity.location_city,
            state: activity.location_state,
            country: activity.location_country
        }, 'Raw Strava Activity Location Fields');
    } catch (error) {
        logger.error({ errMessage: error.message, status: error.status || error.response?.status, stravaActivityId }, 'Failed to fetch activity from Strava');
        throw error;
    }

    // 4. Patch Event
    const startDate = new Date(activity.start_date);
    const endDate = new Date(startDate.getTime() + activity.elapsed_time * 1000);

    const eventLocation = await buildEventLocation(activity);

    const eventUpdates = {
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

    await googleCalendarService.patchEvent(googleAuthClient, existingEvent.id, eventUpdates, calendarId);
    logger.info({ stravaActivityId, eventId: existingEvent.id }, 'Successfully updated Google Calendar event');
}

module.exports = { handleUpdate };
