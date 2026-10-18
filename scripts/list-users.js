#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// 1. Attempt to load env.json if present
const envPath = path.join(__dirname, '..', 'env.json');
if (fs.existsSync(envPath)) {
    try {
        const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf8'));
        const variables = envConfig.StravaSyncFunction || Object.values(envConfig)[0];
        if (variables && typeof variables === 'object') {
            Object.assign(process.env, variables);
        }
    } catch (e) {
        logger.warn({ errMessage: e.message }, 'Failed to parse env.json, falling back to environment variables');
    }
}

// 2. Parse CLI Arguments
function parseArgs(argv = process.argv.slice(2)) {
    const getArg = (flag, defaultValue) => {
        const idx = argv.indexOf(flag);
        if (idx !== -1 && idx + 1 < argv.length) {
            return argv[idx + 1];
        }
        return defaultValue;
    };
    const hasFlag = (flag) => argv.includes(flag);

    return {
        showHelp: hasFlag('--help') || hasFlag('-h'),
        region: getArg('--region', process.env.AWS_REGION || 'us-east-2'),
        profile: getArg('--profile', process.env.AWS_PROFILE || 'strava-gcal'),
        tableName: getArg('--table', process.env.USERS_TABLE_NAME || 'StravaGcal-Users'),
        showAll: hasFlag('--all'),
        outputJson: hasFlag('--json'),
    };
}

function printHelp() {
    console.log(`
Usage: node scripts/list-users.js [options]
   or: npm run users:list [-- options]

Lists registered users in Clocking Sweat from the DynamoDB USERS_TABLE.
By default, displays active users with connected Strava and Google accounts.

Options:
  --all                 Include disconnected and pending users
  --json                Output user records in JSON format
  --table <tableName>   DynamoDB table name (default: USERS_TABLE_NAME or 'StravaGcal-Users')
  --profile <profile>   AWS CLI profile to use (default: env.AWS_PROFILE or 'strava-gcal')
  --region <region>     AWS Region (default: env.AWS_REGION or 'us-east-2')
  --help, -h            Show this help message

Examples:
  npm run users:list
  node scripts/list-users.js --all
  node scripts/list-users.js --json
  node scripts/list-users.js --region us-east-2 --profile my-profile
`);
}

function classifyUser(user) {
    if (user.status === 'disconnected' || user.disconnected === true) {
        return 'DISCONNECTED';
    }
    if (user.stravaAthleteId && user.hasStrava !== false) {
        return 'ACTIVE';
    }
    return 'PENDING_STRAVA';
}

function sanitizeUser(user) {
    const status = classifyUser(user);
    const fullName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || '(none)';

    return {
        athleteId: user.stravaAthleteId ? String(user.stravaAthleteId) : '(none)',
        name: fullName,
        email: user.email || '(none)',
        status,
        calendar: user.selectedCalendarSummary || user.selectedCalendarId || 'primary',
        units: user.metricPreference || '(default)',
        lastSync: user.lastSyncTime || user.updatedAt || user.createdAt || 'N/A',
        googleUserId: user.googleUserId || '(none)'
    };
}

async function scanAllUsers(docClient, tableName) {
    const items = [];
    let lastEvaluatedKey = undefined;

    do {
        const params = { TableName: tableName };
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }
        try {
            const response = await docClient.send(new ScanCommand(params));
            if (response.Items && response.Items.length > 0) {
                items.push(...response.Items);
            }
            lastEvaluatedKey = response.LastEvaluatedKey;
        } catch (err) {
            logger.error({ errMessage: err.message, name: err.name, tableName }, 'Error scanning DynamoDB users table');
            throw err;
        }
    } while (lastEvaluatedKey);

    return items;
}

async function main() {
    const options = parseArgs();

    if (options.showHelp) {
        printHelp();
        process.exit(0);
    }

    // Set AWS profile if not explicitly set in environment
    if (!process.env.AWS_PROFILE && options.profile) {
        process.env.AWS_PROFILE = options.profile;
    }

    const ddbClient = new DynamoDBClient({ region: options.region });
    const docClient = DynamoDBDocumentClient.from(ddbClient);

    try {
        const rawUsers = await scanAllUsers(docClient, options.tableName);
        const sanitizedUsers = rawUsers.map(sanitizeUser);

        // Compute counts
        const counts = {
            total: sanitizedUsers.length,
            active: sanitizedUsers.filter(u => u.status === 'ACTIVE').length,
            pending: sanitizedUsers.filter(u => u.status === 'PENDING_STRAVA').length,
            disconnected: sanitizedUsers.filter(u => u.status === 'DISCONNECTED').length,
        };

        const displayedUsers = options.showAll
            ? sanitizedUsers
            : sanitizedUsers.filter(u => u.status === 'ACTIVE');

        if (options.outputJson) {
            console.log(JSON.stringify({
                summary: counts,
                users: displayedUsers
            }, null, 2));
            return;
        }

        // Formatted Console Output
        console.log('\n================================================================================');
        console.log('                       CLOCKING SWEAT: USER DIRECTORY');
        console.log('================================================================================');
        console.log(`Table:         ${options.tableName} (${options.region})`);
        console.log(`Total Users:   ${counts.total} (Active: ${counts.active}, Pending Strava: ${counts.pending}, Disconnected: ${counts.disconnected})`);
        console.log(`Showing:       ${options.showAll ? 'All registered accounts' : 'Active users only (use --all to show pending/disconnected)'}`);
        console.log('--------------------------------------------------------------------------------\n');

        if (displayedUsers.length === 0) {
            if (counts.total === 0) {
                console.log('No users found in database table.\n');
            } else {
                console.log('No active users found. (Use --all to view pending or disconnected accounts)\n');
            }
            return;
        }

        const tableData = displayedUsers.map((u, idx) => ({
            '#': idx + 1,
            'Athlete ID': u.athleteId,
            'Name': u.name,
            'Email': u.email,
            'Status': u.status,
            'Calendar': u.calendar,
            'Units': u.units,
            'Last Sync': u.lastSync
        }));

        console.table(tableData);
        console.log('');
    } catch (err) {
        console.error(`\nError fetching users from DynamoDB: ${err.message}`);
        console.error(`Ensure your AWS credentials and region are configured (region: ${options.region}, profile: ${options.profile || 'default'}).\n`);
        process.exit(1);
    }
}

// Allow importing helpers for testing
if (require.main === module) {
    main();
} else {
    module.exports = {
        parseArgs,
        classifyUser,
        sanitizeUser,
        scanAllUsers,
    };
}
