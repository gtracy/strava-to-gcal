const syncWorker = require('../src/workers/sync-worker');
const userRepository = require('../src/repositories/user-repository');
const createFlow = require('../src/flows/create');
const updateFlow = require('../src/flows/update');
const deleteFlow = require('../src/flows/delete');

jest.mock('../src/repositories/user-repository', () => ({
    getUserByStravaAthleteId: jest.fn(),
    updateLastSyncTime: jest.fn(),
}));

jest.mock('../src/flows/create', () => ({
    handleCreate: jest.fn(),
}));

jest.mock('../src/flows/update', () => ({
    handleUpdate: jest.fn(),
}));

jest.mock('../src/flows/delete', () => ({
    handleDelete: jest.fn(),
}));

describe('ActivitySyncWorker', () => {
    const mockUser = {
        googleUserId: 'g-user-123',
        stravaAthleteId: 'strava-456',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        userRepository.getUserByStravaAthleteId.mockResolvedValue(mockUser);
        userRepository.updateLastSyncTime.mockResolvedValue('2026-10-18T12:00:00.000Z');
        createFlow.handleCreate.mockResolvedValue();
        updateFlow.handleUpdate.mockResolvedValue();
        deleteFlow.handleDelete.mockResolvedValue();
    });

    it('should process create aspect and update lastSyncTime', async () => {
        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: 'strava-456',
                        activityId: 'act-1',
                        aspectType: 'create',
                    }),
                },
            ],
        };

        await syncWorker.handler(event);

        expect(createFlow.handleCreate).toHaveBeenCalledWith(mockUser, 'act-1');
        expect(userRepository.updateLastSyncTime).toHaveBeenCalledWith('g-user-123');
    });

    it('should process update aspect and update lastSyncTime', async () => {
        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: 'strava-456',
                        activityId: 'act-2',
                        aspectType: 'update',
                        updates: { title: 'New Name' },
                    }),
                },
            ],
        };

        await syncWorker.handler(event);

        expect(updateFlow.handleUpdate).toHaveBeenCalledWith(mockUser, 'act-2', { title: 'New Name' });
        expect(userRepository.updateLastSyncTime).toHaveBeenCalledWith('g-user-123');
    });

    it('should process delete aspect and update lastSyncTime', async () => {
        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: 'strava-456',
                        activityId: 'act-3',
                        aspectType: 'delete',
                    }),
                },
            ],
        };

        await syncWorker.handler(event);

        expect(deleteFlow.handleDelete).toHaveBeenCalledWith(mockUser, 'act-3');
        expect(userRepository.updateLastSyncTime).toHaveBeenCalledWith('g-user-123');
    });

    it('should gracefully handle updateLastSyncTime failure without failing the batch', async () => {
        userRepository.updateLastSyncTime.mockRejectedValueOnce(new Error('DDB write failed'));

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: 'strava-456',
                        activityId: 'act-1',
                        aspectType: 'create',
                    }),
                },
            ],
        };

        await expect(syncWorker.handler(event)).resolves.not.toThrow();
        expect(createFlow.handleCreate).toHaveBeenCalledTimes(1);
        expect(userRepository.updateLastSyncTime).toHaveBeenCalledTimes(1);
    });

    it('should skip processing if user is not found in database', async () => {
        userRepository.getUserByStravaAthleteId.mockResolvedValueOnce(null);

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        userId: 'unknown-strava-id',
                        activityId: 'act-1',
                        aspectType: 'create',
                    }),
                },
            ],
        };

        await syncWorker.handler(event);

        expect(createFlow.handleCreate).not.toHaveBeenCalled();
        expect(userRepository.updateLastSyncTime).not.toHaveBeenCalled();
    });
});
