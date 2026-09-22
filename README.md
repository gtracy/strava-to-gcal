# strava-to-gcal
A bot that listens for Strava activity and pushes events to Google Calendar

## Testing Strategy

### Backend
The backend is tested using **Jest**.
- Run tests: `npm test` (matches `__tests__/**/*.test.js`)
- Mocks external services (Strava, Google Calendar) to ensure valid logic flows.

### Frontend
The frontend (Vite + React) uses a layered testing approach:

1.  **Unit & Integration Tests**: **Vitest** + **React Testing Library**
    *   Fast, headless tests for components and logic.
    *   Run tests: `cd frontend && npm test`
2.  **End-to-End (E2E) Tests**: **Playwright**
    *   Full browser automation to verify critical user journeys.
    *   Run tests: `cd frontend && npm run test:e2e`


## Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v22+)
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials that have access to the deployed stack

### Backend Setup

1. **Configure Environment Variables**:
   Create an `env.json` file in the root directory:
   ```bash
   cp env.json.example env.json
   ```

   Populate it with your credentials. This file is gitignored.

   | Variable | Description | How to get it |
   |---|---|---|
   | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) |
   | `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | Same as above |
   | `STRAVA_CLIENT_ID` | Strava API Application ID | [Strava API Settings](https://www.strava.com/settings/api) |
   | `STRAVA_CLIENT_SECRET` | Strava API Client Secret | Same as above |
   | `STRAVA_VERIFY_TOKEN` | Token for Strava webhook verification | Any string you choose (must match what's configured in Strava) |
   | `JWT_SECRET` | Secret for signing JWT session tokens | Any strong random string |
   | `USERS_TABLE_NAME` | DynamoDB table name | From CDK output or AWS Console |
   | `KMS_KEY_ID` | AWS KMS key ID for encrypting user tokens | See below |
   | `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`) | Optional, defaults to `info` |

2. **Fetch the KMS Key ID**:
   The KMS key encrypts user OAuth tokens in DynamoDB. Using the same key locally ensures you can sign in with the same Google account across local dev and AWS:
   ```bash
   aws kms list-aliases \
     --query "Aliases[?AliasName=='alias/StravaToGcalTokens'].TargetKeyId|[0]" \
     --output text
   ```
   Add the output as `KMS_KEY_ID` in your `env.json`.

3. **Start the Backend**:

   **Against real AWS DynamoDB** (uses your `env.json` credentials and KMS key):
   ```bash
   npm run local
   ```

   **With mock in-memory database** (no AWS access needed, good for UI development):
   ```bash
   npm run local:mock
   ```

   The API will be available at `http://localhost:3000`.

### Frontend Setup

1.  **Configure Environment Variables**:
    Navigate to the `frontend` directory and create a `.env` file:
    ```bash
    cd frontend
    cp .env.example .env
    ```
    Update `VITE_API_URL` to point to your local backend (usually `http://127.0.0.1:3000`).

2.  **Start the Frontend**:
    Install dependencies and run the dev server:
    ```bash
    npm install
    npm run dev
    ```
    The app will run at `http://localhost:5173`.

## Operational & Developer CLI Scripts

The repository includes dedicated CLI utilities in the `scripts/` directory for local development, webhook administration, Dead Letter Queue (DLQ) diagnostics, and user lifecycle management.

### 1. Webhook Administration (`scripts/strava-webhooks.js`)
An interactive CLI tool to manage Strava push subscriptions and trigger backfill syncs.

```bash
npm run webhook-setup
```

**Features:**
- **View Subscriptions:** Inspect active webhook callback URLs and subscription IDs.
- **Create Subscription:** Register a new webhook endpoint with Strava (requires a public HTTPS endpoint, e.g. via `ngrok http 3000`).
- **Delete Subscription:** Clean up stale subscriptions.
- **Test Backfill / Fetch:** Dispatch a test fetch message for a specific athlete ID and date range.

---

### 2. DLQ Diagnostics & Inspection (`scripts/analyze-dlq.js`)
Safely inspects and correlates failed messages in the SQS Dead Letter Queues without losing or consuming them.

> [!NOTE]
> Messages read during inspection have their SQS visibility timeout immediately restored to `0`, leaving them intact for redriving.

