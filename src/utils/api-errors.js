const logger = require('../logger');

class TokenRevokedError extends Error {
    constructor(provider, originalError) {
        super(`Token revoked for ${provider}`);
        this.name = 'TokenRevokedError';
        this.provider = provider;
        this.originalError = originalError;
    }
}

class RateLimitError extends Error {
    constructor(provider, retryAfterSeconds, originalError) {
        super(`Rate limit exceeded for ${provider}`);
        this.name = 'RateLimitError';
        this.provider = provider;
        this.retryAfterSeconds = retryAfterSeconds;
        this.originalError = originalError;
    }
}

/**
 * Checks if an error indicates a permanently revoked token.
 * - Strava: 401 from /oauth/token
 * - Google: 'invalid_grant' error or 401 from token refresh
 */
function isTokenRevocationError(error) {
    // Strava returns 401 when token is revoked
    const status = error.response?.status || error.status;
    if (status === 401) return true;

    // Google returns 'invalid_grant' when refresh token is revoked
    const errorMessage = error.response?.data?.error || error.message || '';
    if (errorMessage.includes('invalid_grant')) return true;

    // Google may also return 'Token has been expired or revoked'
    if (errorMessage.includes('Token has been expired or revoked')) return true;

    return false;
}

/**
 * Checks if an error is a 429 rate limit response.
 */
function isRateLimitError(error) {
    const status = error.response?.status || error.status;
    return status === 429;
}

/**
 * Checks if a Google Calendar API error indicates missing or revoked permissions (403).
 */
function isGooglePermissionError(error) {
    const status = error.code || error.status || error.response?.status;
    if (status === 403) {
        const message = error.message || error.response?.data?.error?.message || '';
        if (message.includes('Insufficient Permission') || message.includes('insufficient') || message.includes('PERMISSION_DENIED')) {
            return true;
        }
        const reason = error.errors?.[0]?.reason || error.response?.data?.error?.errors?.[0]?.reason;
        if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
            return true;
        }
    }
    return false;
}

module.exports = { TokenRevokedError, isTokenRevocationError, RateLimitError, isRateLimitError, isGooglePermissionError };
