const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../db/database');

function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function getContactSummaries() {
  const db = getDb();

  const contacts = db.prepare(`
    SELECT c.*,
      (SELECT MAX(o.date) FROM outreaches o WHERE o.contact_id = c.id) as last_outreach_date,
      (SELECT COUNT(*) FROM outreaches o WHERE o.contact_id = c.id) as outreach_count,
      (SELECT MAX(d.date) FROM donations d WHERE d.contact_id = c.id) as last_donation_date,
      (SELECT COALESCE(SUM(d.amount), 0) FROM donations d WHERE d.contact_id = c.id) as total_donated,
      (SELECT COUNT(*) FROM donations d WHERE d.contact_id = c.id) as donation_count
    FROM contacts c
    ORDER BY c.last_name, c.first_name
  `).all();

  const now = new Date();
  return contacts.map(c => {
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
  });
}

async function processPrompt(userPrompt) {
  const settings = getSettings();
  const apiKey = settings.anthropic_api_key;

  if (!apiKey) {
    throw new Error('Please configure your Anthropic API key in Settings.');
  }

  const contacts = getContactSummaries();
  if (contacts.length === 0) {
    throw new Error('No contacts found. Import or add contacts first.');
  }

  // If large contact list, summarize
  let contactData;
  if (contacts.length > 500) {
    const topContacts = contacts.slice(0, 100);
    const summaryOfRest = contacts.slice(100).map(c => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      relationship: c.relationship,
      days_since_last_contact: c.days_since_last_contact,
      total_donated: c.total_donated,
      donation_count: c.donation_count,
    }));
    contactData = JSON.stringify({ detailed: topContacts, summarized: summaryOfRest });
  } else {
    contactData = JSON.stringify(contacts);
  }

  const systemPrompt = `You are an outreach assistant for a missionary. Your job is to analyze their contact list and recommend specific people to reach out to based on their request.

Here is context about the missionary:
Name: ${settings.missionary_name || 'Not set'}
Context: ${settings.missionary_context || 'Not provided'}

Here is their full contact database with communication and donation history:
${contactData}

When responding, you MUST return valid JSON in this exact format:
{
  "reasoning": "Explanation of how you selected these contacts and why",
  "contacts": [
    {
      "contact_id": <integer>,
      "reason": "Why this specific person was selected",
      "email_draft": {
        "subject": "Email subject line",
        "body": "Full email body — warm, personal, and ministry-appropriate"
      },
      "sms_draft": "Short, casual text message — 2-3 sentences max"
    }
  ]
}

Guidelines for drafts:
- Use the missionary's name as the sender
- Reference specific details about the contact's history where available
- Email tone: warm, professional, grateful, ministry-appropriate
- SMS tone: friendly, casual, brief
- Never be pushy about donations — focus on relationship and gratitude
- If the prompt is about lapsed donors, frame outreach around reconnection, not asking for money`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
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
        FROM contacts c WHERE c.id = ?
      `).get(rec.contact_id);
      if (full) {
        rec.contact = full;
      }
    }
  }

  // Log the prompt
  db.prepare('INSERT INTO ai_prompts (prompt_text, response_summary, contacts_returned) VALUES (?, ?, ?)').run(
    userPrompt,
    parsed.reasoning || '',
    JSON.stringify((parsed.contacts || []).map(c => c.contact_id))
  );

  return parsed;
}

module.exports = { processPrompt };
