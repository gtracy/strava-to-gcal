const config = require('../src/config');

describe('config.js environment variable reading', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        // Create a fresh copy of env for each test
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should read Google credentials from environment variables', () => {
        process.env.GOOGLE_CLIENT_ID = 'test-google-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

        const google = config.getGoogle();
        expect(google.clientId).toBe('test-google-id');
        expect(google.clientSecret).toBe('test-google-secret');
    });

    it('should read Strava credentials from environment variables', () => {
        process.env.STRAVA_CLIENT_ID = 'test-strava-id';
        process.env.STRAVA_CLIENT_SECRET = 'test-strava-secret';

        const strava = config.getStrava();
        expect(strava.clientId).toBe('test-strava-id');
        expect(strava.clientSecret).toBe('test-strava-secret');
    });

    it('should read JWT secret from environment variables', () => {
        process.env.JWT_SECRET = 'test-jwt-secret';

        const secret = config.getJwtSecret();
        expect(secret).toBe('test-jwt-secret');
    });

    it('should return undefined for missing environment variables', () => {
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;

        const google = config.getGoogle();
        expect(google.clientId).toBeUndefined();
        expect(google.clientSecret).toBeUndefined();
    });

    it('should default logLevel to info when LOG_LEVEL is not set', () => {
        delete process.env.LOG_LEVEL;
        // Need to re-require to pick up the default
        jest.resetModules();
        const freshConfig = require('../src/config');
        expect(freshConfig.logLevel).toBe('info');
    });
});
