const { google } = require('googleapis');
const config = require('../config');
const logger = require('../logger');



function getCalendarClient(auth) {
    return google.calendar({ version: 'v3', auth });
}

async function listCalendars(auth) {
    const calendar = getCalendarClient(auth);
    try {
        logger.debug('Listing calendars');
        const res = await calendar.calendarList.list({
            minAccessRole: 'writer',
        });
        logger.debug({ count: res.data.items.length }, 'Listed calendars');
        return res.data.items.map(item => ({
            id: item.id,
            summary: item.summary,
            primary: item.primary
        }));
    } catch (error) {
        logger.error({ err: error }, 'Failed to list calendars');
        throw error;
    }
}

async function findEventByStravaId(auth, stravaId, calendarId = 'primary') {
    const calendar = getCalendarClient(auth);
    try {
        const res = await calendar.events.list({
            calendarId: calendarId,
            sharedExtendedProperty: `strava_id=${stravaId}`,
            singleEvents: true,
        });
        return res.data.items[0] || null;
    } catch (error) {
        logger.error({ err: error, stravaId }, 'Failed to find event by Strava ID');
        throw error;
    }
}

async function createEvent(auth, eventData, calendarId = 'primary') {
    const calendar = getCalendarClient(auth);
    try {
        logger.debug({ calendarId, summary: eventData.summary }, 'Creating event');
        const res = await calendar.events.insert({
            calendarId: calendarId,
            requestBody: eventData,
        });
        logger.debug({ eventId: res.data.id }, 'Created event');
        return res.data;
    } catch (error) {
        logger.error({ err: error, eventData }, 'Failed to create event');
        throw error;
    }
}

async function patchEvent(auth, eventId, eventData, calendarId = 'primary') {
    const calendar = getCalendarClient(auth);
    try {
        logger.debug({ calendarId, eventId }, 'Patching event');
        const res = await calendar.events.patch({
            calendarId: calendarId,
            eventId: eventId,
            requestBody: eventData,
        });
        logger.debug('Patched event');
        return res.data;
    } catch (error) {
        logger.error({ err: error, eventId }, 'Failed to patch event');
        throw error;
    }
}

async function deleteEvent(auth, eventId, calendarId = 'primary') {
    const calendar = getCalendarClient(auth);
    try {
        logger.debug({ calendarId, eventId }, 'Deleting event');
        await calendar.events.delete({
            calendarId: calendarId,
            eventId: eventId,
        });
        logger.debug('Deleted event');
    } catch (error) {
        logger.error({ err: error, eventId }, 'Failed to delete event');
        throw error;
    }
}

module.exports = {
    findEventByStravaId,
    createEvent,
    patchEvent,
    deleteEvent,
    listCalendars,
};
