const fetchWorker = require('../src/workers/fetch-worker');
const userRepository = require('../src/repositories/user-repository');
const authService = require('../src/services/auth');
const stravaService = require('../src/services/strava');
const queueService = require('../src/services/queue');

jest.mock('../src/repositories/user-repository');
jest.mock('../src/services/auth');
jest.mock('../src/services/strava');
jest.mock('../src/services/queue');

describe('ActivityFetchWorker', () => {
    const mockUser = {
        googleUserId: 'g-user-123',
        stravaAthleteId: '9007199254740993',
        stravaRefreshToken: 'old-refresh-token',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        userRepository.getUserByStravaAthleteId.mockResolvedValue({ ...mockUser });
        userRepository.saveUser.mockResolvedValue();
        authService.refreshStravaToken.mockResolvedValue({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
        });
        queueService.enqueueActivitySyncBatch.mockResolvedValue();
    });

    it('should prefer act.id_str over act.id to preserve 64-bit activity IDs when enqueuing sync batch', async () => {
        stravaService.listActivities.mockResolvedValue([
            {
                id: 9007199254740992,
                id_str: '9007199254740995',
                name: '64-bit Activity',
            },
            {
                id: 12345678,
                name: 'Legacy 32/53-bit Activity without id_str',
            },
        ]);

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: '9007199254740993',
                        days: 30,
                    }),
                },
            ],
        };

        await fetchWorker.handler(event);

        expect(userRepository.getUserByStravaAthleteId).toHaveBeenCalledWith('9007199254740993');
        expect(queueService.enqueueActivitySyncBatch).toHaveBeenCalledWith('9007199254740993', [
            {
                activityId: '9007199254740995',
                aspectType: 'create',
            },
            {
                activityId: '12345678',
                aspectType: 'create',
            },
        ]);
    });
});
