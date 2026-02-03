const config = {
  strava: {
    clientId: process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    refreshToken: process.env.STRAVA_REFRESH_TOKEN,
  },
  google: {
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    calendarId: process.env.GOOGLE_CALENDAR_ID,
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
