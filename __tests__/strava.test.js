const axios = require('axios');
const stravaService = require('../src/services/strava');
const { RateLimitError } = require('../src/utils/api-errors');

jest.mock('axios');

describe('Strava Service - Rate Limit Handling', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should throw RateLimitError when Strava returns 429 for getActivity', async () => {
        const mockError = new Error('Request failed with status code 429');
        mockError.response = {
            status: 429,
            headers: {
                'x-ratelimit-usage': '101,1001',
                'x-ratelimit-limit': '100,1000'
            }
        };
        axios.get.mockRejectedValueOnce(mockError);

        await expect(stravaService.getActivity('fake-token', 12345))
            .rejects
            .toThrow(RateLimitError);
    });

    it('should throw RateLimitError when Strava returns 429 for listActivities', async () => {
        const mockError = new Error('Request failed with status code 429');
        mockError.response = {
            status: 429,
            headers: {
                'x-ratelimit-usage': '101,1001',
                'x-ratelimit-limit': '100,1000'
            }
        };
        axios.get.mockRejectedValueOnce(mockError);

        await expect(stravaService.listActivities('fake-token', 1000, 2000))
            .rejects
            .toThrow(RateLimitError);
    });
});
