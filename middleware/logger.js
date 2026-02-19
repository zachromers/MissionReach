const crypto = require('crypto');

// Structured JSON logger with levels

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

const logger = {
  error(message, meta) {
    if (currentLevel >= LOG_LEVELS.error) console.error(formatLog('error', message, meta));
  },
  warn(message, meta) {
    if (currentLevel >= LOG_LEVELS.warn) console.warn(formatLog('warn', message, meta));
  },
  info(message, meta) {
    if (currentLevel >= LOG_LEVELS.info) console.log(formatLog('info', message, meta));
  },
  debug(message, meta) {
    if (currentLevel >= LOG_LEVELS.debug) console.log(formatLog('debug', message, meta));
  },
};

// Express middleware: attach requestId and log completed requests
function requestLogger(req, res, next) {
  req.requestId = crypto.randomBytes(8).toString('hex');
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const meta = {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
    };
    if (req.user) meta.userId = req.user.id;

    if (res.statusCode >= 500) {
      logger.error('request_completed', meta);
    } else if (res.statusCode >= 400) {
      logger.warn('request_completed', meta);
    } else {
      logger.info('request_completed', meta);
    }
  });

  next();
}

module.exports = { logger, requestLogger };
