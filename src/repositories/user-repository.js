const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

class UserRepository {
    constructor() {
        const client = new DynamoDBClient({});
        this.docClient = DynamoDBDocumentClient.from(client);
        this.tableName = process.env.USERS_TABLE_NAME;
    }

    async saveUser(user) {
        const params = {
            TableName: this.tableName,
            Item: user
        };

        try {
            await this.docClient.send(new PutCommand(params));
            logger.info({ googleUserId: user.googleUserId }, 'User saved successfully');
            return user;
        } catch (error) {
            logger.error({ err: error, googleUserId: user.googleUserId }, 'Error saving user');
            throw error;
        }
    }

    async getUserByGoogleId(googleUserId) {
        const params = {
            TableName: this.tableName,
            Key: { googleUserId }
        };

        try {
            const { Item } = await this.docClient.send(new GetCommand(params));
            return Item;
        } catch (error) {
            logger.error({ err: error, googleUserId }, 'Error getting user by Google ID');
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
            return Items && Items.length > 0 ? Items[0] : null;
        } catch (error) {
            logger.error({ err: error, stravaAthleteId }, 'Error getting user by Strava Athlete ID');
            throw error;
        }
    }
}

module.exports = new UserRepository();
