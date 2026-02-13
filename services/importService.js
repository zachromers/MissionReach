const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const COLUMN_MAP_ALIASES = {
  full_name: ['full name', 'full_name', 'name', 'contact name', 'contact'],
  first_name: ['first_name', 'firstname', 'first name', 'fname', 'first'],
  last_name: ['last_name', 'lastname', 'last name', 'lname', 'last', 'surname'],
  email: ['email', 'e-mail', 'email address', 'emailaddress'],
  phone: ['phone', 'phone number', 'phonenumber', 'telephone', 'tel', 'mobile', 'cell'],
  full_address: ['full address', 'full_address', 'mailing address', 'complete address', 'street address & city'],
  address_line1: ['address', 'address_line1', 'address line 1', 'street', 'street address', 'address1'],
  address_line2: ['address_line2', 'address line 2', 'apt', 'suite', 'unit', 'address2'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region', 'st'],
  zip: ['zip', 'zipcode', 'zip code', 'postal', 'postal code', 'postalcode'],
  country: ['country', 'nation'],
  organization: ['organization', 'org', 'company', 'church', 'church name'],
  relationship: ['relationship', 'relation', 'type', 'contact type'],
  notes: ['notes', 'note', 'comments', 'comment'],
  tags: ['tags', 'tag', 'categories', 'category', 'groups', 'group'],
};

function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    if (records.length === 0) return { headers: [], rows: [] };
    return { headers: Object.keys(records[0]), rows: records };
  }

  // xlsx or xls
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: Object.keys(rows[0]), rows };
}

function autoDetectMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMN_MAP_ALIASES)) {
      if (aliases.includes(normalized)) {
        mapping[header] = field;
        break;
      }
    }
    if (!mapping[header]) {
      mapping[header] = '__skip__';
    }
  }
  return mapping;
}

/**
 * Parse a full name string (space-delimited) into first and last name.
 * The first word becomes first_name, everything after becomes last_name.
 *
 * Examples:
 *   "John Smith"         → { first_name: "John", last_name: "Smith" }
 *   "John Van Der Berg"  → { first_name: "John", last_name: "Van Der Berg" }
 *   "John"               → { first_name: "John" }
 */
function parseFullName(fullName) {
  const trimmed = fullName.trim();
  if (!trimmed) return {};

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { first_name: trimmed };
  }

  return {
    first_name: trimmed.substring(0, spaceIdx),
    last_name: trimmed.substring(spaceIdx + 1).trim(),
  };
}

/**
 * Parse a full address string (comma-delimited) into individual address fields.
 * Works backwards from the end to identify zip, state, city, then treats
 * the remaining leading parts as street address lines.
 *
 * Examples:
 *   "123 Main St, Springfield, IL, 62701"
 *   "123 Main St, Apt 4, Springfield, IL 62701"
 *   "123 Main St, Springfield, IL, 62701, US"
 */
function parseFullAddress(fullAddress) {
  const parts = fullAddress.split(',').map(p => p.trim()).filter(p => p);
  if (parts.length === 0) return {};

  const result = {};
  let idx = parts.length - 1;

  // Check if the last part is a country (2-3 letter code or common names)
  const countryNames = ['united states', 'usa', 'us', 'canada', 'uk', 'united kingdom', 'australia', 'mexico'];
  if (idx >= 2 && (countryNames.includes(parts[idx].toLowerCase()) || /^[a-zA-Z]{2,3}$/.test(parts[idx]))) {
    result.country = parts[idx];
    idx--;
  }

  // Check if current part is a standalone zip code
  if (idx >= 2 && /^\d{5}(-\d{4})?$/.test(parts[idx])) {
    result.zip = parts[idx];
    idx--;
  }

  // Check for state — possibly with zip attached (e.g. "IL 62701")
  if (idx >= 1) {
    const stateZipMatch = parts[idx].match(/^([a-zA-Z]{2})\s+(\d{5}(-\d{4})?)$/);
    if (stateZipMatch) {
      result.state = stateZipMatch[1];
      if (!result.zip) result.zip = stateZipMatch[2];
      idx--;
    } else if (/^[a-zA-Z]{2}$/.test(parts[idx])) {
      result.state = parts[idx];
      idx--;
    }
  }

  // Next part back is the city
  if (idx >= 1) {
    result.city = parts[idx];
    idx--;
  }

  // Remaining parts are address lines
  if (idx >= 0) {
    result.address_line1 = parts[0];
    if (idx >= 1) {
      result.address_line2 = parts.slice(1, idx + 1).join(', ');
    }
  }

  return result;
}

function applyMapping(rows, mapping) {
  const results = { imported: 0, skipped: 0, errors: [] };
  const contacts = [];

  // Track which fields are explicitly mapped so full_name/full_address
  // don't overwrite them
  const explicitNameFields = new Set();
  const explicitAddressFields = new Set();
  for (const targetField of Object.values(mapping)) {
    if (['first_name', 'last_name'].includes(targetField)) {
      explicitNameFields.add(targetField);
    }
    if (['address_line1', 'address_line2', 'city', 'state', 'zip', 'country'].includes(targetField)) {
      explicitAddressFields.add(targetField);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const contact = {};

    for (const [sourceCol, targetField] of Object.entries(mapping)) {
      if (targetField === '__skip__') continue;

      const value = row[sourceCol] != null ? String(row[sourceCol]).trim() : '';

      if (targetField === 'full_name') {
        // Parse the full name and fill in fields not explicitly mapped
        if (value) {
          const parsed = parseFullName(value);
          for (const [field, val] of Object.entries(parsed)) {
            if (!explicitNameFields.has(field)) {
              contact[field] = val;
            }
          }
        }
      } else if (targetField === 'full_address') {
        // Parse the full address and fill in fields not explicitly mapped
        if (value) {
          const parsed = parseFullAddress(value);
          for (const [field, val] of Object.entries(parsed)) {
            if (!explicitAddressFields.has(field)) {
              contact[field] = val;
            }
          }
        }
      } else {
        contact[targetField] = value;
      }
    }

    if (!contact.first_name || !contact.last_name) {
      results.skipped++;
      results.errors.push(`Row ${i + 2}: missing required field 'first_name' or 'last_name'`);
      continue;
    }

    contacts.push(contact);
    results.imported++;
  }

  results.contacts = contacts;
  return results;
}

module.exports = { parseFile, autoDetectMapping, applyMapping, parseFullName, parseFullAddress };
