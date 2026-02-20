const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const { getDb } = require('../db/database');
const { logger } = require('../middleware/logger');

// Get the app base path for redirects (supports reverse proxy sub-paths)
function getAppBase() {
  return process.env.APP_BASE_PATH || '/';
}

// GET /api/gmail/status — check if current user has Gmail connected
router.get('/status', (req, res) => {
  try {
    const status = gmailService.getStatus(req.user.id);
    res.json(status);
  } catch (err) {
    logger.error('gmail_status_error', { error: err.message });
    res.status(500).json({ error: 'Failed to check Gmail status' });
  }
});

// GET /api/gmail/connect — redirect to Google OAuth consent screen
router.get('/connect', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Gmail integration is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
    }
    const url = gmailService.generateAuthUrl(req.user.id);
    res.redirect(url);
  } catch (err) {
    logger.error('gmail_connect_error', { error: err.message });
    res.status(500).json({ error: 'Failed to start Gmail connection' });
  }
});

// GET /api/gmail/callback — Google redirects here after consent.
// This route is mounted BEFORE requireAuth in server.js because
// sameSite=strict cookies aren't sent on cross-site redirects from Google.
// The signed JWT in the state parameter authenticates the user instead.
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn('gmail_callback_denied', { error });
      return res.redirect(getAppBase() + '?gmail=denied');
    }

    if (!code || !state) {
      return res.redirect(getAppBase() + '?gmail=error');
    }

    // Verify the signed state token to get the userId
    let userId;
    try {
      userId = gmailService.verifyState(state);
    } catch (stateErr) {
      logger.warn('gmail_callback_invalid_state', { error: stateErr.message });
      return res.redirect(getAppBase() + '?gmail=error');
    }

    await gmailService.handleCallback(code, userId);
    res.redirect(getAppBase() + '?gmail=connected');
  } catch (err) {
    logger.error('gmail_callback_error', { error: err.message });
    res.redirect(getAppBase() + '?gmail=error');
  }
});

// POST /api/gmail/send — send an email via Gmail
router.post('/send', async (req, res) => {
  try {
    const { to, subject, body, contactId } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }

    const result = await gmailService.sendEmail(req.user.id, to, subject, body);

    // Optionally log as outreach if contactId is provided
    if (contactId) {
      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO outreaches (contact_id, user_id, mode, subject, content, ai_generated, status)
          VALUES (?, ?, 'email', ?, ?, 0, 'completed')
        `).run(contactId, req.user.id, subject, body);
      } catch (logErr) {
        logger.warn('gmail_outreach_log_failed', { error: logErr.message });
      }
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (err) {
    logger.error('gmail_send_error', { error: err.message });
    if (err.message.includes('not connected')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// POST /api/gmail/disconnect — revoke tokens and remove
router.post('/disconnect', async (req, res) => {
  try {
    await gmailService.disconnect(req.user.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('gmail_disconnect_error', { error: err.message });
    res.status(500).json({ error: 'Failed to disconnect Gmail' });
  }
});

module.exports = router;
