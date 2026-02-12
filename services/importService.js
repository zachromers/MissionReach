const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

const COLUMN_MAP_ALIASES = {
  first_name: ['first_name', 'firstname', 'first name', 'fname', 'first'],
  last_name: ['last_name', 'lastname', 'last name', 'lname', 'last', 'surname'],
  email: ['email', 'e-mail', 'email address', 'emailaddress'],
  phone: ['phone', 'phone number', 'phonenumber', 'telephone', 'tel', 'mobile', 'cell'],
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

function applyMapping(rows, mapping) {
  const results = { imported: 0, skipped: 0, errors: [] };
  const contacts = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const contact = {};

    for (const [sourceCol, targetField] of Object.entries(mapping)) {
      if (targetField === '__skip__') continue;
      contact[targetField] = row[sourceCol] != null ? String(row[sourceCol]).trim() : '';
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

module.exports = { parseFile, autoDetectMapping, applyMapping };
