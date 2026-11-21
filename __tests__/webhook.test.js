process.env.STRAVA_VERIFY_TOKEN = 'test-token';

const app = require('../src/app');
const userRepository = require('../src/repositories/user-repository');
const queueService = require('../src/services/queue');

jest.mock('../src/repositories/user-repository');
jest.mock('../src/services/queue');

describe('Webhook Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /webhook', () => {
        it('should return 200 and challenge on valid verify request', async () => {
            const event = {
                routeKey: 'GET /webhook',
                rawQueryString: 'hub.mode=subscribe&hub.challenge=1234&hub.verify_token=test-token'
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body)["hub.challenge"]).toBe("1234");
        });

        it('should return 403 on invalid verify token', async () => {
            const event = {
                routeKey: 'GET /webhook',
                rawQueryString: 'hub.mode=subscribe&hub.challenge=1234&hub.verify_token=wrong-token'
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(403);
            expect(response.body).toBe("Forbidden");
        });

        it('should return 403 (Forbidden) for requests without verification params', async () => {
            const event = {
                routeKey: 'GET /webhook',
                rawQueryString: 'foo=bar'
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(403);
            expect(response.body).toBe("Forbidden");
        });
    });

    describe('POST /webhook', () => {
        it('should process create aspect type', async () => {
            const user = { googleUserId: 'test-user', stravaAthleteId: '123' };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({ object_type: 'activity', aspect_type: 'create', object_id: 'abc', owner_id: '123' })
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(queueService.enqueueActivitySync).toHaveBeenCalledWith('123', 'abc', 'create', undefined);
        });

        it('should process update aspect type', async () => {
            const user = { googleUserId: 'test-user', stravaAthleteId: '123' };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({ object_type: 'activity', aspect_type: 'update', object_id: 'abc', owner_id: '123', updates: { title: 'new' } })
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(queueService.enqueueActivitySync).toHaveBeenCalledWith('123', 'abc', 'update', { title: 'new' });
        });

        it('should process delete aspect type', async () => {
            const user = { googleUserId: 'test-user', stravaAthleteId: '123' };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({ object_type: 'activity', aspect_type: 'delete', object_id: 'abc', owner_id: '123' })
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(queueService.enqueueActivitySync).toHaveBeenCalledWith('123', 'abc', 'delete', undefined);
        });

        it('should ignore events for unknown users but return 200', async () => {
            userRepository.getUserByStravaAthleteId.mockResolvedValue(null);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({ object_type: 'activity', aspect_type: 'create', object_id: 'abc', owner_id: 'unknown' })
            };
            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(queueService.enqueueActivitySync).not.toHaveBeenCalled();
        });

        it('should process athlete deauthorization and clear strava data', async () => {
            const user = { googleUserId: 'test-user', stravaAthleteId: '123', stravaAccessToken: 'token' };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({ object_type: 'athlete', aspect_type: 'update', object_id: '123', owner_id: '123', updates: { authorized: 'false' } })
            };
            const response = await app.handler(event);

            expect(response.statusCode).toBe(200);
            expect(userRepository.saveUser).toHaveBeenCalledWith({
                googleUserId: 'test-user',
                stravaAthleteId: null,
                stravaAccessToken: null,
                stravaRefreshToken: null
            });
            expect(queueService.enqueueActivitySync).not.toHaveBeenCalled();
        });

        it('should preserve 64-bit integer object_id and owner_id exceeding Number.MAX_SAFE_INTEGER in raw JSON body', async () => {
            const bigOwnerId = '9007199254740993';
            const bigObjectId = '9007199254740995';
            const user = { googleUserId: 'test-user-64', stravaAthleteId: bigOwnerId };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            // Construct raw JSON with unquoted 64-bit numbers (> 2^53 - 1)
            const rawBody = `{"object_type":"activity","aspect_type":"create","object_id":${bigObjectId},"owner_id":${bigOwnerId}}`;
            const event = {
                routeKey: 'POST /webhook',
                body: rawBody
            };

            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(userRepository.getUserByStravaAthleteId).toHaveBeenCalledWith(bigOwnerId);
            expect(queueService.enqueueActivitySync).toHaveBeenCalledWith(bigOwnerId, bigObjectId, 'create', undefined);
        });

        it('should prefer object_id_str and owner_id_str when present in webhook payload', async () => {
            const bigOwnerId = '9007199254740993';
            const bigObjectId = '9007199254740995';
            const user = { googleUserId: 'test-user-64', stravaAthleteId: bigOwnerId };
            userRepository.getUserByStravaAthleteId.mockResolvedValue(user);

            const event = {
                routeKey: 'POST /webhook',
                body: JSON.stringify({
                    object_type: 'activity',
                    aspect_type: 'update',
                    object_id: 9007199254740992,
                    object_id_str: bigObjectId,
                    owner_id: 9007199254740992,
                    owner_id_str: bigOwnerId,
                    updates: { title: '64-bit Ride' }
                })
            };

            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(userRepository.getUserByStravaAthleteId).toHaveBeenCalledWith(bigOwnerId);
            expect(queueService.enqueueActivitySync).toHaveBeenCalledWith(bigOwnerId, bigObjectId, 'update', { title: '64-bit Ride' });
        });
    });

    describe('POST /admin/sync-fetch', () => {
        it('should preserve 64-bit userId in raw JSON body when triggering admin sync-fetch', async () => {
            const bigUserId = '9007199254740993';
            userRepository.getUserByStravaAthleteId.mockResolvedValue({
                googleUserId: 'test-user-64',
                stravaAthleteId: bigUserId
            });
            queueService.enqueueActivityFetch.mockResolvedValue();

            const event = {
                routeKey: 'POST /admin/sync-fetch',
                body: `{"userId":${bigUserId},"days":14}`
            };

            const response = await app.handler(event);
            expect(response.statusCode).toBe(200);
            expect(userRepository.getUserByStravaAthleteId).toHaveBeenCalledWith(bigUserId);
            expect(queueService.enqueueActivityFetch).toHaveBeenCalledWith(bigUserId, 14);
        });
    });
});
