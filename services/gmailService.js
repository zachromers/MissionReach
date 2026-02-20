const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const { getJwtSecret } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function generateAuthUrl(userId) {
  // Sign the userId into a short-lived JWT so the callback can verify
  // the user without relying on the auth cookie (sameSite=strict blocks it)
  const state = jwt.sign({ userId }, getJwtSecret(), { expiresIn: '10m' });
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

function verifyState(state) {
  const decoded = jwt.verify(state, getJwtSecret(), { algorithms: ['HS256'] });
  return decoded.userId;
}

async function handleCallback(code, userId) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  // Get the Gmail address associated with this token
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  const gmailAddress = data.email || null;

  const db = getDb();
  db.prepare(`
    INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expiry_date, gmail_address, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expiry_date = excluded.expiry_date,
      gmail_address = excluded.gmail_address,
      updated_at = datetime('now')
  `).run(userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date || 0, gmailAddress);

  logger.info('gmail_connected', { userId, gmail: gmailAddress });
  return { email: gmailAddress };
}

function getStoredTokens(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId);
}

function isConnected(userId) {
  return !!getStoredTokens(userId);
}

function getStatus(userId) {
  const row = getStoredTokens(userId);
  if (!row) return { connected: false, email: null };
  return { connected: true, email: row.gmail_address };
}

async function getAuthenticatedClient(userId) {
  const row = getStoredTokens(userId);
  if (!row) throw new Error('Gmail not connected. Please connect your Gmail account in Settings.');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date,
  });

  // Listen for token refresh events and persist updated tokens
  oauth2Client.on('tokens', (tokens) => {
    const db = getDb();
    if (tokens.refresh_token) {
      db.prepare(`
        UPDATE gmail_tokens SET access_token = ?, refresh_token = ?, expiry_date = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date || 0, userId);
    } else {
      db.prepare(`
        UPDATE gmail_tokens SET access_token = ?, expiry_date = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(tokens.access_token, tokens.expiry_date || 0, userId);
    }
  });

  return oauth2Client;
}

function buildRawEmail(from, to, subject, body) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ];
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

async function sendEmail(userId, to, subject, body) {
  const oauth2Client = await getAuthenticatedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const row = getStoredTokens(userId);
  const from = row.gmail_address || 'me';

  const raw = buildRawEmail(from, to, subject, body);

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  logger.info('gmail_sent', { userId, to, messageId: result.data.id });
  return { messageId: result.data.id };
}

async function disconnect(userId) {
  const row = getStoredTokens(userId);
  if (row) {
    // Try to revoke the token with Google
    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials({ access_token: row.access_token });
      await oauth2Client.revokeToken(row.access_token);
    } catch (err) {
      logger.warn('gmail_revoke_failed', { userId, error: err.message });
    }

    const db = getDb();
    db.prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(userId);
    logger.info('gmail_disconnected', { userId });
  }
}

module.exports = { generateAuthUrl, verifyState, handleCallback, isConnected, getStatus, sendEmail, disconnect };
