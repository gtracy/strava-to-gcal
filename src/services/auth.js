const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const logger = require('../logger');
const config = require('../config');

class AuthService {
    constructor() {
        this.googleClient = null;
    }

    async _getGoogleClient() {
        if (this.googleClient) return this.googleClient;
        const googleConfig = await config.getGoogle();
        if (!googleConfig.clientId || !googleConfig.clientSecret) {
            throw new Error('Google OAuth credentials are missing. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are set.');
        }
        this.googleClient = new OAuth2Client(
            googleConfig.clientId,
            googleConfig.clientSecret
        );
        return this.googleClient;
    }

    async _getStravaConfig() {
        return config.getStrava();
    }

    async verifyGoogleToken(idToken) {
        try {
            const client = await this._getGoogleClient();
            const googleConfig = await config.getGoogle();
            const ticket = await client.verifyIdToken({
                idToken: idToken,
                audience: googleConfig.clientId,
            });
            const payload = ticket.getPayload();
            logger.debug({ sub: payload.sub, email: payload.email }, 'Verified Google ID Token');
            return payload; // Contains sub, email, name, etc.
        } catch (error) {
            logger.error({ err: error }, 'Error verifying Google Token');
            throw new Error('Invalid Google Token');
        }
    }

    async exchangeGoogleCode(code, redirectUri) {
        try {
            const client = await this._getGoogleClient();
            const { tokens } = await client.getToken({
                code,
                redirect_uri: redirectUri
            });
            return tokens;
        } catch (error) {
            logger.error({ err: error }, 'Error exchanging Google Code');
            throw error;
        }
    }

    async exchangeStravaCode(code) {
        const stravaConfig = await this._getStravaConfig();
        try {
            const response = await axios.post('https://www.strava.com/oauth/token', {
                client_id: stravaConfig.clientId,
                client_secret: stravaConfig.clientSecret,
                code: code,
                grant_type: 'authorization_code'
            });
            return response.data;
        } catch (error) {
            const errorDetails = error.response?.data ? {
                status: error.response.status,
                stravaMessage: error.response.data.message,
                stravaErrors: error.response.data.errors
            } : { errMessage: error.message };

            logger.error({ ...errorDetails }, 'Error exchanging Strava Code');
            throw error;
        }
    }

    // Refresh Google Token if needed
    async refreshGoogleToken(refreshToken) {
        const client = await this._getGoogleClient();
        client.setCredentials({
            refresh_token: refreshToken
        });
        const { credentials } = await client.refreshAccessToken();
        return credentials;
    }

    async refreshStravaToken(refreshToken) {
        const stravaConfig = await this._getStravaConfig();
        try {
            const response = await axios.post('https://www.strava.com/oauth/token', {
                client_id: stravaConfig.clientId,
                client_secret: stravaConfig.clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            });
            return response.data;
        } catch (error) {
            const errorDetails = error.response?.data ? {
                status: error.response.status,
                stravaMessage: error.response.data.message,
                stravaErrors: error.response.data.errors
            } : { errMessage: error.message };

            logger.error({ ...errorDetails }, 'Error refreshing Strava Token');
            throw error;
        }
    }

    async revokeGoogleToken(token) {
        try {
            await axios.post(`https://oauth2.googleapis.com/revoke?token=${token}`, null, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            logger.info('Successfully revoked Google token');
        } catch (error) {
            logger.warn({ err: error.message }, 'Google token revocation failed or token already invalid');
        }
    }

    async revokeStravaToken(token) {
        try {
            await axios.post('https://www.strava.com/oauth/deauthorize', {
                access_token: token
            });
            logger.info('Successfully revoked Strava access');
        } catch (error) {
            logger.warn({ err: error.message }, 'Strava deauthorization failed or token already invalid');
        }
    }
}

module.exports = new AuthService();
