const http = require('http');
const fs = require('fs');
const path = require('path');
const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// 1. Load Environment Variables
const envPath = path.join(__dirname, '..', 'env.json');
if (fs.existsSync(envPath)) {
    const envConfig = JSON.parse(fs.readFileSync(envPath));

    // Check for nested structure (SAM format)
    let variables = envConfig;
    if (envConfig.StravaSyncFunction) {
        variables = envConfig.StravaSyncFunction;
    } else {
        // Try to find first key that is an object if not StravaSyncFunction, or assume flat
        const firstValue = Object.values(envConfig)[0];
        if (typeof firstValue === 'object' && firstValue !== null) {
            variables = firstValue;
        }
    }

    Object.assign(process.env, variables);

    // Explicitly set Table Name if missing
    if (!process.env.USERS_TABLE_NAME) {
        console.warn("Usage: Ensure USERS_TABLE_NAME is in env.json");
    }
} else {
    console.warn("Warning: env.json not found. Environment variables might be missing.");
}

// 2. Mock DynamoDB Client for Local Dev
const ddbMock = mockClient(DynamoDBDocumentClient);
const localMemDb = new Map();

ddbMock.on(PutCommand).callsFake((input) => {
    localMemDb.set(input.Item.googleUserId, input.Item);
    return {};
});

ddbMock.on(GetCommand).callsFake((input) => {
    const item = localMemDb.get(input.Key.googleUserId);
    return { Item: item };
});

ddbMock.on(QueryCommand).callsFake((input) => {
    // Basic mock for StravaAthleteIndex
    const stravaId = input.ExpressionAttributeValues[':stravaAthleteId'];
    const items = Array.from(localMemDb.values()).filter(user => user.stravaAthleteId === stravaId);
    return { Items: items };
});

// 3. Require App (must happen AFTER env vars are loaded and mocks setup)
const { handler } = require('../src/app');

// 4. Create Server
const server = http.createServer(async (req, res) => {
    // Collect Body
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        // Construct Lambda Event
        const url = new URL(req.url, `http://${req.headers.host}`);
        const routeKey = `${req.method} ${url.pathname}`;

        const event = {
            routeKey,
            rawPath: url.pathname,
            rawQueryString: url.searchParams.toString(),
            headers: {
                ...req.headers,
            },
            body: body || null,
        };

        try {
            console.log(`[${req.method}] ${req.url}`);

            if (req.method === 'GET' && url.pathname === '/test/db') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify(Array.from(localMemDb.entries()), null, 2));
                return;
            }

            const result = await handler(event);

            res.statusCode = result.statusCode || 200;

            if (result.headers) {
                Object.entries(result.headers).forEach(([key, value]) => {
                    res.setHeader(key, value);
                });
            }

            if (!res.getHeader('Access-Control-Allow-Origin')) {
                res.setHeader('Access-Control-Allow-Origin', '*');
            }

            res.end(result.body || '');
        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ message: "Internal Server Error" }));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Local native server running at http://localhost:${PORT}`);
    console.log(`Make sure your env.json contains: USERS_TABLE_NAME, GOOGLE_*, STRAVA_* credentials.`);
});
