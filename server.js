require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initialize, flushAndClose, getDb } = require('./db/database');
const { requireAuth, requirePasswordChanged } = require('./middleware/auth');
const { logger, requestLogger } = require('./middleware/logger');

const app = express();
const PORT = process.env.PORT || 3004;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
      connectSrc: ["'self'"],
      formAction: ["'self'", "https://accounts.google.com"],
    },
  },
}));

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting on AI endpoints (per-user via IP, more generous)
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 AI requests per 15 minutes
  message: { error: 'Too many AI requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiting (generous, catches abuse)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per 15 minutes
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// CSRF protection: require X-Requested-With header on state-changing API requests.
// Browsers won't send this header from cross-origin form submissions.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!req.headers['x-requested-with']) {
      return res.status(403).json({ error: 'Forbidden: missing required header' });
    }
  }
  next();
});

// Reject request body string fields exceeding max length (DoS protection)
const MAX_FIELD_LENGTH = 50000;
app.use('/api', (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string' && value.length > MAX_FIELD_LENGTH) {
        return res.status(400).json({ error: `Field "${key}" exceeds maximum length` });
      }
    }
  }
  next();
});

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('SELECT 1 as ok').get();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: result && result.ok === 1 ? 'connected' : 'error',
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database unavailable',
    });
  }
});

// Auth routes (no auth required, but rate-limited)
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', require('./routes/auth'));

// Apply requireAuth and general rate limiting to all other /api/* routes
app.use('/api', requireAuth);
app.use('/api', apiLimiter);

// Block access to protected resources until the user changes their default password.
// Auth routes (/api/auth/password, /api/auth/me) are exempt because they're
// mounted above before requireAuth is applied.
app.use('/api', requirePasswordChanged);

// AI routes get additional stricter rate limiting
app.use('/api/ai', aiLimiter);

// Protected routes
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/outreaches', require('./routes/outreaches'));
app.use('/api/import', require('./routes/import'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/gmail', require('./routes/gmail'));
app.use('/api/admin', require('./routes/admin'));

// Serve the SPA for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database then start server
let server;
initialize().then(() => {
  server = app.listen(PORT, () => {
    logger.info('server_started', { port: PORT, url: `http://localhost:${PORT}` });
  });
}).catch(err => {
  logger.error('database_init_failed', { error: err.message });
  process.exit(1);
});

// Graceful shutdown handler
function shutdown(signal) {
  logger.info('shutdown_initiated', { signal });
  flushAndClose();
  if (server) {
    server.close(() => {
      logger.info('server_closed');
      process.exit(0);
    });
    // Force exit after 5 seconds if server hasn't closed
    setTimeout(() => {
      logger.warn('forced_shutdown');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
