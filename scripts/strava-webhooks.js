const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');

// Load environment variables
const envPath = path.join(__dirname, '..', 'env.json');
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
} else {
    console.warn("Warning: env.json not found. Environment variables might be missing.");
}

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || 'local-dev-verify-token';

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
        console.log(`Deleting subscription ${subscriptionId}...`);
        await axios.delete(`https://www.strava.com/api/v3/push_subscriptions/${subscriptionId}`, {
            data: {
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET
            }
        });
        console.log("\nSubscription deleted successfully.");
    } catch (error) {
        console.error("Failed to delete subscription:");
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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

async function showMenu() {
    while (true) {
        console.log("\n--- Strava Webhooks Dev Script ---");
        console.log("1. List existing webhook setup");
        console.log("2. Create webhook destinations");
        console.log("3. Test the webhook with mock data");
        console.log("4. Delete webhook destinations");
        console.log("5. Exit");

        const answer = await askQuestion("\nChoose an option (1-5): ");

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
                await deleteSubscription();
                break;
            case '5':
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
