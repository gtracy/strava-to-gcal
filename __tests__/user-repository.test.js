const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const userRepository = require('../src/repositories/user-repository');

// Mock DocumentClient
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockReturnValue({
            send: jest.fn()
        })
    },
    PutCommand: jest.fn(),
    GetCommand: jest.fn(),
    QueryCommand: jest.fn(),
    DeleteCommand: jest.fn(),
    UpdateCommand: jest.fn()
}));

// Mock KMS utils to prevent trying to talk to real KMS
jest.mock('../src/utils/kms', () => ({
    encrypt: jest.fn((str) => Promise.resolve(`encrypted_${str}`)),
    decrypt: jest.fn((str) => Promise.resolve(str.replace('encrypted_', '')))
}));

describe('UserRepository - Disconnect Handling', () => {
    let mockSend;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSend = userRepository.docClient.send;
    });

    it('should correctly set status and clear tokens when Strava is revoked', async () => {
        const googleUserId = 'user-123';
        const provider = 'strava';

        mockSend.mockResolvedValueOnce({});

        await userRepository.markDisconnected(googleUserId, provider);

        expect(UpdateCommand).toHaveBeenCalledWith(expect.objectContaining({
            TableName: process.env.USERS_TABLE_NAME,
            Key: { googleUserId },
            UpdateExpression: 'SET #status = :disconnected, stravaAccessToken = :empty, stravaRefreshToken = :empty, hasStrava = :false',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':disconnected': 'disconnected',
                ':empty': null,
                ':false': false
            }
        }));
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should correctly set status and clear tokens when Google is revoked', async () => {
        const googleUserId = 'user-123';
        const provider = 'google';

        mockSend.mockResolvedValueOnce({});

        await userRepository.markDisconnected(googleUserId, provider);

        expect(UpdateCommand).toHaveBeenCalledWith(expect.objectContaining({
            TableName: process.env.USERS_TABLE_NAME,
            Key: { googleUserId },
            UpdateExpression: 'SET #status = :disconnected, googleAccessToken = :empty, googleRefreshToken = :empty',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
                ':disconnected': 'disconnected',
                ':empty': null
            }
        }));
        expect(mockSend).toHaveBeenCalledTimes(1);
    });
});
