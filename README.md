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
- [Docker](https://www.docker.com/) (required for SAM local)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [Node.js](https://nodejs.org/) (v22+)

### Backend Setup

1.  **Configure Environment Variables**:
    Create a `env.json` file in the root directory based on the example:
    ```bash
    cp env.json.example env.json
    ```
    Populate it with your Google and Strava credentials. This file is gitignored.

2.  **Start the Backend**:
    Run the following command to start the Lambda functions locally:
    ```bash
    sam local start-api -n env.json
    ```
    ```
    The API will be available at `http://127.0.0.1:3000`.

    **Alternative (Faster/No Docker):**
    You can run the backend natively using a simple Node.js wrapper:
    ```bash
    npm run local
    ```
    This reads from `env.json` and runs `src/app.js` directly. Use this for rapid iteration.

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
