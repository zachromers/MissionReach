const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../db/database');

function getSettings(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(userId);
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

const MAX_CONTACTS_TO_SEND = 50;

const MODEL_MAP = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-6',
};

/**
 * Pre-filter contacts based on the user's natural language prompt.
 * Applies SQL-level filters using keyword detection, then caps results.
 */
function preFilterContacts(userPrompt, excludeIds = [], userId) {
  const db = getDb();
  const prompt = userPrompt.toLowerCase();

  let where = ['c.user_id = ?'];
  let orderBy = 'c.last_name, c.first_name';
  let limit = MAX_CONTACTS_TO_SEND;
  const params = [userId];

  // Exclude already-recommended contacts
  if (excludeIds.length > 0) {
    where.push(`c.id NOT IN (${excludeIds.map(() => '?').join(',')})`);
    params.push(...excludeIds);
  }

  // --- Keyword-based filter rules ---

  // "haven't contacted", "not contacted", "no contact", "stale", "haven't reached"
  const staleMatch = prompt.match(/(\d+)\+?\s*months?/);
  if (/haven.?t (contacted|reached)|no contact|not contacted|stale/i.test(prompt)) {
    const days = staleMatch ? parseInt(staleMatch[1]) * 30 : 90;
    where.push(`(
      NOT EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.date >= datetime('now', '-' || ? || ' days'))
    )`);
    params.push(days);
    orderBy = 'last_outreach_date ASC NULLS FIRST';
  }

  // "never contacted", "never reached out", "no outreach"
  if (/never (contacted|reached|called)|no outreach/i.test(prompt)) {
    where.push(`NOT EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id)`);
  }

  // "new contacts", "recently added", "added in the last"
  if (/new contact|recently added|added in the last/i.test(prompt)) {
    const daysMatch = prompt.match(/(\d+)\s*days?/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 30;
    where.push(`c.created_at >= datetime('now', '-' || ? || ' days')`);
    params.push(days);
    orderBy = 'c.created_at DESC';
  }

  // "lapsed donor", "stopped giving", "stopped donating", "used to give/donate"
  if (/lapsed|stopped (giving|donat)|used to (give|donate)/i.test(prompt)) {
    where.push(`(SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) > 0`);
    where.push(`NOT EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= datetime('now', '-6 months'))`);
    orderBy = '(SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) DESC';
  }

  // "top donor", "biggest donor", "most generous", "most consistent"
  if (/top donor|biggest donor|most (generous|consistent)|highest/i.test(prompt)) {
    where.push(`(SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) > 0`);
    orderBy = '(SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) DESC';
  }

  // "donated once", "one-time donor", "donated.*never again"
  if (/donated once|one.?time donor|donated.*never again|gave once/i.test(prompt)) {
    where.push(`(SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) = 1`);
  }

  // "gave last month", "donated last month", "recent donor", "gave recently"
  if (/gave (last month|recently)|donated (last month|recently)|recent donor/i.test(prompt)) {
    where.push(`EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= datetime('now', '-30 days'))`);
    orderBy = '(SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) DESC';
  }

  // "never donated", "non-donor", "haven't donated", "no donations"
  if (/never donated|non.?donor|haven.?t donated|no donation/i.test(prompt)) {
    where.push(`NOT EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id)`);
  }

  // General "donor" mentions (but not "non-donor" or "never donated") — scope to contacts with donations
  if (/donor|donated|giving|gave|donation/i.test(prompt) && !/never donated|non.?donor|haven.?t donated|no donation/i.test(prompt) && where.length === 1) {
    where.push(`(SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) > 0`);
  }

  // "haven't thanked", "should thank", "thank"
  if (/thank/i.test(prompt)) {
    where.push(`(SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) > 0`);
    orderBy = '(SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) DESC';
  }

  // "only emailed", "never called"
  if (/only emailed|never called/i.test(prompt)) {
    where.push(`NOT EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.mode = 'call')`);
    where.push(`EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.mode = 'email')`);
  }

  // "only.*once.*never followed up", "reached out.*once"
  if (/only.*once|reached out.*once|one outreach/i.test(prompt)) {
    where.push(`(SELECT COUNT(*) FROM outreaches o WHERE o.contact_id = c.id) = 1`);
  }

  // "this year" / "last year" donation scoping
  const currentYear = new Date().getFullYear();
  if (/this year/i.test(prompt) && /donor|donated|gave|giving/i.test(prompt)) {
    where.push(`EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= '${currentYear}-01-01')`);
  }
  if (/last year.*haven.?t.*this year|last year.*not.*this year/i.test(prompt)) {
    where.push(`EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= '${currentYear - 1}-01-01' AND d.date < '${currentYear}-01-01')`);
    where.push(`NOT EXISTS (SELECT 1 FROM donations d WHERE d.contact_id = c.id AND d.date >= '${currentYear}-01-01')`);
  }

  // "visit in person", "in my area", "local"
  if (/visit|in.?person|in my area|local/i.test(prompt)) {
    where.push(`c.city IS NOT NULL AND c.city != ''`);
  }

  // "end of the quarter", "quarter" — contacts not contacted this quarter
  if (/quarter/i.test(prompt)) {
    const month = new Date().getMonth();
    const qStart = new Date(currentYear, Math.floor(month / 3) * 3, 1).toISOString().split('T')[0];
    where.push(`NOT EXISTS (SELECT 1 FROM outreaches o WHERE o.contact_id = c.id AND o.date >= '${qStart}')`);
  }

  // Build the query
  const whereClause = 'WHERE ' + where.join(' AND ');

  const sql = `
    SELECT c.*,
      (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
      (SELECT COUNT(*) FROM outreaches o WHERE o.contact_id = c.id) as outreach_count,
      (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated,
      (SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) as donation_count
    FROM contacts c
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  params.push(limit);

  const contacts = db.prepare(sql).all(...params);

  const now = new Date();
  return {
    contacts: contacts.map(c => {
      const daysSinceContact = c.last_outreach_date
        ? Math.floor((now - new Date(c.last_outreach_date)) / (1000 * 60 * 60 * 24))
        : null;
      const daysSinceDonation = c.last_donation_date
        ? Math.floor((now - new Date(c.last_donation_date)) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        organization: c.organization,
        relationship: c.relationship,
        tags: c.tags,
        notes: c.notes,
        last_outreach_date: c.last_outreach_date,
        days_since_last_contact: daysSinceContact,
        outreach_count: c.outreach_count,
        last_donation_date: c.last_donation_date,
        days_since_last_donation: daysSinceDonation,
        total_donated: c.total_donated,
        donation_count: c.donation_count,
      };
    }),
    filterApplied: where.length > 1,
  };
}

async function processPrompt(userPrompt, excludeIds = [], userId) {
  const settings = getSettings(userId);
  const apiKey = process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key;

  if (!apiKey) {
    throw new Error('Please configure your Anthropic API key in Settings.');
  }

  const { contacts, filterApplied } = preFilterContacts(userPrompt, excludeIds, userId);
  if (contacts.length === 0) {
    throw new Error('No contacts found matching your query. Try a different prompt or add more contacts.');
  }

  const contactData = JSON.stringify(contacts);

  const systemPrompt = `You are an outreach assistant for a missionary. Your job is to analyze their contact list and recommend specific people to reach out to based on their request.

Here is context about the missionary:
Name: ${settings.missionary_name || 'Not set'}
Context: ${settings.missionary_context || 'Not provided'}

Here ${filterApplied ? 'are the pre-filtered contacts most relevant to the request' : 'is their contact database'} (${contacts.length} contacts):
${contactData}

When responding, you MUST return valid JSON in this exact format:
{
  "reasoning": "Explanation of how you selected these contacts and why",
  "contacts": [
    {
      "contact_id": <integer>,
      "reason": "Why this specific person was selected"
    }
  ]
}

Guidelines:
- Select the most relevant contacts based on the user's request
- Provide a clear, specific reason for each contact
- Focus on relationship context and outreach history`;

  const client = new Anthropic({ apiKey });
  const modelKey = settings.claude_model || 'sonnet';
  const model = MODEL_MAP[modelKey] || MODEL_MAP.sonnet;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const responseText = response.content[0].text;

  // Try to parse JSON from the response
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { raw: responseText, error: true, message: 'Could not parse AI response as JSON' };
      }
    } else {
      return { raw: responseText, error: true, message: 'Could not parse AI response as JSON' };
    }
  }

  // Enrich contacts with full details from db
  const db = getDb();
  if (parsed.contacts) {
    for (const rec of parsed.contacts) {
      const full = db.prepare(`
        SELECT c.*,
          (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
          (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date,
          (SELECT d.amount FROM donations d WHERE d.contact_id = c.id ORDER BY d.date DESC LIMIT 1) as last_donation_amount,
          (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated
        FROM contacts c WHERE c.id = ? AND c.user_id = ?
      `).get(rec.contact_id, userId);
      if (full) {
        rec.contact = full;
      }
    }
  }

  // Log the prompt
  db.prepare('INSERT INTO ai_prompts (prompt_text, response_summary, contacts_returned, user_id) VALUES (?, ?, ?, ?)').run(
    userPrompt,
    parsed.reasoning || '',
    JSON.stringify((parsed.contacts || []).map(c => c.contact_id)),
    userId
  );

  return parsed;
}

async function generateWarmthScores({ forceAll = false, userId } = {}) {
  const settings = getSettings(userId);
  const apiKey = process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key;
  if (!apiKey) return { updated: false };

  const db = getDb();

  // Find contacts to score — all contacts if forceAll, otherwise only stale/missing
  const sql = `
    SELECT c.id, c.first_name, c.last_name, c.relationship, c.tags,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated,
      (SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) as donation_count,
      (SELECT CAST(julianday('now') - julianday(MAX(d.date)) AS INTEGER) FROM donations d WHERE d.contact_id = c.id) as days_since_last_donation,
      (SELECT COUNT(*) FROM outreaches o WHERE o.contact_id = c.id) as outreach_count,
      (SELECT CAST(julianday('now') - julianday(MAX(o.date)) AS INTEGER) FROM outreaches o WHERE o.contact_id = c.id) as days_since_last_contact
    FROM contacts c
    WHERE c.user_id = ?
    ${forceAll ? '' : "AND (c.warmth_score_updated_at IS NULL OR c.warmth_score_updated_at < datetime('now', '-24 hours'))"}
  `;
  const staleContacts = db.prepare(sql).all(userId);

  if (staleContacts.length === 0) return { updated: false, count: 0 };

  const client = new Anthropic({ apiKey });
  const BATCH_SIZE = 30;
  let totalUpdated = 0;

  for (let i = 0; i < staleContacts.length; i += BATCH_SIZE) {
    const batch = staleContacts.slice(i, i + BATCH_SIZE);
    const contactSummaries = batch.map(c => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      relationship: c.relationship,
      tags: c.tags,
      total_donated: c.total_donated,
      donation_count: c.donation_count,
      days_since_last_donation: c.days_since_last_donation,
      outreach_count: c.outreach_count,
      days_since_last_contact: c.days_since_last_contact,
    }));

    try {
      const response = await client.messages.create({
        model: MODEL_MAP.haiku,
        max_tokens: 4096,
        system: `You score missionary contacts on how likely they are to donate today, 1-5 scale:
1 = Very unlikely (no relationship/history, never donated)
2 = Unlikely (minimal engagement)
3 = Moderate (some history, could go either way)
4 = Likely (active relationship, recent engagement)
5 = Very likely (strong donor, recent activity, warm relationship)

For each contact, also provide a one-sentence reason explaining why you gave that score.
You MUST return a score for EVERY contact provided. Do not skip any.

Return ONLY valid JSON: { "scores": [{ "id": <contact_id>, "score": <1-5>, "reason": "<one sentence explanation>" }] }`,
        messages: [{ role: 'user', content: `Score these contacts:\n${JSON.stringify(contactSummaries)}` }],
      });

      const text = response.content[0].text;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      if (parsed && parsed.scores) {
        const updateStmt = db.prepare('UPDATE contacts SET warmth_score = ?, warmth_score_reason = ?, warmth_score_updated_at = datetime(\'now\') WHERE id = ?');
        for (const entry of parsed.scores) {
          const score = Math.max(1, Math.min(5, Math.round(entry.score)));
          updateStmt.run(score, entry.reason || null, entry.id);
          totalUpdated++;
        }
      }
    } catch (err) {
      console.error('Warmth score batch error:', err.message);
    }
  }

  return { updated: true, count: totalUpdated };
}

async function generateSingleWarmthScore(contactId, userId) {
  const settings = getSettings(userId);
  const apiKey = process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key;
  if (!apiKey) return;

  const db = getDb();

  const c = db.prepare(`
    SELECT c.id, c.first_name, c.last_name, c.relationship, c.tags,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated,
      (SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) as donation_count,
      (SELECT CAST(julianday('now') - julianday(MAX(d.date)) AS INTEGER) FROM donations d WHERE d.contact_id = c.id) as days_since_last_donation,
      (SELECT COUNT(*) FROM outreaches o WHERE o.contact_id = c.id) as outreach_count,
      (SELECT CAST(julianday('now') - julianday(MAX(o.date)) AS INTEGER) FROM outreaches o WHERE o.contact_id = c.id) as days_since_last_contact
    FROM contacts c
    WHERE c.id = ? AND c.user_id = ?
  `).get(contactId, userId);

  if (!c) return;

  const client = new Anthropic({ apiKey });

  try {
    const contactSummary = {
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      relationship: c.relationship,
      tags: c.tags,
      total_donated: c.total_donated,
      donation_count: c.donation_count,
      days_since_last_donation: c.days_since_last_donation,
      outreach_count: c.outreach_count,
      days_since_last_contact: c.days_since_last_contact,
    };

    const response = await client.messages.create({
      model: MODEL_MAP.haiku,
      max_tokens: 256,
      system: `You score missionary contacts on how likely they are to donate today, 1-5 scale:
1 = Very unlikely (no relationship/history, never donated)
2 = Unlikely (minimal engagement)
3 = Moderate (some history, could go either way)
4 = Likely (active relationship, recent engagement)
5 = Very likely (strong donor, recent activity, warm relationship)

For each contact, also provide a one-sentence reason explaining why you gave that score.

Return ONLY valid JSON: { "scores": [{ "id": <contact_id>, "score": <1-5>, "reason": "<one sentence explanation>" }] }`,
      messages: [{ role: 'user', content: `Score this contact:\n${JSON.stringify(contactSummary)}` }],
    });

    const text = response.content[0].text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    }

    if (parsed && parsed.scores && parsed.scores[0]) {
      const score = Math.max(1, Math.min(5, Math.round(parsed.scores[0].score)));
      const reason = parsed.scores[0].reason || null;
      db.prepare('UPDATE contacts SET warmth_score = ?, warmth_score_reason = ?, warmth_score_updated_at = datetime(\'now\') WHERE id = ?').run(score, reason, contactId);
    }
  } catch (err) {
    console.error('Single warmth score error:', err.message);
  }
}

async function generateOutreachDraft(contactId, mode, userId) {
  const settings = getSettings(userId);
  const apiKey = process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key;

  if (!apiKey) {
    throw new Error('Please configure your Anthropic API key in Settings.');
  }

  const db = getDb();

  const contact = db.prepare(`
    SELECT c.*,
      (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated,
      (SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) as donation_count,
      (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date
    FROM contacts c WHERE c.id = ? AND c.user_id = ?
  `).get(contactId, userId);

  if (!contact) {
    throw new Error('Contact not found.');
  }

  const outreaches = db.prepare(
    'SELECT mode, subject, content, date FROM outreaches WHERE contact_id = ? ORDER BY date DESC LIMIT 10'
  ).all(contactId);

  const donations = db.prepare(
    'SELECT amount, date, method FROM donations WHERE contact_id = ? ORDER BY date DESC LIMIT 10'
  ).all(contactId);

  const contactData = {
    name: `${contact.first_name} ${contact.last_name}`,
    email: contact.email,
    phone: contact.phone,
    organization: contact.organization,
    relationship: contact.relationship,
    tags: contact.tags,
    notes: contact.notes,
    last_outreach_date: contact.last_outreach_date,
    total_donated: contact.total_donated,
    donation_count: contact.donation_count,
    last_donation_date: contact.last_donation_date,
    recent_outreaches: outreaches,
    recent_donations: donations,
  };

  const modeLabel = mode || 'email';

  const modeGuidance = {
    email: 'Write a warm, professional email. Include a subject line. Tone: grateful, ministry-appropriate, personal.',
    sms: 'Write a short, casual text message — 2-3 sentences max. Friendly and brief.',
    video: 'Write a scripted video message (1-2 minutes when spoken aloud). Personal, heartfelt, and conversational — as if recording a personal video for this person. Include natural pauses and transitions.',
    call: 'Write a call script with talking points and suggested flow. Include an opening, key points to cover, and a natural closing. Keep it conversational, not robotic.',
  };

  const systemPrompt = `You are an outreach assistant for a missionary. Generate a draft ${modeLabel} message for a specific contact.

Here is context about the missionary:
Name: ${settings.missionary_name || 'Not set'}
Context: ${settings.missionary_context || 'Not provided'}

Here is the contact's information:
${JSON.stringify(contactData, null, 2)}

${modeGuidance[modeLabel] || modeGuidance.email}

Reference specific details about their history when available.

Guidelines:
- Use the missionary's name as the sender
- Never be pushy about donations — focus on relationship and gratitude
- If the contact is a lapsed donor, frame outreach around reconnection, not asking for money

Return ONLY valid JSON in this exact format:
{
  "subject": "Email subject line (leave empty string for non-email modes)",
  "content": "The full message body"
}`;

  const client = new Anthropic({ apiKey });
  const modelKey = settings.claude_model || 'sonnet';
  const model = MODEL_MAP[modelKey] || MODEL_MAP.sonnet;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Write a ${modeLabel} draft for ${contact.first_name} ${contact.last_name}.` }],
  });

  const responseText = response.content[0].text;

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not parse AI response.');
    }
  }

  return { subject: parsed.subject || '', content: parsed.content || '' };
}

module.exports = { processPrompt, generateWarmthScores, generateSingleWarmthScore, generateOutreachDraft };
