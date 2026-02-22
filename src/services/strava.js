const axios = require('axios');
const config = require('../config');
const logger = require('../logger');



async function getActivity(accessToken, id) {
    try {
        logger.debug({ stravaId: id }, 'Fetching Strava activity');
        const response = await axios.get(`https://www.strava.com/api/v3/activities/${id}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        logger.debug({ stravaId: id, status: response.status }, 'Fetched Strava activity');
        return response.data;
    } catch (error) {
        const errorDetails = error.response?.data ? {
            status: error.response.status,
            stravaMessage: error.response.data.message,
            stravaErrors: error.response.data.errors
        } : { errMessage: error.message };

        logger.error({ stravaId: id, ...errorDetails }, 'Failed to fetch Strava activity');
        throw error;
    }
}

async function listActivities(accessToken, afterEpoch, beforeEpoch) {
    let allActivities = [];
    let page = 1;
    const perPage = 200; // max allowed by Strava is 200

    try {
        while (true) {
            logger.debug({ page, afterEpoch, beforeEpoch }, 'Fetching Strava activities page');
            const response = await axios.get(`https://www.strava.com/api/v3/athlete/activities`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    after: afterEpoch,
                    before: beforeEpoch,
                    page,
                    per_page: perPage
                }
            });

            const activities = response.data;
            if (activities.length === 0) {
                break; // no more 
            }

            allActivities.push(...activities);
            if (activities.length < perPage) {
                break; // last page
            }
            page++;
        }
        logger.debug({ count: allActivities.length }, 'Fetched all Strava activities');
        return allActivities;
    } catch (error) {
        const errorDetails = error.response?.data ? {
            status: error.response.status,
            stravaMessage: error.response.data.message,
            stravaErrors: error.response.data.errors
        } : { errMessage: error.message };

        logger.error({ ...errorDetails }, 'Failed to fetch Strava activities list');
        throw error;
    }
}

module.exports = {
    getActivity,
    listActivities
};
