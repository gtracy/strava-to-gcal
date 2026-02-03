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
        logger.error({ err: error, stravaId: id }, 'Failed to fetch Strava activity');
        throw error;
    }
}

module.exports = {
    getActivity,
};
