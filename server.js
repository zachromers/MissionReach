const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initialize } = require('./db/database');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = 3004;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (no auth required)
app.use('/api/auth', require('./routes/auth'));

// Apply requireAuth to all other /api/* routes
app.use('/api', requireAuth);

// Protected routes
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/outreaches', require('./routes/outreaches'));
app.use('/api/import', require('./routes/import'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/admin'));

// Serve the SPA for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database then start server
initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`MissionReach running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
