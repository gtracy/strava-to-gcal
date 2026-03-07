const logger = require('./logger');

const config = {
  getStrava: () => ({
    clientId: process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
  }),
  getGoogle: () => ({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }),
  getJwtSecret: () => process.env.JWT_SECRET,
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
