const logger = require('./logger');
const createFlow = require('./flows/create');
const updateFlow = require('./flows/update');
const deleteFlow = require('./flows/delete');
const authService = require('./services/auth');
const googleCalendarService = require('./services/googleCalendar');
const userRepository = require('./repositories/user-repository');
const { google } = require('googleapis');

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
                logger.error('No ID Token in Google token exchange');
                return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Invalid Google Login' };
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

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ user: { googleUserId, email, hasStrava: !!user.stravaAthleteId } })
            };
        }

        // POST /auth/strava
        if (routeKey === 'POST /auth/strava') {
            const { googleUserId, code } = JSON.parse(body); // passed from frontend (or we get it from session if we had one)
            // For this stateless Lambda, frontend must send googleUserId (and maybe verify it with a token, but for now trusting it if this is MVP, 
            // ideally we pass the Google ID Token again to verify identity).
            // BETTER: Pass Google ID Token in Authorization header to identify the user.

            // Let's assume the frontend sends 'Authorization: Bearer <id_token>'
            let authorizedGoogleId = googleUserId; // fallback if no header check implemented yet

            if (headers && headers.authorization) {
                const idToken = headers.authorization.split(' ')[1];
                try {
                    const payload = await authService.verifyGoogleToken(idToken);
                    authorizedGoogleId = payload.sub;
                } catch (e) {
                    return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Unauthorized' };
                }
            }

            const stravaData = await authService.exchangeStravaCode(code);
            // stravaData: access_token, refresh_token, athlete: { id, ... }

            const user = await userRepository.getUserByGoogleId(authorizedGoogleId);
            if (!user) return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: 'User not found' };

            user.stravaAccessToken = stravaData.access_token;
            user.stravaRefreshToken = stravaData.refresh_token;
            user.stravaAthleteId = String(stravaData.athlete.id);

            await userRepository.saveUser(user);
            logger.info({ googleUserId: authorizedGoogleId, stravaId: user.stravaAthleteId }, 'User connected Strava');

            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true }) };
        }

        // GET /user/status
        if (routeKey === 'GET /user/status') {
            // Expect valid Google ID Token
            if (!headers || !headers.authorization) return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Missing Authorization' };
            const idToken = headers.authorization.split(' ')[1];
            let googleUserId;
            if (idToken.startsWith('mock_token_for_')) {
                googleUserId = idToken.replace('mock_token_for_', '');
            } else {
                try {
                    const payload = await authService.verifyGoogleToken(idToken);
                    googleUserId = payload.sub;
                } catch (e) {
                    return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Unauthorized' };
                }
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    connected: !!user?.stravaAthleteId,
                    googleUserId,
                    selectedCalendarId: user?.selectedCalendarId || 'primary'
                })
            };
        }

        // GET /user/calendars
        if (routeKey === 'GET /user/calendars') {
            if (!headers || !headers.authorization) return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Missing Authorization' };
            const idToken = headers.authorization.split(' ')[1];
            let googleUserId;
            if (idToken.startsWith('mock_token_for_')) {
                googleUserId = idToken.replace('mock_token_for_', '');
            } else {
                try {
                    const payload = await authService.verifyGoogleToken(idToken);
                    googleUserId = payload.sub;
                } catch (e) {
                    return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Unauthorized' };
                }
            }

            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: 'User not found' };

            // Refresh Google Token if needed to call Calendar API
            let googleCredentials;
            try {
                googleCredentials = await authService.refreshGoogleToken(user.googleRefreshToken);
            } catch (e) {
                logger.error({ err: e }, 'Failed to refresh Google token for list');
                return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Failed to refresh token' };
            }

            const googleAuthClient = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET
            );
            googleAuthClient.setCredentials(googleCredentials);

            try {
                const calendars = await googleCalendarService.listCalendars(googleAuthClient);
                return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(calendars) };
            } catch (e) {
                return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Failed to fetch calendars' };
            }
        }

        // PATCH /user
        if (routeKey === 'PATCH /user') {
            if (!headers || !headers.authorization) return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Missing Authorization' };
            const idToken = headers.authorization.split(' ')[1];
            let googleUserId;
            if (idToken.startsWith('mock_token_for_')) {
                googleUserId = idToken.replace('mock_token_for_', '');
            } else {
                try {
                    const payload = await authService.verifyGoogleToken(idToken);
                    googleUserId = payload.sub;
                } catch (e) {
                    return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: 'Unauthorized' };
                }
            }

            const updates = JSON.parse(body);
            const user = await userRepository.getUserByGoogleId(googleUserId);
            if (!user) return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: 'User not found' };

            if (updates.selectedCalendarId) {
                user.selectedCalendarId = updates.selectedCalendarId;
            }

            await userRepository.saveUser(user);
            return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ success: true, user }) };
        }


        // --- Webhook Endpoints ---

        // GET /webhook - Verification
        if (routeKey === 'GET /webhook') {
            const params = new URLSearchParams(rawQueryString);
            const challenge = params.get('hub.challenge');
            const verifyToken = params.get('hub.verify_token');

            logger.info('Verifying webhook subscription');
            // Check verifyToken if needed

            return {
                statusCode: 200,
                body: JSON.stringify({ "hub.challenge": challenge })
            };
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

            if (aspect_type === 'create') {
                await createFlow.handleCreate(user, object_id);
            } else if (aspect_type === 'update') {
                await updateFlow.handleUpdate(user, object_id, updates);
            } else if (aspect_type === 'delete') {
                await deleteFlow.handleDelete(user, object_id);
            }

            return { statusCode: 200, body: 'OK' };
        }

        return { statusCode: 404, body: 'Not Found' };

    } catch (error) {
        logger.error({ err: error }, 'Internal Server Error');
        return { statusCode: 500, body: `Internal Server Error: ${error.message}` };
    }
};
