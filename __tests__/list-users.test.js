const { parseArgs, classifyUser, sanitizeUser, scanAllUsers } = require('../scripts/list-users');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

describe('scripts/list-users.js', () => {
    describe('classifyUser', () => {
        it('should classify connected user as ACTIVE', () => {
            const user = {
                googleUserId: 'g-123',
                stravaAthleteId: '98765',
                status: 'active',
                hasStrava: true,
            };
            expect(classifyUser(user)).toBe('ACTIVE');
        });

        it('should classify user without strava as PENDING_STRAVA', () => {
            const user = {
                googleUserId: 'g-123',
                email: 'test@example.com',
            };
            expect(classifyUser(user)).toBe('PENDING_STRAVA');
        });

        it('should classify user with status=disconnected as DISCONNECTED', () => {
            const user = {
                googleUserId: 'g-123',
                stravaAthleteId: '98765',
                status: 'disconnected',
            };
            expect(classifyUser(user)).toBe('DISCONNECTED');
        });

        it('should classify user with disconnected=true as DISCONNECTED', () => {
            const user = {
                googleUserId: 'g-123',
                stravaAthleteId: '98765',
                disconnected: true,
            };
            expect(classifyUser(user)).toBe('DISCONNECTED');
        });
    });

    describe('sanitizeUser', () => {
        it('should sanitize user fields and exclude sensitive tokens', () => {
            const rawUser = {
                googleUserId: 'g-123',
                stravaAthleteId: 98765,
                name: 'Jane Doe',
                email: 'jane@example.com',
                selectedCalendarSummary: 'Fitness Calendar',
                metricPreference: 'mi',
                lastSyncTime: '2026-10-18T00:00:00.000Z',
                googleAccessToken: 'secret-google-access',
                googleRefreshToken: 'secret-google-refresh',
                stravaAccessToken: 'secret-strava-access',
                stravaRefreshToken: 'secret-strava-refresh',
            };

            const sanitized = sanitizeUser(rawUser);

            expect(sanitized).toEqual({
                athleteId: '98765',
                name: 'Jane Doe',
                email: 'jane@example.com',
                status: 'ACTIVE',
                calendar: 'Fitness Calendar',
                units: 'mi',
                lastSync: '2026-10-18T00:00:00.000Z',
                googleUserId: 'g-123',
            });

            expect(sanitized.googleAccessToken).toBeUndefined();
            expect(sanitized.googleRefreshToken).toBeUndefined();
            expect(sanitized.stravaAccessToken).toBeUndefined();
            expect(sanitized.stravaRefreshToken).toBeUndefined();
        });

        it('should handle missing optional fields with sensible fallbacks', () => {
            const rawUser = {
                googleUserId: 'g-456',
            };

            const sanitized = sanitizeUser(rawUser);

            expect(sanitized).toEqual({
                athleteId: '(none)',
                name: '(none)',
                email: '(none)',
                status: 'PENDING_STRAVA',
                calendar: 'primary',
                units: '(default)',
                lastSync: 'N/A',
                googleUserId: 'g-456',
            });
        });
    });

    describe('parseArgs', () => {
        it('should parse default CLI arguments correctly', () => {
            const args = parseArgs([]);
            expect(args.showHelp).toBe(false);
            expect(args.showAll).toBe(false);
            expect(args.outputJson).toBe(false);
            expect(args.region).toBe(process.env.AWS_REGION || 'us-east-2');
            expect(args.tableName).toBe(process.env.USERS_TABLE_NAME || 'StravaGcal-Users');
        });

        it('should parse explicit flags and overrides', () => {
            const args = parseArgs(['--all', '--json', '--region', 'us-west-2', '--profile', 'prod', '--table', 'CustomUsers']);
            expect(args.showAll).toBe(true);
            expect(args.outputJson).toBe(true);
            expect(args.region).toBe('us-west-2');
            expect(args.profile).toBe('prod');
            expect(args.tableName).toBe('CustomUsers');
        });

        it('should handle help flags', () => {
            expect(parseArgs(['-h']).showHelp).toBe(true);
            expect(parseArgs(['--help']).showHelp).toBe(true);
        });
    });

    describe('scanAllUsers', () => {
        it('should paginate and aggregate items from all scan pages', async () => {
            const mockDocClient = {
                send: jest.fn()
                    .mockResolvedValueOnce({
                        Items: [{ googleUserId: 'user-1' }, { googleUserId: 'user-2' }],
                        LastEvaluatedKey: { googleUserId: 'user-2' },
                    })
                    .mockResolvedValueOnce({
                        Items: [{ googleUserId: 'user-3' }],
                        LastEvaluatedKey: undefined,
                    }),
            };

            const users = await scanAllUsers(mockDocClient, 'TestTable');

            expect(users).toHaveLength(3);
            expect(users.map(u => u.googleUserId)).toEqual(['user-1', 'user-2', 'user-3']);
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);
        });

        it('should propagate errors when scanning fails', async () => {
            const mockDocClient = {
                send: jest.fn().mockRejectedValue(new Error('DynamoDB Scan failed')),
            };

            await expect(scanAllUsers(mockDocClient, 'TestTable')).rejects.toThrow('DynamoDB Scan failed');
        });
    });
});
