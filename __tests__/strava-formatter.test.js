const { buildEventDescription, formatDuration, formatSpeed } = require('../src/utils/strava-formatter');

describe('strava-formatter utilities', () => {

    describe('formatDuration', () => {
        it('should format seconds into h/m/s', () => {
            expect(formatDuration(3600)).toBe('1h 0m 0s');
            expect(formatDuration(3665)).toBe('1h 1m 5s');
            expect(formatDuration(65)).toBe('1m 5s');
            expect(formatDuration(5)).toBe('5s');
        });

        it('should handle zero or falsey gracefully', () => {
            expect(formatDuration(0)).toBe('0s');
            expect(formatDuration(null)).toBe('0s');
        });
    });

    describe('formatSpeed', () => {
        it('should format cycling speed to km/h and mph', () => {
            // 10 m/s = 36 km/h = 22.4 mph
            expect(formatSpeed(10, false)).toBe('36.0 km/h (22.4 mph)');
        });

        it('should format running pace to min/km', () => {
            // 3.33 m/s = ~5:00 /km
            expect(formatSpeed(3.333333, true)).toBe('5:00 /km');
            // String padding check
            expect(formatSpeed(3.03, true)).toBe('5:30 /km');
        });

        it('should return null for falsey inputs', () => {
            expect(formatSpeed(0, false)).toBeNull();
            expect(formatSpeed(null, true)).toBeNull();
        });
    });

    describe('buildEventDescription', () => {
        it('should generate a basic description for an activity with limited data', () => {
            const activity = {
                id: 12345,
                type: 'Walk',
                name: 'Morning Walk',
                distance: 2000,
                moving_time: 1200
            };

            const desc = buildEventDescription(activity);
            expect(desc).toContain('https://strava.com/activities/12345');
            expect(desc).toContain('Type: Walk');
            expect(desc).toContain('Distance: 2.00 km (1.24 mi)');
            expect(desc).toContain('Moving Time: 20m 0s');
            expect(desc).not.toContain('Elevation Gain');
            expect(desc).not.toContain('Heart Rate');
        });

        it('should render detailed power and speed metrics for a ride', () => {
            const activity = {
                id: 999,
                type: 'Ride',
                description: 'Windy day',
                total_elevation_gain: 500,
                average_speed: 8.5,
                max_speed: 15.2,
                average_watts: 180,
                weighted_average_watts: 210,
                max_watts: 800,
                calories: 1200,
                gear: { name: 'Trek Emonda' }
            };

            const desc = buildEventDescription(activity);
            expect(desc).toContain('Note: Windy day');
            expect(desc).toContain('Type: Ride');
            expect(desc).toContain('Elevation Gain: 500 m (1640 ft)');
            expect(desc).toContain('Average Speed: 30.6 km/h (19.0 mph)');
            expect(desc).toContain('Max Speed: 54.7 km/h (34.0 mph)');
            expect(desc).toContain('Average Power: 180 W');
            expect(desc).toContain('Weighted Average Power: 210 W');
            expect(desc).toContain('Max Power: 800 W');
            expect(desc).toContain('Calories: 1200 kcal');
            expect(desc).toContain('Gear: Trek Emonda');
        });

        it('should render pace format for a run', () => {
            const activity = {
                id: 111,
                type: 'Run',
                average_speed: 3.333,
                max_speed: 4.5,
                has_heartrate: true,
                average_heartrate: 150.5,
                max_heartrate: 180,
                suffer_score: 55
            };

            const desc = buildEventDescription(activity);
            expect(desc).toContain('Type: Run');
            expect(desc).toContain('Average Speed: 5:00 /km');
            expect(desc).toContain('Max Speed: 3:42 /km');
            expect(desc).toContain('Average Heart Rate: 151 bpm');
            expect(desc).toContain('Max Heart Rate: 180 bpm');
            expect(desc).toContain('Relative Effort: 55');
            expect(desc).not.toContain('Power');
        });
    });
});
