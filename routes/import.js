const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { parseFile, autoDetectMapping, applyMapping } = require('../services/importService');

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV, XLSX, and XLS files are supported'));
    }
  }
});

// POST /api/import/preview
router.post('/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Rename file to keep its extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newPath = req.file.path + ext;
    fs.renameSync(req.file.path, newPath);

    const { headers, rows } = parseFile(newPath);
    const mapping = autoDetectMapping(headers);
    const previewRows = rows.slice(0, 5);

    res.json({
      filePath: newPath,
      fileName: req.file.originalname,
      headers,
      mapping,
      previewRows,
      totalRows: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import/execute
router.post('/execute', (req, res) => {
  try {
    const { filePath, mapping } = req.body;

    if (!filePath || !mapping) {
      return res.status(400).json({ error: 'filePath and mapping are required' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Uploaded file not found. Please re-upload.' });
    }

    const { rows } = parseFile(filePath);
    const result = applyMapping(rows, mapping);

    // Insert contacts into database
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, zip, country, organization, relationship, notes, tags)
      VALUES (@first_name, @last_name, @email, @phone, @address_line1, @address_line2, @city, @state, @zip, @country, @organization, @relationship, @notes, @tags)
    `);

    const insertMany = db.transaction((contacts) => {
      for (const contact of contacts) {
        insert.run({
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email || null,
          phone: contact.phone || null,
          address_line1: contact.address_line1 || null,
          address_line2: contact.address_line2 || null,
          city: contact.city || null,
          state: contact.state || null,
          zip: contact.zip || null,
          country: contact.country || 'US',
          organization: contact.organization || null,
          relationship: contact.relationship || null,
          notes: contact.notes || null,
          tags: contact.tags || null,
        });
      }
    });

    insertMany(result.contacts);

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
