#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// 1. Load env.json if present
const envPath = path.join(__dirname, '..', 'env.json');
if (fs.existsSync(envPath)) {
    try {
        const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf8'));
        const variables = envConfig.StravaSyncFunction || Object.values(envConfig)[0];
        if (variables && typeof variables === 'object') {
            Object.assign(process.env, variables);
        }
    } catch (e) {
        // Fall back to process.env
    }
}

// 2. Parse CLI Arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return defaultValue;
};
const hasFlag = (flag) => args.includes(flag);

if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: node scripts/disconnect-user.js [options]

Mimics a user disconnecting from the Clocking Sweat service via the web UI:
- Signs a JWT session token for the user
- Issues HTTP DELETE /user to the backend API (or performs direct SDK execution)
- Revokes Google Calendar OAuth token with Google
- Deauthorizes Strava OAuth token with Strava
- Permanently deletes the user record from DynamoDB

Options:
  --athlete-id <id>     Strava Athlete ID to disconnect
  --google-id <id>      Google User ID to disconnect
  --email <email>       User email address to look up and disconnect
  --api-url <url>       Backend API URL (default: 'https://api.clockingsweat.com')
  --direct              Perform revocation and DynamoDB deletion directly via AWS SDK instead of HTTP API
  --profile <profile>   AWS CLI profile (default: env.AWS_PROFILE or 'strava-gcal')
  --region <region>     AWS Region (default: env.AWS_REGION or 'us-east-2')
  --force, -y           Skip interactive confirmation prompt
  --help, -h            Show this help message

Examples:
  node scripts/disconnect-user.js --athlete-id 19851637642
  node scripts/disconnect-user.js --email user@example.com
  node scripts/disconnect-user.js --google-id 103948572910 --api-url http://localhost:3000
  node scripts/disconnect-user.js --athlete-id 123456 --force
