const fs = require('fs');
const path = require('path');
const { SecretsManagerClient, PutSecretValueCommand, CreateSecretCommand, DescribeSecretCommand } = require('@aws-sdk/client-secrets-manager');

const secretName = 'StravaToGcalAppSecrets';

async function syncSecrets(filePath) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found at ${fullPath}`);
        process.exit(1);
    }

    const fileContent = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    // Usually env.json has a top-level key like "StravaSyncFunction"
    const secrets = fileContent.StravaSyncFunction || fileContent;

    // Prioritize AWS_REGION from the config file, then environment variable, then default
    const region = secrets.AWS_REGION || process.env.AWS_REGION || 'us-east-1';
    const client = new SecretsManagerClient({ region });

    const filteredSecrets = {
        STRAVA_CLIENT_ID: secrets.STRAVA_CLIENT_ID,
        STRAVA_CLIENT_SECRET: secrets.STRAVA_CLIENT_SECRET,
        GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET,
        JWT_SECRET: secrets.JWT_SECRET || 'dev-secret-key-change-me'
    };

    console.log(`Syncing secrets to AWS Secrets Manager (${secretName}) in ${region}...`);

    try {
        // Check if secret exists
        try {
            await client.send(new DescribeSecretCommand({ SecretId: secretName }));
            // Exists, update it
            await client.send(new PutSecretValueCommand({
                SecretId: secretName,
                SecretString: JSON.stringify(filteredSecrets)
            }));
            console.log('Successfully updated secret.');
        } catch (err) {
            if (err.name === 'ResourceNotFoundException') {
                // Doesn't exist, create it
                await client.send(new CreateSecretCommand({
                    Name: secretName,
                    SecretString: JSON.stringify(filteredSecrets)
                }));
                console.log('Successfully created secret.');
            } else {
                throw err;
            }
        }
    } catch (error) {
        console.error('Error syncing secrets:', error.message);
        process.exit(1);
    }
}

const args = process.argv.slice(2);
const fileArgIdx = args.indexOf('--file');
const filePath = fileArgIdx !== -1 ? args[fileArgIdx + 1] : 'env.json';

syncSecrets(filePath);
