const config = require('../src/config');

// Mock config module — we're testing AuthService's behavior, not config itself
jest.mock('../src/config');

// Must clear module cache so AuthService picks up the mock
let AuthService;

describe('AuthService credential validation', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        // Re-require to get a fresh AuthService instance with null googleClient
        jest.mock('../src/config');
        AuthService = require('../src/services/auth');
    });

    it('should throw when GOOGLE_CLIENT_ID is missing', async () => {
        const config = require('../src/config');
        config.getGoogle.mockResolvedValue({
            clientId: undefined,
            clientSecret: 'some-secret'
        });

        await expect(AuthService.exchangeGoogleCode('test-code', 'http://localhost'))
            .rejects.toThrow('Google OAuth credentials are missing');
    });

    it('should throw when GOOGLE_CLIENT_SECRET is missing', async () => {
        const config = require('../src/config');
        config.getGoogle.mockResolvedValue({
            clientId: 'some-client-id',
            clientSecret: undefined
        });

        await expect(AuthService.exchangeGoogleCode('test-code', 'http://localhost'))
            .rejects.toThrow('Google OAuth credentials are missing');
    });

    it('should throw when both credentials are empty strings', async () => {
        const config = require('../src/config');
        config.getGoogle.mockResolvedValue({
            clientId: '',
            clientSecret: ''
        });

        await expect(AuthService.exchangeGoogleCode('test-code', 'http://localhost'))
            .rejects.toThrow('Google OAuth credentials are missing');
    });
});

describe('Strava Auth - Rate Limit Handling', () => {
    let AuthService;
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.mock('../src/config');
        const config = require('../src/config');
        config.getStrava.mockResolvedValue({
            clientId: 'client',
            clientSecret: 'secret'
        });
        AuthService = require('../src/services/auth');
    });

    it('should throw RateLimitError when Strava returns 429 on refresh', async () => {
        const axios = require('axios');
        const mockError = new Error('Request failed with status code 429');
        mockError.response = {
            status: 429,
            headers: {
                'x-ratelimit-usage': '101,1001',
                'x-ratelimit-limit': '100,1000'
            }
        };
        jest.spyOn(axios, 'post').mockRejectedValueOnce(mockError);

        const { RateLimitError } = require('../src/utils/api-errors');
        await expect(AuthService.refreshStravaToken('fake-refresh'))
            .rejects
            .toThrow(RateLimitError);
    });

    it('should throw TokenRevokedError when Strava returns 401 on refresh', async () => {
        const axios = require('axios');
        const mockError = new Error('Request failed with status code 401');
        mockError.response = { status: 401 };
        jest.spyOn(axios, 'post').mockRejectedValueOnce(mockError);

        const { TokenRevokedError } = require('../src/utils/api-errors');
        await expect(AuthService.refreshStravaToken('fake-refresh'))
            .rejects
            .toThrow(TokenRevokedError);
    });
});

describe('Google Auth - Token Revocation Handling', () => {
    let AuthService;
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        AuthService = require('../src/services/auth');
    });

    it('should throw TokenRevokedError when Google returns invalid_grant on refresh', async () => {
        // Mock the internal _getGoogleClient method since we don't want to mock the whole google-auth-library here
        const mockClient = {
            setCredentials: jest.fn(),
            refreshAccessToken: jest.fn().mockRejectedValue({
                message: 'invalid_grant'
            })
        };
        jest.spyOn(AuthService, '_getGoogleClient').mockResolvedValue(mockClient);

        const { TokenRevokedError } = require('../src/utils/api-errors');
        await expect(AuthService.refreshGoogleToken('fake-refresh'))
            .rejects
            .toThrow(TokenRevokedError);
    });
});
