const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./logger');
const queueService = require('./services/queue');
const authService = require('./services/auth');
const googleCalendarService = require('./services/googleCalendar');
const userRepository = require('./repositories/user-repository');

const getJwtSecret = async () => {
    return await config.getJwtSecret() || process.env.JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';
};

const verifySession = async (headers) => {
    if (!headers || !headers.authorization) throw new Error('Missing Authorization');
    const token = headers.authorization.split(' ')[1];
    const secret = await getJwtSecret();
    return jwt.verify(token, secret).googleUserId;
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
                    "Access-Control-Allow-Methods": "POST, GET, PATCH, DELETE, OPTIONS",
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

            user.name = payload.name;
            user.firstName = payload.given_name;

            user.googleAccessToken = tokens.access_token;
            if (tokens.refresh_token) {
                user.googleRefreshToken = tokens.refresh_token;
            }
            // Update timestamp maybe? 

            await userRepository.saveUser(user);
            logger.info({ googleUserId }, 'User authenticated with Google');

            const secret = await getJwtSecret();
            const token = jwt.sign({ googleUserId }, secret, { expiresIn: '1d' });

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ user: { googleUserId, email, name: user.name, firstName: user.firstName, hasStrava: !!user.stravaAthleteId, selectedCalendarId: user.selectedCalendarId, metricPreference: user.metricPreference }, token })
            };
        }

        // POST /auth/strava
        if (routeKey === 'POST /auth/strava') {
            const { code } = JSON.parse(body);

            let authorizedGoogleId;
            try {
                authorizedGoogleId = await verifySession(headers);
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
                googleUserId = await verifySession(headers);
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

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    connected: !!user?.stravaAthleteId,
                    googleUserId,
                    email: user?.email,
                    name: user?.name,
                    firstName: user?.firstName,
                    selectedCalendarId: user?.selectedCalendarId || 'primary',
                    metricPreference: user?.metricPreference || null
                })
            };
        }

        // GET /user/calendars
        if (routeKey === 'GET /user/calendars') {
            let googleUserId;
            try {
                googleUserId = await verifySession(headers);
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

            const googleConfig = await config.getGoogle();
            const googleAuthClient = new google.auth.OAuth2(
                googleConfig.clientId,
                googleConfig.clientSecret
            );
            googleAuthClient.setCredentials(googleCredentials);

            const calendars = await googleCalendarService.listCalendars(googleAuthClient);
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(calendars) };
        }

        // POST /user/calendars/strava
        if (routeKey === 'POST /user/calendars/strava') {
            let googleUserId;
            try {
                googleUserId = await verifySession(headers);
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

            const googleConfig = await config.getGoogle();
            const googleAuthClient = new google.auth.OAuth2(
                googleConfig.clientId,
                googleConfig.clientSecret
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
                googleUserId = await verifySession(headers);
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

        // DELETE /user
        if (routeKey === 'DELETE /user') {
            let googleUserId;
            try {
                googleUserId = await verifySession(headers);
            } catch (e) {
                const err = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) {
                logger.info({ googleUserId }, 'User already deleted, returning success for graceful disconnect');
                return {
                    statusCode: 200,
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ success: true, message: 'Account already deleted' })
                };
            }

            // Concurrently revoke tokens
            const revocations = [];
            if (user.googleRefreshToken) {
                revocations.push(authService.revokeGoogleToken(user.googleRefreshToken));
            } else if (user.googleAccessToken) {
                revocations.push(authService.revokeGoogleToken(user.googleAccessToken));
            }

            if (user.stravaAccessToken) {
                revocations.push(authService.revokeStravaToken(user.stravaAccessToken));
            }

            await Promise.allSettled(revocations);

            // Delete User Record
            await userRepository.deleteUser(googleUserId);

            logger.info({ googleUserId }, 'User account deleted and access revoked');

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ success: true, message: 'Account deleted successfully' })
            };
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
            logger.info({
                raw: event.rawQueryString,
                parsed: event.queryStringParameters
            }, 'Webhook verification endpoint reached v1.2');

            // API Gateway V2 typically provides parsed query strings in event.queryStringParameters
            const params = new URLSearchParams(event.rawQueryString || '');
            const challenge = event.queryStringParameters?.['hub.challenge'] || params.get('hub.challenge');
            const verifyToken = event.queryStringParameters?.['hub.verify_token'] || params.get('hub.verify_token');
            const mode = event.queryStringParameters?.['hub.mode'] || params.get('hub.mode');

            if (mode && verifyToken) {
                if (mode === 'subscribe' && verifyToken === process.env.STRAVA_VERIFY_TOKEN) {
                    logger.info('Webhook subscription verified!');
                    return {
                        statusCode: 200,
                        body: JSON.stringify({ "hub.challenge": challenge })
                    };
                } else {
                    logger.error({ mode, verifyToken, expectedTokenHasValue: !!process.env.STRAVA_VERIFY_TOKEN }, 'Webhook verification failed: token or mode mismatch');
                    return { statusCode: 403, body: 'Forbidden' };
                }
            } else {
                logger.error({
                    rawQueryString: event.rawQueryString,
                    queryStringParameters: event.queryStringParameters
                }, 'Webhook Verification failed: missing mode or verify_token');
                return { statusCode: 403, body: 'Forbidden' };
            }
        }

        // POST /webhook - Event ingestion
        if (routeKey === 'POST /webhook') {
            const payload = JSON.parse(body);
            logger.info({ payload }, 'Received webhook payload');

            const { object_type, aspect_type, object_id, owner_id, updates } = payload;

            // 1. Find User
            const user = await userRepository.getUserByStravaAthleteId(owner_id);
            if (!user) {
                logger.warn({ owner_id }, 'Received webhook for unknown user, ignoring');
                return { statusCode: 200, body: 'Ignored: User not found' };
            }

            // 2. Handle Athlete Deauthorization or other athlete events
            if (object_type === 'athlete') {
                if (updates?.authorized === 'false') {
                    logger.info({ owner_id }, 'Athlete deauthorized app. Disconnecting Strava...');
                    user.stravaAccessToken = null;
                    user.stravaRefreshToken = null;
                    user.stravaAthleteId = null;
                    await userRepository.saveUser(user);
                }
                return { statusCode: 200, body: 'OK' };
            }

            // 3. Ignore other non-activity events
            if (object_type !== 'activity') {
                logger.debug({ object_type }, 'Ignoring non-activity webhook');
                return { statusCode: 200, body: 'OK' };
            }

            // 4. Enqueue the activity message to ActivitySyncQueue
            await queueService.enqueueActivitySync(owner_id, object_id, aspect_type, updates);

            return { statusCode: 200, body: 'OK' };
        }

        return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: 'Not Found' }) };

    } catch (error) {
        return handleError(error, { routeKey });
    }
};
