process.env.JWT_SECRET = 'test-secret';
const app = require('../src/app');
const authService = require('../src/services/auth');
const userRepository = require('../src/repositories/user-repository');
const googleCalendarService = require('../src/services/googleCalendar');
const queueService = require('../src/services/queue');
const jwt = require('jsonwebtoken');

jest.mock('../src/services/auth');
jest.mock('../src/repositories/user-repository');
jest.mock('../src/services/googleCalendar');
jest.mock('../src/services/queue');

describe('Auth Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('POST /auth/google should return user and valid JWT token', async () => {
        authService.exchangeGoogleCode.mockResolvedValue({
            access_token: 'google_access',
            id_token: 'google_id'
        });
        authService.verifyGoogleToken.mockResolvedValue({
            sub: '12345',
            email: 'test@example.com'
        });
        userRepository.getUserByGoogleId.mockResolvedValue(null);
        userRepository.saveUser.mockResolvedValue();

        const event = {
            routeKey: 'POST /auth/google',
            body: JSON.stringify({ code: 'test_code', redirectUri: 'http://localhost' })
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body.user.googleUserId).toBe('12345');
        expect(body.token).toBeDefined();

        // Verify token can be decoded
        const decoded = jwt.verify(body.token, 'test-secret');
        expect(decoded.googleUserId).toBe('12345');
    });

    it('GET /user/status should succeed with valid JWT', async () => {
        const token = jwt.sign({ googleUserId: '12345' }, 'test-secret');
        userRepository.getUserByGoogleId.mockResolvedValue({
            googleUserId: '12345',
            stravaAthleteId: 'strava123',
            selectedCalendarId: 'calendar1'
        });

        const event = {
            routeKey: 'GET /user/status',
            headers: {
                authorization: `Bearer ${token}`
            }
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body.connected).toBe(true);
        expect(body.googleUserId).toBe('12345');
        expect(body.selectedCalendarId).toBe('calendar1');
    });

    it('GET /user/status should fail without authorization header', async () => {
        const event = {
            routeKey: 'GET /user/status',
            headers: {}
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(401);
    });

    it('GET /user/status should fail with invalid JWT', async () => {
        const event = {
            routeKey: 'GET /user/status',
            headers: {
                authorization: `Bearer invalid.token.string`
            }
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(401);
    });

    it('DELETE /user should revoke tokens and delete user', async () => {
        const token = jwt.sign({ googleUserId: '12345' }, 'test-secret');
        userRepository.getUserByGoogleId.mockResolvedValue({
            googleUserId: '12345',
            googleRefreshToken: 'google_refresh',
            stravaAccessToken: 'strava_access'
        });
        authService.revokeGoogleToken.mockResolvedValue();
        authService.revokeStravaToken.mockResolvedValue();
        userRepository.deleteUser.mockResolvedValue(true);

        const event = {
            routeKey: 'DELETE /user',
            headers: {
                authorization: `Bearer ${token}`
            }
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).success).toBe(true);

        expect(authService.revokeGoogleToken).toHaveBeenCalledWith('google_refresh');
        expect(authService.revokeStravaToken).toHaveBeenCalledWith('strava_access');
        expect(userRepository.deleteUser).toHaveBeenCalledWith('12345');
    });

    it('POST /auth/google should reject with 403 when calendar.events scope is missing', async () => {
        authService.exchangeGoogleCode.mockResolvedValue({
            access_token: 'google_access',
            id_token: 'google_id',
            scope: 'openid email profile'
        });

        const event = {
            routeKey: 'POST /auth/google',
            body: JSON.stringify({ code: 'test_code', redirectUri: 'http://localhost' })
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toContain('Google Calendar permission was not granted');
        expect(userRepository.saveUser).not.toHaveBeenCalled();
    });

    it('GET /user/calendars should return 403 when Google Calendar throws insufficient permissions', async () => {
        const token = jwt.sign({ googleUserId: '12345' }, 'test-secret');
        userRepository.getUserByGoogleId.mockResolvedValue({
            googleUserId: '12345',
            googleRefreshToken: 'refresh_123'
        });
        authService.refreshGoogleToken.mockResolvedValue({
            access_token: 'new_token'
        });
        googleCalendarService.listCalendars.mockRejectedValue({
            code: 403,
            message: 'Insufficient Permission'
        });

        const event = {
            routeKey: 'GET /user/calendars',
            headers: {
                authorization: `Bearer ${token}`
            }
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('insufficient_calendar_permissions');
    });

    it('POST /auth/strava should connect Strava and trigger automatic lookback activity fetch', async () => {
        const token = jwt.sign({ googleUserId: '12345' }, 'test-secret');
        authService.exchangeStravaCode.mockResolvedValue({
            access_token: 'strava_access_123',
            refresh_token: 'strava_refresh_123',
            athlete: {
                id: 98765,
                measurement_preference: 'meters',
                country: 'United States'
            }
        });
        const mockUser = {
            googleUserId: '12345',
            email: 'test@example.com'
        };
        userRepository.getUserByGoogleId.mockResolvedValue(mockUser);
        userRepository.saveUser.mockResolvedValue();
        queueService.enqueueActivityFetch.mockResolvedValue();

        const event = {
            routeKey: 'POST /auth/strava',
            headers: {
                authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ code: 'strava_code_123' })
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).success).toBe(true);
        expect(userRepository.saveUser).toHaveBeenCalledWith(expect.objectContaining({
            stravaAthleteId: '98765',
            stravaAccessToken: 'strava_access_123',
            stravaRefreshToken: 'strava_refresh_123',
            metricPreference: 'km'
        }));
        expect(queueService.enqueueActivityFetch).toHaveBeenCalledWith('98765', 30);
    });

    it('POST /auth/strava should succeed even if automatic lookback enqueueActivityFetch fails', async () => {
        const token = jwt.sign({ googleUserId: '12345' }, 'test-secret');
        authService.exchangeStravaCode.mockResolvedValue({
            access_token: 'strava_access_123',
            refresh_token: 'strava_refresh_123',
            athlete: {
                id: 98765,
                measurement_preference: 'feet',
                country: 'United States'
            }
        });
        const mockUser = {
            googleUserId: '12345',
            email: 'test@example.com'
        };
        userRepository.getUserByGoogleId.mockResolvedValue(mockUser);
        userRepository.saveUser.mockResolvedValue();
        queueService.enqueueActivityFetch.mockRejectedValue(new Error('SQS send failed'));

        const event = {
            routeKey: 'POST /auth/strava',
            headers: {
                authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ code: 'strava_code_123' })
        };

        const response = await app.handler(event);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).success).toBe(true);
        expect(userRepository.saveUser).toHaveBeenCalled();
        expect(queueService.enqueueActivityFetch).toHaveBeenCalledWith('98765', 30);
    });
});
