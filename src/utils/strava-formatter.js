/**
 * Formats a given number of seconds into a readable string (e.g. 1h 15m 30s)
 */
function formatDuration(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

/**
 * Formats speed into m/s, km/h, and mph. Pace if it's a run.
 */
function formatSpeed(speedMs, isRun, pref = null) {
    if (!speedMs) return null;
    if (isRun) {
        // convert to min/km
        const minsPerKm = Math.floor(1000 / speedMs / 60);
        const secsPerKm = Math.round((1000 / speedMs) % 60);
        const paceKm = `${minsPerKm}:${secsPerKm.toString().padStart(2, '0')} /km`;

        const minsPerMi = Math.floor(1609.344 / speedMs / 60);
        const secsPerMi = Math.round((1609.344 / speedMs) % 60);
        const paceMi = `${minsPerMi}:${secsPerMi.toString().padStart(2, '0')} /mi`;

        if (pref === 'km') return paceKm;
        if (pref === 'mi') return paceMi;
        return `${paceKm} (${paceMi})`;
    } else {
        const kmh = (speedMs * 3.6).toFixed(1);
        const mph = (speedMs * 2.23694).toFixed(1);

        if (pref === 'km') return `${kmh} km/h`;
        if (pref === 'mi') return `${mph} mph`;
        return `${kmh} km/h (${mph} mph)`;
    }
}

/**
 * Builds an enriched description for Google Calendar from a Strava DetailedActivity
 */
function buildEventDescription(activity, pref = null) {
    const lines = [];

    // Header
    lines.push(`View on Strava: https://strava.com/activities/${activity.id}`);
    if (activity.description) {
        lines.push(`\nNote: ${activity.description}`);
    }
    lines.push('\n--- Activity Details ---');
    lines.push(`Type: ${activity.type || activity.sport_type}`);

    const isRun = activity.type === 'Run' || activity.type === 'VirtualRun';

    // Distance
    if (activity.distance) {
        const distanceKm = (activity.distance / 1000).toFixed(2);
        const distanceMi = (activity.distance * 0.000621371).toFixed(2);
        if (pref === 'km') {
            lines.push(`Distance: ${distanceKm} km`);
        } else if (pref === 'mi') {
            lines.push(`Distance: ${distanceMi} mi`);
        } else {
            lines.push(`Distance: ${distanceKm} km (${distanceMi} mi)`);
        }
    }

    // Time
    if (activity.moving_time) {
        lines.push(`Moving Time: ${formatDuration(activity.moving_time)}`);
    }

    // Elevation
    if (activity.total_elevation_gain) {
        const elevGainM = activity.total_elevation_gain.toFixed(0);
        const elevGainFt = (activity.total_elevation_gain * 3.28084).toFixed(0);
        if (pref === 'km') {
            lines.push(`Elevation Gain: ${elevGainM} m`);
        } else if (pref === 'mi') {
            lines.push(`Elevation Gain: ${elevGainFt} ft`);
        } else {
            lines.push(`Elevation Gain: ${elevGainM} m (${elevGainFt} ft)`);
        }
    }

    // Speed / Pace
    if (activity.average_speed) {
        lines.push(`Average Speed: ${formatSpeed(activity.average_speed, isRun, pref)}`);
    }
    if (activity.max_speed) {
        lines.push(`Max Speed: ${formatSpeed(activity.max_speed, isRun, pref)}`);
    }

    // Heart Rate
    if (activity.has_heartrate) {
        if (activity.average_heartrate) lines.push(`Average Heart Rate: ${Math.round(activity.average_heartrate)} bpm`);
        if (activity.max_heartrate) lines.push(`Max Heart Rate: ${Math.round(activity.max_heartrate)} bpm`);
    }

    // Power
    if (activity.average_watts) {
        lines.push(`Average Power: ${Math.round(activity.average_watts)} W`);
    }
    if (activity.weighted_average_watts) {
        lines.push(`Weighted Average Power: ${Math.round(activity.weighted_average_watts)} W`);
    }
    if (activity.max_watts) {
        lines.push(`Max Power: ${Math.round(activity.max_watts)} W`);
    }

    // Extras
    if (activity.calories) {
        lines.push(`Calories: ${Math.round(activity.calories)} kcal`);
    }
    if (activity.suffer_score) {
        lines.push(`Relative Effort: ${activity.suffer_score}`);
    }
    if (activity.gear?.name) {
        lines.push(`Gear: ${activity.gear.name}`);
    }

    return lines.join('\n');
}

// Require axios for Nominatim
const axios = require('axios');

/**
 * Builds a location string for Google Calendar from a Strava DetailedActivity
 * using OSM Nominatim Reverse Geocoding since Strava deprecated location_city.
 */
async function buildEventLocation(activity) {
    // If Strava ever brings these back natively, use them first
    const nativeParts = [activity.location_city, activity.location_state, activity.location_country].filter(Boolean);
    if (nativeParts.length > 0) {
        return nativeParts.join(', ');
    }

    // Otherwise, reverse geocode the starting coordinates
    const latlng = activity.start_latlng;
    if (!latlng || !latlng.length || latlng.length !== 2) {
        return undefined; // No GPS data (e.g., indoor workout)
    }

    const [lat, lon] = latlng;

    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: {
                lat,
                lon,
                format: 'jsonv2',
                zoom: 10 // City/Town level zoom
            },
            headers: {
                // Nominatim requires a user-agent
                'User-Agent': 'strava-to-gcal-sync/1.0'
            },
            timeout: 5000 // Don't hang the sync if OSM is down
        });

        if (response.data && response.data.address) {
            const addr = response.data.address;
            const city = addr.city || addr.town || addr.village;
            const state = addr.state;
            const country = addr.country;

            const geoParts = [city, state, country].filter(Boolean);
            return geoParts.length > 0 ? geoParts.join(', ') : undefined;
        }
    } catch (error) {
        // Log silently and return undefined, we don't want to fail the whole event creation just because geocoding failed
        console.warn(`Failed to reverse geocode [${lat}, ${lon}]:`, error.message);
    }

    return undefined;
}

module.exports = {
    buildEventDescription,
    buildEventLocation,
    formatDuration,
    formatSpeed
};