`);
    process.exit(0);
}

const REGION = getArg('--region', process.env.AWS_REGION || 'us-east-2');
const PROFILE = getArg('--profile', process.env.AWS_PROFILE || 'strava-gcal');
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'StravaGcal-Users';
const API_URL = getArg('--api-url', process.env.API_URL || 'https://api.clockingsweat.com').replace(/\/$/, '');
const IS_DIRECT = hasFlag('--direct');
const IS_FORCE = hasFlag('--force') || hasFlag('-y');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';

// Set AWS profile if not explicitly set
if (!process.env.AWS_PROFILE && PROFILE) {
    process.env.AWS_PROFILE = PROFILE;
}

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(query, (ans) => {
            rl.close();
            resolve(ans.trim());
        });
    });
}

// Look up user by Google User ID
async function getUserByGoogleId(googleUserId) {
    try {
        const { Item } = await docClient.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { googleUserId }
        }));
        return Item || null;
    } catch (err) {
        throw new Error(`Failed to query DynamoDB by Google ID: ${err.message}`);
    }
}

// Look up user by Strava Athlete ID
async function getUserByAthleteId(athleteId) {
    try {
        const { Items } = await docClient.send(new QueryCommand({
            TableName: USERS_TABLE,
            IndexName: 'StravaAthleteIndex',
            KeyConditionExpression: 'stravaAthleteId = :aid',
            ExpressionAttributeValues: { ':aid': String(athleteId) }
        }));
        return Items && Items.length > 0 ? Items[0] : null;
    } catch (err) {
        throw new Error(`Failed to query DynamoDB by Strava Athlete ID: ${err.message}`);
    }
}

// Look up user by Email
async function getUserByEmail(email) {
    try {
        const { Items } = await docClient.send(new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: '#email = :email',
            ExpressionAttributeNames: { '#email': 'email' },
            ExpressionAttributeValues: { ':email': email }
        }));
        return Items && Items.length > 0 ? Items[0] : null;
    } catch (err) {
        throw new Error(`Failed to scan DynamoDB by email: ${err.message}`);
    }
}

async function findUser() {
    let athleteId = getArg('--athlete-id', null);
    let googleId = getArg('--google-id', null);
    let email = getArg('--email', null);

    if (googleId) {
        console.log(`Looking up user with Google ID: ${googleId}...`);
        return await getUserByGoogleId(googleId);
    }
    if (athleteId) {
        console.log(`Looking up user with Strava Athlete ID: ${athleteId}...`);
        return await getUserByAthleteId(athleteId);
    }
    if (email) {
        console.log(`Looking up user with Email: ${email}...`);
        return await getUserByEmail(email);
    }

    // Interactive prompt
    if (process.stdin.isTTY) {
        console.log('\n--- Identify User to Disconnect ---');
        console.log('1. Enter Strava Athlete ID');
        console.log('2. Enter User Email');
        console.log('3. Enter Google User ID');
        console.log('4. Cancel');

        const choice = await askQuestion('\nSelect option (1-4): ');
        if (choice === '1') {
            const val = await askQuestion('Enter Strava Athlete ID: ');
            if (!val) throw new Error('Athlete ID is required.');
            return await getUserByAthleteId(val);
        } else if (choice === '2') {
            const val = await askQuestion('Enter Email Address: ');
            if (!val) throw new Error('Email is required.');
            return await getUserByEmail(val);
        } else if (choice === '3') {
            const val = await askQuestion('Enter Google User ID: ');
            if (!val) throw new Error('Google User ID is required.');
            return await getUserByGoogleId(val);
        } else {
            console.log('Cancelled.');
            process.exit(0);
        }
    }

    throw new Error('Please specify a user using --athlete-id, --google-id, or --email.');
}

async function disconnectViaHttpApi(user) {
    console.log(`\n[Web UI Simulation] Sending DELETE /user to ${API_URL}/user...`);

    // 1. Generate JWT session token exactly like the backend login flow
    const token = jwt.sign(
        { googleUserId: user.googleUserId },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    console.log(`Signed JWT session token for googleUserId: ${user.googleUserId}`);

    // 2. Call DELETE /user with Bearer auth
    try {
        const response = await axios.delete(`${API_URL}/user`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        console.log(`HTTP Status: ${response.status} ${response.statusText}`);
        console.log('Response Body:', JSON.stringify(response.data, null, 2));

        if (response.data.success) {
            console.log('\n✅ Disconnect succeeded! (Account deleted successfully. All data has been removed!)');
        }
    } catch (err) {
        if (err.response) {
            console.error(`\n❌ API error: HTTP ${err.response.status} - ${JSON.stringify(err.response.data)}`);
            if (err.response.status === 404) {
                console.log('Graceful disconnect note: User record was already deleted or not found in database.');
            }
        } else {
            console.error('\n❌ Network error connecting to API:', err.message);
        }
        throw err;
    }
}

async function disconnectDirect(user) {
    console.log('\n[Direct Execution] Revoking tokens and deleting DynamoDB record directly...');

    const authService = require('../src/services/auth');
    const userRepository = require('../src/repositories/user-repository');

    // Concurrently revoke tokens
    const revocations = [];
    if (user.googleRefreshToken) {
        console.log('Revoking Google OAuth refresh token...');
        revocations.push(authService.revokeGoogleToken(user.googleRefreshToken));
    } else if (user.googleAccessToken) {
        console.log('Revoking Google OAuth access token...');
        revocations.push(authService.revokeGoogleToken(user.googleAccessToken));
    }

    if (user.stravaAccessToken) {
        console.log('Deauthorizing Strava OAuth access token...');
        revocations.push(authService.revokeStravaToken(user.stravaAccessToken));
    }

    const results = await Promise.allSettled(revocations);
    results.forEach((res, i) => {
        if (res.status === 'rejected') {
            console.warn(`Warning during revocation task #${i + 1}:`, res.reason?.message || res.reason);
        }
    });

    // Delete User Record from DynamoDB
    console.log(`Deleting user record for googleUserId: ${user.googleUserId} from table ${USERS_TABLE}...`);
    await userRepository.deleteUser(user.googleUserId);

    console.log('\n✅ User record deleted and tokens revoked successfully.');
}

async function main() {
    console.log('============================================================');
    console.log('       Clocking Sweat — User Disconnect Simulator');
    console.log('============================================================');

    const user = await findUser();
    if (!user) {
        console.error('\n❌ User not found in database.');
        process.exit(1);
    }

    const fullName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || '(none)';
    console.log('\nFound User Record:');
    console.log(`  Name:                ${fullName}`);
    console.log(`  Email:               ${user.email || '(none)'}`);
    console.log(`  Google User ID:      ${user.googleUserId}`);
    console.log(`  Strava Athlete ID:   ${user.stravaAthleteId || '(none)'}`);
    console.log(`  Selected Calendar:   ${user.selectedCalendarId || '(none)'}`);
    console.log(`  Connected Since:     ${user.createdAt || '(unknown)'}`);
    console.log(`  Status:              ${user.disconnected ? `DISCONNECTED (${user.disconnectedProvider})` : 'ACTIVE'}`);

    console.log('\nWeb UI Disconnect Notice:');
    console.log('  • Google Calendar OAuth token will be revoked.');
    console.log('  • Strava synchronization access will be deauthorized.');
    console.log('  • User record and preferences will be permanently removed from DynamoDB.');

    if (!IS_FORCE) {
        const confirm = await askQuestion('\nAre you sure you want to permanently disconnect this user? (yes/no): ');
        if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
            console.log('\nAborted. No changes made.');
            process.exit(0);
        }
    }

    if (IS_DIRECT) {
        await disconnectDirect(user);
    } else {
        await disconnectViaHttpApi(user);
    }
}

main().catch((err) => {
    console.error('\n❌ Disconnect operation failed:', err.message);
    process.exit(1);
});
