const pino = require('pino');
const config = require('./config');

const logger = pino({
    level: config.logLevel,
    serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res
    },
    base: undefined, // Don't log hostname/pid to keep logs clean in lambda/cloudwatch
    timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
