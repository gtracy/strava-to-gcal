const { isTokenRevocationError, isRateLimitError } = require('../src/utils/api-errors');

describe('API Errors Utility', () => {
    describe('isTokenRevocationError', () => {
        it('identifies Strava 401 response as revoked', () => {
            const error = { response: { status: 401 } };
            expect(isTokenRevocationError(error)).toBe(true);
        });

        it('identifies Google invalid_grant response as revoked', () => {
            const error = { response: { data: { error: 'invalid_grant' } } };
            expect(isTokenRevocationError(error)).toBe(true);
        });

        it('identifies Google message "Token has been expired or revoked" as revoked', () => {
            const error = { message: 'Token has been expired or revoked' };
            expect(isTokenRevocationError(error)).toBe(true);
        });

        it('returns false for other errors', () => {
            const error = { response: { status: 500 } };
            expect(isTokenRevocationError(error)).toBe(false);
        });
    });

    describe('isRateLimitError', () => {
        it('identifies 429 response as rate limit', () => {
            const error = { response: { status: 429 } };
            expect(isRateLimitError(error)).toBe(true);
        });

        it('returns false for other errors', () => {
            const error = { response: { status: 400 } };
            expect(isRateLimitError(error)).toBe(false);
        });
    });
});