```bash
# Interactive mode (prompts for queue selection)
npm run dlq:analyze

# Inspect the Activity Sync DLQ (default)
node scripts/analyze-dlq.js --queue sync

# Inspect the Activity Fetch DLQ
node scripts/analyze-dlq.js --queue fetch

# Custom AWS profile and region with output file
node scripts/analyze-dlq.js --profile strava-gcal --region us-east-2 --save ./dlq-report.json

# Run non-interactively without writing a JSON file to disk
node scripts/analyze-dlq.js --queue sync --no-save
```

**Key Outputs:**
- Aggregate message counts and percentage breakdown by Strava Athlete ID.
- Impacted operation types (`create`, `update`, `delete`).
- List of unique Strava activity IDs that failed.
- Average retry counts prior to DLQ arrival.
- Correlated athlete metadata from DynamoDB (`StravaGcal-Users` via `StravaAthleteIndex`): athlete name, email, Google user ID, selected calendar ID, and account connection status.

---

### 3. DLQ Redrive (`scripts/redrive-dlq.js`)
Moves messages from a Dead Letter Queue back to its primary SQS queue for automated reprocessing once downstream issues are resolved.

```bash
npm run dlq:redrive
```

**Options:**
- `1. ActivityFetchDLQ (StravaGcal-ActivityFetchDLQ)`: Redrives historical backfill jobs back to `StravaGcal-ActivityFetchQueue`.
- `2. ActivitySyncDLQ (StravaGcal-ActivitySyncDLQ)`: Redrives failed calendar sync jobs back to `StravaGcal-ActivitySyncQueue`.

---

### 4. User Disconnect Simulator (`scripts/disconnect-user.js`)
Simulates an athlete disconnecting from Clocking Sweat as if triggered from the web UI:
1. Signs a JWT session token for the athlete's `googleUserId`.
2. Calls `DELETE /user` with bearer authorization against the API (or directly via AWS SDK with `--direct`).
3. Revokes Google Calendar OAuth refresh/access tokens with Google.
4. Deauthorizes Strava OAuth access tokens with Strava.
5. Permanently deletes the athlete's record from the DynamoDB `StravaGcal-Users` table.

```bash
# Interactive mode (prompts for Athlete ID, Email, or Google User ID)
npm run user:disconnect

# Disconnect by Strava Athlete ID
node scripts/disconnect-user.js --athlete-id 19851637642

# Disconnect by user Email address
node scripts/disconnect-user.js --email athlete@example.com

# Disconnect by Google User ID targeting local backend
node scripts/disconnect-user.js --google-id 103948572910 --api-url http://localhost:3000

# Direct mode (uses AWS SDK directly without HTTP API Gateway)
node scripts/disconnect-user.js --athlete-id 19851637642 --direct --force
```

---

### 5. Local Server (`scripts/local-server.js`)
Runs a local Express API server simulating API Gateway and AWS Lambda routes for development.

```bash
# Run against real AWS DynamoDB and KMS (uses env.json credentials)
npm run local

# Run with an in-memory mock database (no AWS credentials required)
npm run local:mock
```

---

## Deployment

### CI/CD Pipeline
Deployments are automated via **GitHub Actions** and use AWS OIDC authentication (`arn:aws:iam::529150585931:role/GitHubActions-CDKDeployRole`).

**Triggers:**
- Pushing a version tag: `git tag v1.2.0 && git push origin v1.2.0`
- Manual dispatch from GitHub Actions UI or CLI: `gh workflow run deploy.yml --ref main`

**Pipeline Steps:**
1. Run backend and frontend test suites.
2. Generate `env.json` from repository secrets.
3. Validate presence of all required secrets before deployment.
4. Build production frontend assets.
5. Assume deployment IAM role via OIDC and deploy CloudFormation infrastructure via CDK.

### Required GitHub Secrets
Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `STRAVA_CLIENT_ID` | Strava API application ID |
| `STRAVA_CLIENT_SECRET` | Strava API client secret |
| `STRAVA_REFRESH_TOKEN` | Strava refresh token |
| `STRAVA_VERIFY_TOKEN` | Strava webhook verification token |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `KMS_KEY_ID` | AWS KMS key ID for token encryption |
| `ALERT_EMAIL` | Email for CloudWatch alarms and user support |
| `RECAPTCHA_SECRET_KEY` | Secret key for Google reCAPTCHA v3 verification |
| `AWS_REGION` | AWS region (e.g., `us-east-2`) |

## System Architecture
![Architecture Diagram](./docs/architecture.png)