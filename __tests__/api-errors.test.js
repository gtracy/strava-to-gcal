const { isTokenRevocationError, isRateLimitError, isGooglePermissionError } = require('../src/utils/api-errors');

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

    describe('isGooglePermissionError', () => {
        it('identifies 403 with Insufficient Permission message', () => {
            const error = { status: 403, message: 'Insufficient Permission' };
            expect(isGooglePermissionError(error)).toBe(true);
        });

        it('identifies 403 with insufficientPermissions reason', () => {
            const error = {
                code: 403,
                errors: [{ reason: 'insufficientPermissions' }]
            };
            expect(isGooglePermissionError(error)).toBe(true);
        });

        it('identifies 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT detail', () => {
            const error = {
                response: {
                    status: 403,
                    data: {
                        error: {
                            message: 'Request had insufficient authentication scopes.',
                            errors: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }]
                        }
                    }
                }
            };
            expect(isGooglePermissionError(error)).toBe(true);
        });

        it('returns false for non-403 errors', () => {
            const error = { status: 404, message: 'Not Found' };
            expect(isGooglePermissionError(error)).toBe(false);
        });
    });
});
