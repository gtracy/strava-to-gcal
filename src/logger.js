const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res
    },
    base: undefined, // Don't log hostname/pid to keep logs clean in lambda/cloudwatch
    timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
