const { KMSClient, EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const logger = require('../logger');

const kmsClient = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const keyId = process.env.KMS_KEY_ID;

async function encrypt(text) {
    if (!text) return null;
    if (!keyId) {
        logger.debug('KMS_KEY_ID not set, skipping encryption');
        return text;
    }

    try {
        const command = new EncryptCommand({
            KeyId: keyId,
            Plaintext: Buffer.from(text),
        });
        const response = await kmsClient.send(command);
        return Buffer.from(response.CiphertextBlob).toString('base64');
    } catch (error) {
        logger.error({ err: error }, 'KMS Encryption failed');
        throw error;
    }
}

async function decrypt(ciphertextBase64) {
    if (!ciphertextBase64) return null;
    if (!keyId) {
        logger.debug('KMS_KEY_ID not set, skipping decryption');
        return ciphertextBase64;
    }

    try {
        const command = new DecryptCommand({
            CiphertextBlob: Buffer.from(ciphertextBase64, 'base64'),
        });
        const response = await kmsClient.send(command);
        return Buffer.from(response.Plaintext).toString();
    } catch (error) {
        // If it's not actually encrypted (e.g. migration period), we might want to handle it
        // but for now, we'll assume it should be encrypted.
        logger.error({ err: error }, 'KMS Decryption failed');
        throw error;
    }
}

module.exports = { encrypt, decrypt };
