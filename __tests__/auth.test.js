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
