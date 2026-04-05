const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-2' });

/**
 * Sends a support email via AWS SES
 * @param {Object} details
 * @param {string} details.fromEmail - The user's email address
 * @param {string} details.subject - The subject of the message
 * @param {string} details.body - The message body
 * @returns {Promise<void>}
 */
async function sendSupportEmail({ fromEmail, subject, body }) {
    const recipient = process.env.SUPPORT_EMAIL_RECIPIENT;
    
    if (!recipient) {
        logger.error('SUPPORT_EMAIL_RECIPIENT environment variable is not set');
        throw new Error('Contact service unavailable');
    }

    const params = {
        Source: recipient, // SES usually requires the sender to be a verified identity
        Destination: {
            ToAddresses: [recipient],
        },
        ReplyToAddresses: [fromEmail],
        Message: {
            Subject: {
                Data: `[Clocking Sweat Support] ${subject}`,
                Charset: 'UTF-8',
            },
            Body: {
                Text: {
                    Data: `From: ${fromEmail}\n\nMessage:\n${body}`,
                    Charset: 'UTF-8',
                },
            },
        },
    };

    try {
        const command = new SendEmailCommand(params);
        await sesClient.send(command);
        logger.info({ fromEmail, subject }, 'Support email sent successfully');
    } catch (err) {
        logger.error({ err, fromEmail }, 'Failed to send support email via SES');
        throw err;
    }
}

module.exports = {
    sendSupportEmail,
};
