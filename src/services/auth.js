const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const logger = require('../logger');

class AuthService {
    constructor() {
        this.googleClient = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        this.stravaClientId = process.env.STRAVA_CLIENT_ID;
        this.stravaClientSecret = process.env.STRAVA_CLIENT_SECRET;
    }

    async verifyGoogleToken(idToken) {
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken: idToken,
                audience: process.env.GOOGLE_CLIENT_ID,
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
            const { tokens } = await this.googleClient.getToken({
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
        try {
            const response = await axios.post('https://www.strava.com/oauth/token', {
                client_id: this.stravaClientId,
                client_secret: this.stravaClientSecret,
                code: code,
                grant_type: 'authorization_code'
            });
            return response.data;
        } catch (error) {
            logger.error({ err: error }, 'Error exchanging Strava Code');
            throw error;
        }
    }

    // Refresh Google Token if needed
    async refreshGoogleToken(refreshToken) {
        this.googleClient.setCredentials({
            refresh_token: refreshToken
        });
        const { credentials } = await this.googleClient.refreshAccessToken();
        return credentials;
    }

    async refreshStravaToken(refreshToken) {
        try {
            const response = await axios.post('https://www.strava.com/oauth/token', {
                client_id: this.stravaClientId,
                client_secret: this.stravaClientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token'
            });
            return response.data;
        } catch (error) {
            logger.error({ err: error }, 'Error refreshing Strava Token');
            throw error;
        }
    }
}

module.exports = new AuthService();
