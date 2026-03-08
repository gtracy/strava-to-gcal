const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const pino = require('pino');
const kms = require('../utils/kms');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class UserRepository {
    constructor() {
        const clientOptions = {};
        if (process.env.AWS_REGION) {
            clientOptions.region = process.env.AWS_REGION;
        } else {
            // Default region for local development if not provided but SDK requires it
            clientOptions.region = 'us-east-1';
        }

        const client = new DynamoDBClient(clientOptions);
        this.docClient = DynamoDBDocumentClient.from(client);
        this.tableName = process.env.USERS_TABLE_NAME;
    }

    async saveUser(user) {
        const encryptedUser = { ...user };

        // Encrypt sensitive tokens if they exist
        if (user.googleAccessToken) encryptedUser.googleAccessToken = await kms.encrypt(user.googleAccessToken);
        if (user.googleRefreshToken) encryptedUser.googleRefreshToken = await kms.encrypt(user.googleRefreshToken);
        if (user.stravaAccessToken) encryptedUser.stravaAccessToken = await kms.encrypt(user.stravaAccessToken);
        if (user.stravaRefreshToken) encryptedUser.stravaRefreshToken = await kms.encrypt(user.stravaRefreshToken);

        const params = {
            TableName: this.tableName,
            Item: encryptedUser
        };

        try {
            await this.docClient.send(new PutCommand(params));
            logger.info({ googleUserId: user.googleUserId }, 'User saved successfully (encrypted)');
            return user;
        } catch (error) {
            logger.error({ errMessage: error.message, name: error.name, googleUserId: user.googleUserId }, 'Error saving user');
            throw error;
        }
    }

    async #decryptUser(user) {
        if (!user) return null;
        const decryptedUser = { ...user };
        if (user.googleAccessToken) decryptedUser.googleAccessToken = await kms.decrypt(user.googleAccessToken);
        if (user.googleRefreshToken) decryptedUser.googleRefreshToken = await kms.decrypt(user.googleRefreshToken);
        if (user.stravaAccessToken) decryptedUser.stravaAccessToken = await kms.decrypt(user.stravaAccessToken);
        if (user.stravaRefreshToken) decryptedUser.stravaRefreshToken = await kms.decrypt(user.stravaRefreshToken);
        return decryptedUser;
    }

    async getUserByGoogleId(googleUserId) {
        const params = {
            TableName: this.tableName,
            Key: { googleUserId }
        };

        try {
            const { Item } = await this.docClient.send(new GetCommand(params));
            return this.#decryptUser(Item);
        } catch (error) {
            logger.error({ errMessage: error.message, name: error.name, googleUserId }, 'Error getting user by Google ID');
            throw error;
        }
    }

    async getUserByStravaAthleteId(stravaAthleteId) {
        const params = {
            TableName: this.tableName,
            IndexName: 'StravaAthleteIndex',
            KeyConditionExpression: 'stravaAthleteId = :stravaAthleteId',
            ExpressionAttributeValues: {
                ':stravaAthleteId': stravaAthleteId.toString()
            }
        };

        try {
            const { Items } = await this.docClient.send(new QueryCommand(params));
            // We assume one user per Strava ID for now, but index allows multiple theoretically
            const user = Items && Items.length > 0 ? Items[0] : null;
            return this.#decryptUser(user);
        } catch (error) {
            logger.error({ errMessage: error.message, name: error.name, stravaAthleteId }, 'Error getting user by Strava Athlete ID');
            throw error;
        }
    }

    async deleteUser(googleUserId) {
        const params = {
            TableName: this.tableName,
            Key: { googleUserId }
        };

        try {
            await this.docClient.send(new DeleteCommand(params));
            logger.info({ googleUserId }, 'User deleted successfully');
            return true;
        } catch (error) {
            logger.error({ errMessage: error.message, name: error.name, googleUserId }, 'Error deleting user');
            throw error;
        }
    }

    /**
     * Mark a user as disconnected for a specific provider.
     * Clears the revoked tokens so workers stop retrying.
     */
    async markDisconnected(googleUserId, provider) {
        const updateExprParts = ['#status = :disconnected'];
        const exprAttrNames = { '#status': 'status' };
        const exprAttrValues = { ':disconnected': 'disconnected' };

        if (provider === 'strava') {
            updateExprParts.push('stravaAccessToken = :empty', 'stravaRefreshToken = :empty', 'hasStrava = :false');
            exprAttrValues[':empty'] = null;
            exprAttrValues[':false'] = false;
        } else if (provider === 'google') {
            updateExprParts.push('googleAccessToken = :empty', 'googleRefreshToken = :empty');
            exprAttrValues[':empty'] = null;
        }

        const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
        const params = {
            TableName: this.tableName,
            Key: { googleUserId },
            UpdateExpression: `SET ${updateExprParts.join(', ')}`,
            ExpressionAttributeNames: exprAttrNames,
            ExpressionAttributeValues: exprAttrValues,
        };

        try {
            await this.docClient.send(new UpdateCommand(params));
            logger.info({ googleUserId, provider }, 'User marked as disconnected');
        } catch (error) {
            logger.error({ errMessage: error.message, googleUserId, provider }, 'Failed to mark user as disconnected');
            throw error;
        }
    }
}

module.exports = new UserRepository();
