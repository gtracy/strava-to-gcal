process.env.JWT_SECRET = 'test-secret';
const app = require('../src/app');
const authService = require('../src/services/auth');
const userRepository = require('../src/repositories/user-repository');
const jwt = require('jsonwebtoken');

jest.mock('../src/services/auth');
jest.mock('../src/repositories/user-repository');

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
});
