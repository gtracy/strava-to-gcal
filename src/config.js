const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const logger = require('./logger');

let cachedSecrets = null;

async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;

  const secretName = process.env.SECRETS_NAME;
  if (!secretName) {
    logger.debug('SECRETS_NAME not set, using environment variables');
    return {
      STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
      STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      JWT_SECRET: process.env.JWT_SECRET
    };
  }

  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    cachedSecrets = JSON.parse(response.SecretString);
    return cachedSecrets;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException' || error.name === 'AccessDeniedException') {
      logger.warn({ secretName }, 'Secret not found or access denied, falling back to environment variables');
      return {
        STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
        STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        JWT_SECRET: process.env.JWT_SECRET
      };
    }
    logger.error({ err: error }, 'Error fetching secrets from Secrets Manager');
    throw error;
  }
}

const config = {
  getStrava: async () => {
    const secrets = await getSecrets();
    return {
      clientId: secrets.STRAVA_CLIENT_ID,
      clientSecret: secrets.STRAVA_CLIENT_SECRET,
    };
  },
  getGoogle: async () => {
    const secrets = await getSecrets();
    return {
      clientId: secrets.GOOGLE_CLIENT_ID,
      clientSecret: secrets.GOOGLE_CLIENT_SECRET,
    };
  },
  getJwtSecret: async () => {
    const secrets = await getSecrets();
    return secrets.JWT_SECRET;
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
