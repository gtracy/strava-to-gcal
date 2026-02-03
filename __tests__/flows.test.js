const createFlow = require('../src/flows/create');
const updateFlow = require('../src/flows/update');
const deleteFlow = require('../src/flows/delete');
const stravaService = require('../src/services/strava');
const googleCalendarService = require('../src/services/googleCalendar');
const authService = require('../src/services/auth');

jest.mock('../src/services/strava');
jest.mock('../src/services/googleCalendar');
jest.mock('../src/services/auth');

describe('Flows', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        authService.refreshStravaToken.mockResolvedValue({
            access_token: 'new_strava_token',
            refresh_token: 'new_strava_refresh_token'
        });
        authService.refreshGoogleToken.mockResolvedValue({
            access_token: 'new_google_token',
            refresh_token: 'new_google_refresh_token'
        });
    });

    describe('Create Flow', () => {
        const mockUser = { stravaRefreshToken: 'rt', stravaAccessToken: 'at', googleAccessToken: 'gat', googleRefreshToken: 'grt' };

        it('should create an event if it does not exist', async () => {
            googleCalendarService.findEventByStravaId.mockResolvedValue(null);
            stravaService.getActivity.mockResolvedValue({
                id: 123,
                name: 'Test Run',
                type: 'Run',
                start_date: '2023-01-01T10:00:00Z',
                elapsed_time: 3600,
                distance: 10000
            });

            await createFlow.handleCreate(mockUser, 123);

            expect(googleCalendarService.createEvent).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    summary: 'Test Run',
                    extendedProperties: { shared: { strava_id: '123', activity_type: 'Run' } }
                }),
                'primary'
            );
        });

        it('should skip creation if event exists', async () => {
            googleCalendarService.findEventByStravaId.mockResolvedValue({ id: 'evt1' });

            await createFlow.handleCreate(mockUser, 123);

            expect(googleCalendarService.createEvent).not.toHaveBeenCalled();
        });
    });

    describe('Update Flow', () => {
        const mockUser = { stravaRefreshToken: 'rt', stravaAccessToken: 'at', googleAccessToken: 'gat', googleRefreshToken: 'grt' };

        it('should update event if it exists and updates are relevant', async () => {
            googleCalendarService.findEventByStravaId.mockResolvedValue({ id: 'evt1' });
            stravaService.getActivity.mockResolvedValue({
                id: 123,
                name: 'Updated Run',
                type: 'Run',
                start_date: '2023-01-01T10:00:00Z',
                elapsed_time: 3600,
                distance: 10000
            });

            await updateFlow.handleUpdate(mockUser, 123, { title: 'New Title' });

            expect(googleCalendarService.patchEvent).toHaveBeenCalledWith(
                expect.anything(),
                'evt1',
                expect.objectContaining({
                    summary: 'Updated Run'
                }),
                'primary'
            );
        });

        it('should skip update if no relevant fields changed', async () => {
            await updateFlow.handleUpdate(mockUser, 123, { description: 'stuff' });
            expect(googleCalendarService.findEventByStravaId).not.toHaveBeenCalled();
        });
    });

    describe('Delete Flow', () => {
        const mockUser = { stravaRefreshToken: 'rt', stravaAccessToken: 'at', googleAccessToken: 'gat', googleRefreshToken: 'grt' };

        it('should delete event if it exists', async () => {
            googleCalendarService.findEventByStravaId.mockResolvedValue({ id: 'evt1' });

            await deleteFlow.handleDelete(mockUser, 123);

            expect(googleCalendarService.deleteEvent).toHaveBeenCalledWith(expect.anything(), 'evt1', 'primary');
        });

        it('should skip delete if event does not exist', async () => {
            googleCalendarService.findEventByStravaId.mockResolvedValue(null);

            await deleteFlow.handleDelete(mockUser, 123);

            expect(googleCalendarService.deleteEvent).not.toHaveBeenCalled();
        });
    });
});
