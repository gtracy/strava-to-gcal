const logger = require('./logger');
const queueService = require('./services/queue');
const authService = require('./services/auth');
const googleCalendarService = require('./services/googleCalendar');
const userRepository = require('./repositories/user-repository');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';

const verifySession = (headers) => {
    if (!headers || !headers.authorization) throw new Error('Missing Authorization');
    const token = headers.authorization.split(' ')[1];
    return jwt.verify(token, JWT_SECRET).googleUserId;
};

const handleError = (error, context = {}) => {
    // Determine status code based on common error types or our explicit throwing
    const statusCode = error.statusCode || error.response?.status || (error.message.includes('Unauthorized') ? 401 : 500);

    const errorSummary = {
        message: error.message,
        name: error.name,
        statusCode
    };

    // Log the error securely with pino
    logger.error({ err: errorSummary, ...context }, 'Unhandled API Error');

    // Return a safe, sanitized client response
    return {
        statusCode,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
            error: statusCode === 500 ? 'Internal Server Error' : error.message
        })
    };
};

exports.handler = async (event) => {
    logger.debug({
        routeKey: event.routeKey,
        headers: event.headers ? Object.keys(event.headers) : [],
        hasBody: !!event.body
    }, 'Incoming request');

    const { routeKey, rawQueryString, body, headers } = event;

    try {
        // --- Auth Endpoints ---

        // Handle CORS Preflight
        if (routeKey.startsWith('OPTIONS')) {
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, GET, PATCH, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization"
                },
                body: ''
            };
        }

        // POST /auth/google
        if (routeKey === 'POST /auth/google') {
            const { code, redirectUri } = JSON.parse(body);

            // 1. Exchange Code for Tokens
            const tokens = await authService.exchangeGoogleCode(code, redirectUri); // Contains access_token, refresh_token, id_token

            // 2. Verify ID Token from the exchange
            if (!tokens.id_token) {
                const err = new Error('No ID Token in Google token exchange');
                err.statusCode = 401;
                throw err;
            }

            const payload = await authService.verifyGoogleToken(tokens.id_token);
            const googleUserId = payload.sub;
            const email = payload.email;

            // 3. Save/Update User
            let user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) {
                user = { googleUserId, email };
            }

            user.googleAccessToken = tokens.access_token;
            if (tokens.refresh_token) {
                user.googleRefreshToken = tokens.refresh_token;
            }
            // Update timestamp maybe? 

            await userRepository.saveUser(user);
            logger.info({ googleUserId }, 'User authenticated with Google');

            const token = jwt.sign({ googleUserId }, JWT_SECRET, { expiresIn: '1d' });

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ user: { googleUserId, email, hasStrava: !!user.stravaAthleteId, selectedCalendarId: user.selectedCalendarId, metricPreference: user.metricPreference }, token })
            };
        }

        // POST /auth/strava
        if (routeKey === 'POST /auth/strava') {
            const { code } = JSON.parse(body);

            let authorizedGoogleId;
            try {
                authorizedGoogleId = verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const stravaData = await authService.exchangeStravaCode(code);
            // stravaData: access_token, refresh_token, athlete: { id, ... }

            const user = await userRepository.getUserByGoogleId(authorizedGoogleId);
            if (!user) {
                const err = new Error('User not found');
                err.statusCode = 404;
                throw err;
            }

            user.stravaAccessToken = stravaData.access_token;
            user.stravaRefreshToken = stravaData.refresh_token;
            user.stravaAthleteId = String(stravaData.athlete.id);

            // Set a smart default for metric preference if not explicitly set already
            if (!user.metricPreference) {
                const athletePref = stravaData.athlete.measurement_preference;
                const athleteCountry = stravaData.athlete.country;
                if (athletePref === 'meters') {
                    user.metricPreference = 'km';
                } else if (athletePref === 'feet') {
                    user.metricPreference = 'mi';
                } else if (athleteCountry === 'United States') {
                    user.metricPreference = 'mi';
                } else {
                    user.metricPreference = 'km'; // Fallback
                }
                logger.info({ googleUserId: authorizedGoogleId, preference: user.metricPreference }, 'Assigned smart default metric preference');
            }

            await userRepository.saveUser(user);
            logger.info({ googleUserId: authorizedGoogleId, stravaId: user.stravaAthleteId }, 'User connected Strava');

            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true }) };
        }

        // GET /user/status
        if (routeKey === 'GET /user/status') {
            let googleUserId;
            try {
                googleUserId = verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    connected: !!user?.stravaAthleteId,
                    googleUserId,
                    selectedCalendarId: user?.selectedCalendarId || 'primary',
                    metricPreference: user?.metricPreference || null
                })
            };
        }

        // GET /user/calendars
        if (routeKey === 'GET /user/calendars') {
            let googleUserId;
            try {
                googleUserId = verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) {
                const err = new Error('User not found');
                err.statusCode = 404;
                throw err;
            }

            // Refresh Google Token if needed to call Calendar API
            let googleCredentials;
            try {
                googleCredentials = await authService.refreshGoogleToken(user.googleRefreshToken);
            } catch (e) {
                const err = new Error('Failed to refresh Google token');
                err.statusCode = 401;
                throw err;
            }

            const googleAuthClient = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET
            );
            googleAuthClient.setCredentials(googleCredentials);

            const calendars = await googleCalendarService.listCalendars(googleAuthClient);
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(calendars) };
        }

        // POST /user/calendars/strava
        if (routeKey === 'POST /user/calendars/strava') {
            let googleUserId;
            try {
                googleUserId = verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) {
                const err = new Error('User not found');
                err.statusCode = 404;
                throw err;
            }

            // Refresh Google Token if needed to call Calendar API
            let googleCredentials;
            try {
                googleCredentials = await authService.refreshGoogleToken(user.googleRefreshToken);
            } catch (e) {
                const err = new Error('Failed to refresh Google token');
                err.statusCode = 401;
                throw err;
            }

            const googleAuthClient = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET
            );
            googleAuthClient.setCredentials(googleCredentials);

            // Create Calendar
            const newCalendar = await googleCalendarService.createCalendar(googleAuthClient, 'Strava');

            // Auto Select it for the user
            user.selectedCalendarId = newCalendar.id;
            await userRepository.saveUser(user);

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    success: true,
                    calendarId: newCalendar.id
                })
            };
        }

        // PATCH /user
        if (routeKey === 'PATCH /user') {
            let googleUserId;
            try {
                googleUserId = verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const updates = JSON.parse(body);
            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) {
                const err = new Error('User not found');
                err.statusCode = 404;
                throw err;
            }

            if (updates.selectedCalendarId) {
                user.selectedCalendarId = updates.selectedCalendarId;
            }
            if (updates.metricPreference) {
                user.metricPreference = updates.metricPreference;
            }

            await userRepository.saveUser(user);
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true, user }) };
        }
        // POST /admin/sync-fetch
        if (routeKey === 'POST /admin/sync-fetch') {
            const { userId, days } = JSON.parse(body);

            // Basic validation
            if (!userId || !days || isNaN(days) || days <= 0) {
                return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: 'Invalid userId or days' }) };
            }
            if (days > 60) {
                return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: 'Days cannot exceed 60' }) };
            }

            // Verify user exists and is connected to Strava
            const user = await userRepository.getUserByStravaAthleteId(userId.toString());
            if (!user) {
                return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: 'User not found for given Strava ID' }) };
            }

            // Enqueue the job
            await queueService.enqueueActivityFetch(userId, days);

            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true, message: `Enqueued fetch for last ${days} days` }) };
        }

        // --- Webhook Endpoints ---

        // GET /webhook - Verification
        if (routeKey === 'GET /webhook') {
            logger.info('Webhook verification endpoint reached v1.1 - deploy fix');
            const params = new URLSearchParams(rawQueryString);
            const challenge = params.get('hub.challenge');
            const verifyToken = params.get('hub.verify_token');
            const mode = params.get('hub.mode');

            if (mode && verifyToken) {
                if (mode === 'subscribe' && verifyToken === process.env.STRAVA_VERIFY_TOKEN) {
                    logger.info('Webhook subscription verified!');
                    return {
                        statusCode: 200,
                        body: JSON.stringify({ "hub.challenge": challenge })
                    };
                } else {
                    logger.error({ mode, verifyToken }, 'Webhook verification failed: token or mode mismatch');
                    return { statusCode: 403, body: 'Forbidden' };
                }
            } else {
                logger.error({ params: rawQueryString }, 'Webhook Verification failed: missing mode or verify_token');
                return { statusCode: 403, body: 'Forbidden' };
            }
        }

        // POST /webhook - Event ingestion
        if (routeKey === 'POST /webhook') {
            const payload = JSON.parse(body);
            logger.info({ payload }, 'Received webhook payload');

            const { aspect_type, object_id, owner_id, updates } = payload;

            // 1. Find User
            const user = await userRepository.getUserByStravaAthleteId(owner_id);
            if (!user) {
                logger.warn({ owner_id }, 'Received webhook for unknown user, ignoring');
                return { statusCode: 200, body: 'Ignored: User not found' };
            }

            // Enqueue the message to ActivitySyncQueue instead of processing it synchronously
            await queueService.enqueueActivitySync(owner_id, object_id, aspect_type, updates);

            return { statusCode: 200, body: 'OK' };
        }

        return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: 'Not Found' }) };

    } catch (error) {
        return handleError(error, { routeKey });
    }
};
