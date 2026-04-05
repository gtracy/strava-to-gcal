# Strava-to-GCal Multi-User Production Launch Tasks

This document outlines the required activities to transition the current personal/MVP project into a production-ready application capable of handling multiple external users securely and reliably.

## 1. Legal & Compliance
- [x] **Privacy Policy & Terms of Service:** Draft and publish a privacy policy and TOS. This is strictly required by both Google and Strava to verify your OAuth applications.
- [x] **Google OAuth Verification:** Submit the app for Google Trust & Safety verification to remove the "Unverified App" warning and increase the 100-test-user cap. Requires a verified domain and the privacy policy.
- [ ] **Strava API Review:** Submit the app for Strava review to increase rate limits (default is limited to 100 requests/15 min, 1,000/day).
- [x] **Compliant OAuth App Name:** Update the application name in both the Google Cloud Console and Strava API settings to remove "Strava" from the title (e.g., use "Activity Sync" instead).
- [x] **Strava Integration Rules:** Conform to the Strava API brand guidelines and integration rules (e.g. "Connect with Strava" buttons, linking back to Strava).
- [x] **Google Integration Rules:** Conform to the Google API Services User Data Policy and brand guidelines.

## 2. Infrastructure & Networking
- [x] **Resource Naming:** Cleanup the naming conventions for resources so they are more identifiable and self-describe their purpose.
- [x] **Dead Letter Queues (DLQ):** Add DLQs to the `ActivitySyncQueue` and `ActivityFetchQueue` in the CDK stack to catch failed syncing jobs without losing data.
- [x] **CI/CD:** Set up a GitHub Action for auto-deployments.
- [x] **Architecture Diagram:** Build an architecture diagram and add it to the README.
- [x] **Custom Domains & SSL:** 
  - Set up a custom domain.
  - Set up CloudFront with OAC (Origin Access Control) for the frontend S3 bucket instead of public S3 access (better security).
  - Set up API Gateway Custom Domain with ACM certificates for the API endpoints.
- [x] **API Rate Limiting:** Configure API Gateway Usage Plans or standard rate limiting to prevent abuse on authentication and webhook endpoints.
- [x] **CloudWatch Monitoring & Alarms:** Set up basic alarms for Lambda error rates and DLQ message counts, connected to an SNS topic that emails the administrator.

## 3. Application Resiliency & Error Handling
- [x] **Token Revocation Handling:** Ensure the application gracefully handles user token revocation (e.g., if a user revokes access via Google or Strava, mark the user state as "disconnected" instead of continually failing background jobs).
- [x] **Strava Rate Limit Backoff:** Implement aware rate-limiting or backoff in the workers (`ActivityFetchWorker` and `ActivitySyncWorker`) in case Strava's limits are breached during high load.
- [x] **Idempotent Webhooks:** Ensure webhook events don't duplicate calendar events if processed multiple times (useful if a queue message is retried).
- [ ] **Automatic Lookback Sync:** Automatically trigger a 90-day historical activity fetch/sync immediately after a new user connects their Strava account.

## 4. Frontend Polish & User Experience
- [ ] **Landing Page Content:** Create content on the current landing page that shows off examples of the service to new, unauthenticated users.
- [x] **Support/FAQ:** Add a page or section to help users troubleshoot issues (e.g., "Why didn't my activity sync?").
- [x] **Donations:** Integrate donation options for users.
- [x] **Footer:** Create a footer that includes references to the creator, the GitHub repo, and the creator's Threads account.
- [x] **Google Analytics:** Implement Google Analytics to track site traffic and usage.
- [x] **Favicon:** Add a custom favicon for the site.

## 5. Security Posture
- [x] **Frontend Security:** Implement proper Content Security Policy (CSP) headers.
- [x] **Dependency Scanning:** Integrate Dependabot or similar automated vulnerability scanning in GitHub Actions.
