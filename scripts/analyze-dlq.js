#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { SQSClient, GetQueueUrlCommand, GetQueueAttributesCommand, ReceiveMessageCommand, ChangeMessageVisibilityBatchCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

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
        // Ignore parsing errors, fall back to process.env
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
Usage: node scripts/analyze-dlq.js [options]

Options:
  --queue <sync|fetch|name>   Queue to inspect: 'sync' (default), 'fetch', or exact queue name
  --profile <profile>         AWS CLI profile to use (default: env.AWS_PROFILE or 'strava-gcal')
  --region <region>           AWS Region (default: env.AWS_REGION or 'us-east-2')
  --save <filepath>           Save full JSON analysis to file (default: dlq-analysis-<timestamp>.json)
  --no-save                   Skip saving JSON output to disk
  --max-polls <number>        Max consecutive empty polls before stopping (default: 3)
  --help, -h                  Show this help message
`);
    process.exit(0);
}

const REGION = getArg('--region', process.env.AWS_REGION || 'us-east-2');
const PROFILE = getArg('--profile', process.env.AWS_PROFILE || 'strava-gcal');
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'StravaGcal-Users';

// Set AWS profile if not explicitly set in environment
if (!process.env.AWS_PROFILE && PROFILE) {
    process.env.AWS_PROFILE = PROFILE;
}

const sqsClient = new SQSClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const QUEUE_MAP = {
    sync: 'StravaGcal-ActivitySyncDLQ',
    fetch: 'StravaGcal-ActivityFetchDLQ',
};

async function resolveQueueUrl(queueIdentifier) {
    const queueName = QUEUE_MAP[queueIdentifier?.toLowerCase()] || queueIdentifier || QUEUE_MAP.sync;
    try {
        const res = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));
        return { queueName, queueUrl: res.QueueUrl };
    } catch (err) {
        throw new Error(`Failed to resolve queue URL for '${queueName}': ${err.message}`);
    }
}

async function promptQueueSelection() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log('\nSelect the DLQ to analyze:');
        console.log('1. ActivitySyncDLQ  (StravaGcal-ActivitySyncDLQ) [Default]');
        console.log('2. ActivityFetchDLQ (StravaGcal-ActivityFetchDLQ)');
        console.log('3. Cancel');

        rl.question('\nEnter choice (1-3, default 1): ', (choice) => {
            rl.close();
            const trimmed = choice.trim();
            if (trimmed === '2') {
                resolve('fetch');
            } else if (trimmed === '3') {
                console.log('Cancelled.');
                process.exit(0);
            } else {
                resolve('sync');
            }
        });
    });
}

async function getQueueAttributes(queueUrl) {
    try {
        const res = await sqsClient.send(new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['All']
        }));
        return res.Attributes || {};
    } catch (err) {
        console.warn(`Warning: Could not fetch queue attributes: ${err.message}`);
        return {};
    }
}

async function analyze() {
    let queueChoice = getArg('--queue', null);
    if (!queueChoice && process.stdin.isTTY && !hasFlag('--no-prompt')) {
        queueChoice = await promptQueueSelection();
    } else if (!queueChoice) {
        queueChoice = 'sync';
    }

    console.log(`\nConnecting to AWS (Profile: ${process.env.AWS_PROFILE || 'default'}, Region: ${REGION})...`);

    const { queueName, queueUrl } = await resolveQueueUrl(queueChoice);
    console.log(`Analyzing queue: ${queueName}`);
    console.log(`Queue URL:       ${queueUrl}`);

    const attrs = await getQueueAttributes(queueUrl);
    const approxMessages = attrs.ApproximateNumberOfMessages || '0';
    console.log(`Approximate messages visible in DLQ: ${approxMessages}`);

    if (parseInt(approxMessages, 10) === 0) {
        console.log('\n✅ Queue is empty. No DLQ messages to analyze.');
        return;
    }

    console.log('\nSweeping DLQ messages (visibility will be restored after inspection)...');

    const messagesById = new Map();
    const allReceipts = [];
    let emptyPolls = 0;
    const maxEmptyPolls = parseInt(getArg('--max-polls', '3'), 10);

    while (emptyPolls < maxEmptyPolls) {
        try {
            const res = await sqsClient.send(new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: 10,
                VisibilityTimeout: 60, // Temporarily hide message while sweeping
                WaitTimeSeconds: 2,
                AttributeNames: ['All'],
                MessageAttributeNames: ['All']
            }));

            if (!res.Messages || res.Messages.length === 0) {
                emptyPolls++;
                continue;
            }

            emptyPolls = 0;
            let batchNew = 0;
            for (const msg of res.Messages) {
                if (!messagesById.has(msg.MessageId)) {
                    messagesById.set(msg.MessageId, msg);
                    allReceipts.push({ Id: msg.MessageId, ReceiptHandle: msg.ReceiptHandle });
                    batchNew++;
                }
            }
            process.stdout.write(`\rRetrieved ${messagesById.size} unique messages so far...`);
        } catch (err) {
            console.error('\nError receiving SQS messages:', err.message);
            break;
        }
    }
    console.log(`\nFinished receiving. Total unique messages downloaded: ${messagesById.size}`);

    // Restore visibility timeout to 0 so all messages remain available for redrive
    if (allReceipts.length > 0) {
        process.stdout.write('Restoring message visibility in DLQ...');
        for (let i = 0; i < allReceipts.length; i += 10) {
            const chunk = allReceipts.slice(i, i + 10).map((r, idx) => ({
                Id: `msg_${idx}`,
                ReceiptHandle: r.ReceiptHandle,
                VisibilityTimeout: 0
            }));
            try {
                await sqsClient.send(new ChangeMessageVisibilityBatchCommand({
                    QueueUrl: queueUrl,
                    Entries: chunk
                }));
            } catch (err) {
                // SQS batch visibility change might partially fail if message already expired
            }
        }
        console.log(' Done.');
    }

    // Parse and group messages
    const userStats = {};
    const unparseable = [];

    const messagesList = Array.from(messagesById.values()).map(m => {
        let parsedBody = null;
        try {
            parsedBody = JSON.parse(m.Body);
        } catch (e) {
            parsedBody = m.Body;
        }

        const sentTimestamp = parseInt(m.Attributes?.SentTimestamp || '0', 10);
        const approxReceiveCount = parseInt(m.Attributes?.ApproximateReceiveCount || '0', 10);

        if (parsedBody && typeof parsedBody === 'object') {
            const uid = parsedBody.userId ? String(parsedBody.userId) : 'unknown';
            if (!userStats[uid]) {
                userStats[uid] = {
                    athleteId: uid,
                    count: 0,
                    aspectTypes: {},
                    activities: new Set(),
                    receiveCounts: [],
                    earliestSent: null,
                    latestSent: null,
                    sampleErrors: []
                };
            }

            const stat = userStats[uid];
            stat.count++;
            if (parsedBody.aspectType) {
                stat.aspectTypes[parsedBody.aspectType] = (stat.aspectTypes[parsedBody.aspectType] || 0) + 1;
            }
            if (parsedBody.activityId) {
                stat.activities.add(String(parsedBody.activityId));
            }
            if (approxReceiveCount) {
                stat.receiveCounts.push(approxReceiveCount);
            }
            if (sentTimestamp) {
                if (!stat.earliestSent || sentTimestamp < stat.earliestSent) stat.earliestSent = sentTimestamp;
                if (!stat.latestSent || sentTimestamp > stat.latestSent) stat.latestSent = sentTimestamp;
            }
        } else {
            unparseable.push(m);
        }

        return {
            messageId: m.MessageId,
            attributes: m.Attributes,
            body: parsedBody
        };
    });

    // Correlate with DynamoDB Users table
    console.log(`\nQuerying DynamoDB table '${USERS_TABLE}' for athlete metadata...`);
    const athleteEntries = Object.entries(userStats);
    const athleteReports = [];

    for (const [athleteId, stat] of athleteEntries) {
        let userInfo = null;
        if (athleteId !== 'unknown') {
            try {
                const queryRes = await docClient.send(new QueryCommand({
                    TableName: USERS_TABLE,
                    IndexName: 'StravaAthleteIndex',
                    KeyConditionExpression: 'stravaAthleteId = :aid',
                    ExpressionAttributeValues: { ':aid': athleteId }
                }));

                if (queryRes.Items && queryRes.Items.length > 0) {
                    const item = queryRes.Items[0];
                    userInfo = {
                        googleUserId: item.googleUserId,
                        email: item.email || '(none)',
                        name: item.name || `${item.firstName || ''} ${item.lastName || ''}`.trim() || '(none)',
                        selectedCalendarId: item.selectedCalendarId || '(none)',
                        disconnected: !!item.disconnected,
                        disconnectedProvider: item.disconnectedProvider || null,
                        hasGoogleToken: !!item.googleRefreshToken,
                        hasStravaToken: !!item.stravaRefreshToken,
                        createdAt: item.createdAt || null,
                        updatedAt: item.updatedAt || null
                    };
                }
            } catch (err) {
                console.warn(`Warning: Failed to fetch DynamoDB record for athlete ${athleteId}: ${err.message}`);
            }
        }

        const avgReceives = stat.receiveCounts.length > 0
            ? (stat.receiveCounts.reduce((a, b) => a + b, 0) / stat.receiveCounts.length).toFixed(1)
            : 'N/A';

        athleteReports.push({
            athleteId,
            messageCount: stat.count,
            uniqueActivitiesCount: stat.activities.size,
            sampleActivityIds: Array.from(stat.activities).slice(0, 5),
            aspectTypes: stat.aspectTypes,
            avgReceiveCount: avgReceives,
            earliestSentTime: stat.earliestSent ? new Date(stat.earliestSent).toISOString() : null,
            latestSentTime: stat.latestSent ? new Date(stat.latestSent).toISOString() : null,
            userInfo
        });
    }

    // Sort by message count descending
    athleteReports.sort((a, b) => b.messageCount - a.messageCount);

    // Print Formatted Report
    console.log('\n============================================================');
    console.log(`                DLQ ANALYSIS REPORT: ${queueName}`);
    console.log('============================================================');
    console.log(`Total Messages Analyzed:  ${messagesById.size}`);
    console.log(`Impacted Athletes:        ${athleteReports.length}`);
    if (unparseable.length > 0) {
        console.log(`Unparseable Messages:     ${unparseable.length}`);
    }
    console.log('------------------------------------------------------------');

    athleteReports.forEach((rep, idx) => {
        const u = rep.userInfo;
        const statusLabel = u?.disconnected
            ? `DISCONNECTED (${u.disconnectedProvider || 'unknown'})`
            : u ? 'ACTIVE' : 'NOT FOUND IN DB';

        console.log(`\n[#${idx + 1}] Athlete ID: ${rep.athleteId}`);
        if (u) {
            console.log(`     Name:               ${u.name}`);
            console.log(`     Email:              ${u.email}`);
            console.log(`     Google User ID:     ${u.googleUserId}`);
            console.log(`     Selected Calendar:  ${u.selectedCalendarId}`);
            console.log(`     Status:             ${statusLabel}`);
        } else {
            console.log(`     User Database Info: Record not found in ${USERS_TABLE}`);
        }
        console.log(`     DLQ Message Count:  ${rep.messageCount} (${((rep.messageCount / messagesById.size) * 100).toFixed(1)}% of DLQ)`);
        console.log(`     Unique Activities:  ${rep.uniqueActivitiesCount} (Sample IDs: ${rep.sampleActivityIds.join(', ') || 'none'})`);
        console.log(`     Aspect Types:       ${JSON.stringify(rep.aspectTypes)}`);
        console.log(`     Avg SQS Retries:    ${rep.avgReceiveCount}`);
        console.log(`     Earliest Failure:   ${rep.earliestSentTime || 'unknown'}`);
        console.log(`     Latest Failure:     ${rep.latestSentTime || 'unknown'}`);
    });

    console.log('\n============================================================');

    // Save JSON output
    if (!hasFlag('--no-save')) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultSavePath = path.join(process.cwd(), `dlq-analysis-${queueChoice}-${timestamp}.json`);
        const savePath = getArg('--save', defaultSavePath);

        const fullReport = {
            queueName,
            queueUrl,
            analyzedAt: new Date().toISOString(),
            totalMessages: messagesById.size,
            athletes: athleteReports,
            messages: messagesList
        };

        fs.writeFileSync(savePath, JSON.stringify(fullReport, null, 2));
        console.log(`Detailed report saved to: ${savePath}`);
    }
}

analyze().catch(err => {
    console.error('\n❌ Fatal error running DLQ analysis:', err.message);
    process.exit(1);
});
