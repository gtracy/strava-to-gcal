const googleCalendarService = require('../services/googleCalendar');
const authService = require('../services/auth');
const userRepository = require('../repositories/user-repository');
const logger = require('../logger');
const { google } = require('googleapis');
const { TokenRevokedError } = require('../utils/api-errors');

async function handleDelete(user, stravaActivityId) {
    logger.debug({ stravaActivityId, googleUserId: user.googleUserId }, 'Handling delete flow');

    // 0. Refresh Google Token (Strava not strictly needed for delete of calendar event)
    let googleAuthClient;
    let tokensUpdated = false;

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
        if (e instanceof TokenRevokedError) {
            logger.warn({ googleUserId: user.googleUserId, provider: e.provider }, 'Token revoked during delete flow, marking user as disconnected');
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
            logger.warn({ errMessage: e.message, name: e.name }, 'Failed to save user tokens');
        }
    }

    const calendarId = user.selectedCalendarId || 'primary';
    const existingEvent = await googleCalendarService.findEventByStravaId(googleAuthClient, stravaActivityId, calendarId);
    if (!existingEvent) {
        logger.info({ stravaActivityId }, 'Event not found, nothing to delete');
        return;
    }

    await googleCalendarService.deleteEvent(googleAuthClient, existingEvent.id, calendarId);
    logger.info({ stravaActivityId, eventId: existingEvent.id }, 'Successfully deleted Google Calendar event');
}

module.exports = { handleDelete };
