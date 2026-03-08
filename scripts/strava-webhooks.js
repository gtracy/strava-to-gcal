const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');

// Load environment variables
const envPath = path.join(__dirname, '..', 'env.json');
let envVerifyToken = null;
if (fs.existsSync(envPath)) {
    const envConfig = JSON.parse(fs.readFileSync(envPath));
    let variables = envConfig;
    if (envConfig.StravaSyncFunction) {
        variables = envConfig.StravaSyncFunction;
    } else {
        const firstValue = Object.values(envConfig)[0];
        if (typeof firstValue === 'object' && firstValue !== null) {
            variables = firstValue;
        }
    }
    Object.assign(process.env, variables);
    envVerifyToken = variables.STRAVA_VERIFY_TOKEN;
} else {
    console.warn("Warning: env.json not found. Environment variables might be missing.");
}

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_VERIFY_TOKEN = envVerifyToken || process.env.STRAVA_VERIFY_TOKEN || 'missing-verify-token';

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.error("Error: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in env.json");
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

async function listSubscriptions() {
    try {
        console.log("Fetching subscriptions...");
        const response = await axios.get('https://www.strava.com/api/v3/push_subscriptions', {
            params: {
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET
            }
        });
        console.log("\nSubscriptions:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Failed to list subscriptions:");
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

async function createSubscription() {
    const callbackUrl = await askQuestion("Enter callback URL (e.g., your ngrok URL + /webhook): ");
    if (!callbackUrl) {
        console.log("Cancelled.");
        return;
    }

    try {
        console.log(`Creating subscription for ${callbackUrl}...`);
        const response = await axios.post('https://www.strava.com/api/v3/push_subscriptions', {
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            callback_url: callbackUrl,
            verify_token: STRAVA_VERIFY_TOKEN
        });
        console.log("\nSubscription created successfully:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Failed to create subscription:");
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

async function deleteSubscription() {
    const subscriptionId = await askQuestion("Enter subscription ID to delete: ");
    if (!subscriptionId) {
        console.log("Cancelled.");
        return;
    }

    try {
        const id = parseInt(subscriptionId, 10);
        console.log(`Deleting subscription ${id}...`);
        const url = `https://www.strava.com/api/v3/push_subscriptions/${id}`;
        const params = {
            client_id: parseInt(STRAVA_CLIENT_ID, 10),
            client_secret: STRAVA_CLIENT_SECRET
        };
        console.log(`URL: ${url}`);
        console.log(`Params: { client_id: ${params.client_id}, client_secret: [REDACTED] }`);

        await axios.delete(url, { params });
        console.log("\nSubscription deleted successfully.");
    } catch (error) {
        console.error("Failed to delete subscription:");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

async function testWebhook() {
    const ownerId = await askQuestion("Enter Strava Athlete ID (owner_id) to mock [default: 12345]: ") || '12345';
    const aspectType = await askQuestion("Enter aspect_type (create, update, delete) [default: create]: ") || 'create';

    const defaultObjectId = Math.floor(Math.random() * 10000000000).toString();
    const objectIdInput = await askQuestion(`Enter Strava Activity ID (object_id) to mock [default: ${defaultObjectId}]: `) || defaultObjectId;
    const objectId = parseInt(objectIdInput, 10) || parseInt(defaultObjectId, 10);

    // Simulate event payload
    const payload = {
        object_type: "activity",
        object_id: objectId,
        aspect_type: aspectType,
        updates: aspectType === 'update' ? { title: "Mock Update" } : {},
        owner_id: parseInt(ownerId, 10),
        subscription_id: 999999,
        event_time: Math.floor(Date.now() / 1000)
    };

    try {
        console.log(`Sending mock payload to local server (http://localhost:3000/webhook)...`);
        const response = await axios.post('http://localhost:3000/webhook', payload);
        console.log("\nWebhook test successful:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Failed to test webhook:");
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

async function testHistoricalSync() {
    const userIdInput = await askQuestion("Enter Strava Athlete ID to backfill [default: 12345]: ") || '12345';
    const userId = parseInt(userIdInput, 10) || parseInt('12345', 10);

    let daysInput = await askQuestion("Enter number of days back to sync (max 60) [default: 30]: ") || '30';
    let days = parseInt(daysInput, 10) || 30;

    if (days > 60) {
        console.log("Days exceeded limit of 60. Clamping to 60.");
        days = 60;
    }

    const payload = {
        userId,
        days
    };

    try {
        console.log(`Sending historical sync request to local server (http://localhost:3000/admin/sync-fetch)...`);
        const response = await axios.post('http://localhost:3000/admin/sync-fetch', payload);
        console.log("\nHistorical sync triggered successfully:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Failed to trigger historical sync:");
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

async function showMenu() {
    while (true) {
        console.log("\n--- Strava Webhooks Dev Script ---");
        console.log("1. List existing webhook setup");
        console.log("2. Create webhook destinations");
        console.log("3. Test the webhook with mock data");
        console.log("4. Test historical fetch/sync (backfill)");
        console.log("5. Delete webhook destinations");
        console.log("6. Exit");

        const answer = await askQuestion("\nChoose an option (1-6): ");

        switch (answer.trim()) {
            case '1':
                await listSubscriptions();
                break;
            case '2':
                await createSubscription();
                break;
            case '3':
                await testWebhook();
                break;
            case '4':
                await testHistoricalSync();
                break;
            case '5':
                await deleteSubscription();
                break;
            case '6':
                console.log("Exiting.");
                rl.close();
                return;
            default:
                console.log("Invalid option, please try again.");
                break;
        }
    }
}

showMenu().catch(console.error);
