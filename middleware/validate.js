// Server-side validation helpers for all entity types

function stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

function sanitizeString(str, maxLength = 500) {
  if (str == null) return null;
  if (typeof str !== 'string') str = String(str);
  const stripped = str.replace(/<[^>]*>/g, '').trim();
  return stripped.length > maxLength ? stripped.substring(0, maxLength) : stripped;
}

function isValidDate(str) {
  if (!str) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function isPositiveNumber(val) {
  const num = Number(val);
  return !isNaN(num) && num > 0;
}

const VALID_OUTREACH_MODES = ['email', 'sms', 'call', 'letter', 'in_person', 'social_media', 'video', 'other'];
const VALID_OUTREACH_DIRECTIONS = ['outgoing', 'incoming'];
const VALID_OUTREACH_STATUSES = ['completed', 'pending', 'draft'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateContact(body, { isUpdate = false } = {}) {
  const errors = [];

  if (!isUpdate) {
    if (!body.first_name || !String(body.first_name).trim()) errors.push('first_name is required');
    if (!body.last_name || !String(body.last_name).trim()) errors.push('last_name is required');
  }

  if (body.first_name !== undefined && String(body.first_name).length > 100) {
    errors.push('first_name must be 100 characters or less');
  }
  if (body.last_name !== undefined && String(body.last_name).length > 100) {
    errors.push('last_name must be 100 characters or less');
  }
  if (body.email !== undefined && body.email) {
    if (String(body.email).length > 255) errors.push('email must be 255 characters or less');
    else if (!EMAIL_REGEX.test(String(body.email).trim())) errors.push('email format is invalid');
  }
  if (body.phone !== undefined && body.phone && String(body.phone).length > 30) {
    errors.push('phone must be 30 characters or less');
  }
  if (body.address_line1 !== undefined && body.address_line1 && String(body.address_line1).length > 200) {
    errors.push('address_line1 must be 200 characters or less');
  }
  if (body.address_line2 !== undefined && body.address_line2 && String(body.address_line2).length > 200) {
    errors.push('address_line2 must be 200 characters or less');
  }
  if (body.city !== undefined && body.city && String(body.city).length > 100) {
    errors.push('city must be 100 characters or less');
  }
  if (body.state !== undefined && body.state && String(body.state).length > 50) {
    errors.push('state must be 50 characters or less');
  }
  if (body.zip !== undefined && body.zip && String(body.zip).length > 20) {
    errors.push('zip must be 20 characters or less');
  }
  if (body.country !== undefined && body.country && String(body.country).length > 50) {
    errors.push('country must be 50 characters or less');
  }
  if (body.organization !== undefined && body.organization && String(body.organization).length > 200) {
    errors.push('organization must be 200 characters or less');
  }
  if (body.relationship !== undefined && body.relationship && String(body.relationship).length > 100) {
    errors.push('relationship must be 100 characters or less');
  }
  if (body.notes !== undefined && body.notes && String(body.notes).length > 5000) {
    errors.push('notes must be 5000 characters or less');
  }
  if (body.tags !== undefined && body.tags && String(body.tags).length > 500) {
    errors.push('tags must be 500 characters or less');
  }

  return errors;
}

function sanitizeContactFields(body) {
  const sanitized = { ...body };
  const textFields = ['first_name', 'last_name', 'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'organization', 'relationship', 'notes', 'tags'];
  for (const field of textFields) {
    if (sanitized[field] !== undefined && sanitized[field] !== null) {
      sanitized[field] = stripHtml(String(sanitized[field]));
    }
  }
  return sanitized;
}

function validateDonation(body) {
  const errors = [];

  if (body.amount == null || body.amount === '') {
    errors.push('amount is required');
  } else if (!isPositiveNumber(body.amount)) {
    errors.push('amount must be a positive number');
  } else if (Number(body.amount) > 999999999) {
    errors.push('amount exceeds maximum allowed value');
  }

  if (!body.date) {
    errors.push('date is required');
  } else if (!isValidDate(body.date)) {
    errors.push('date must be a valid date');
  }

  if (body.method !== undefined && body.method !== null && String(body.method).length > 50) {
    errors.push('method must be 50 characters or less');
  }

  if (body.notes !== undefined && body.notes !== null && String(body.notes).length > 2000) {
    errors.push('notes must be 2000 characters or less');
  }

  return errors;
}

function sanitizeDonationFields(body) {
  const sanitized = { ...body };
  if (sanitized.method) sanitized.method = stripHtml(String(sanitized.method));
  if (sanitized.notes) sanitized.notes = stripHtml(String(sanitized.notes));
  if (sanitized.amount != null) sanitized.amount = Number(sanitized.amount);
  return sanitized;
}

function validateOutreach(body) {
  const errors = [];

  if (!body.mode) {
    errors.push('mode is required');
  } else if (!VALID_OUTREACH_MODES.includes(body.mode)) {
    errors.push(`mode must be one of: ${VALID_OUTREACH_MODES.join(', ')}`);
  }

  if (body.direction && !VALID_OUTREACH_DIRECTIONS.includes(body.direction)) {
    errors.push(`direction must be one of: ${VALID_OUTREACH_DIRECTIONS.join(', ')}`);
  }

  if (body.status && !VALID_OUTREACH_STATUSES.includes(body.status)) {
    errors.push(`status must be one of: ${VALID_OUTREACH_STATUSES.join(', ')}`);
  }

  if (body.date && !isValidDate(body.date)) {
    errors.push('date must be a valid date');
  }

  if (body.subject !== undefined && body.subject && String(body.subject).length > 500) {
    errors.push('subject must be 500 characters or less');
  }

  if (body.content !== undefined && body.content && String(body.content).length > 50000) {
    errors.push('content must be 50000 characters or less');
  }

  return errors;
}

function sanitizeOutreachFields(body) {
  const sanitized = { ...body };
  if (sanitized.subject) sanitized.subject = stripHtml(String(sanitized.subject));
  // content may contain intentional formatting, only strip HTML tags
  if (sanitized.content) sanitized.content = String(sanitized.content).replace(/<[^>]*>/g, '');
  return sanitized;
}

module.exports = {
  stripHtml,
  sanitizeString,
  isValidDate,
  isPositiveNumber,
  validateContact,
  sanitizeContactFields,
  validateDonation,
  sanitizeDonationFields,
  validateOutreach,
  sanitizeOutreachFields,
  VALID_OUTREACH_MODES,
  VALID_OUTREACH_DIRECTIONS,
  VALID_OUTREACH_STATUSES,
};
