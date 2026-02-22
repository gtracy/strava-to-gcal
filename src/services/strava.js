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

module.exports = {
    getActivity,
};
