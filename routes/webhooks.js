const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const logger = require('../middleware/logging');

// POST /api/webhooks/akamai
router.post('/akamai', express.json({ limit: '10mb' }), (req, res) => {
  const db = getDb();

  try {
    const {
      reference_error_id,
      http_status,
      origin_hostname,
      edge_ip,
      edge_location,
      client_ip
    } = req.body;

    if (!reference_error_id && !http_status) {
      return res.status(400).json({ error: 'reference_error_id or http_status required' });
    }

    const error_class = http_status && http_status >= 500 ? String(http_status) : null;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO sessions (
        reference_error_id, http_status, error_class, origin_hostname,
        edge_ip, edge_location, client_ip, outcome, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      reference_error_id || null,
      http_status || null,
      error_class,
      origin_hostname || null,
      edge_ip || null,
      edge_location || null,
      client_ip || null,
      'inconclusive',
      'Webhook ingested from Akamai'
    );

    // Store raw webhook payload
    const webhookStmt = db.prepare(`
      INSERT INTO webhooks (source, payload_json, session_id)
      VALUES (?, ?, ?)
    `);

    webhookStmt.run(
      'akamai',
      JSON.stringify(req.body),
      info.lastInsertRowid || null
    );

    res.status(201).json({
      id: info.lastInsertRowid || null,
      message: 'webhook ingested'
    });
  } catch (err) {
    logger.error({ err, source: 'akamai-webhook' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/generic
router.post('/generic', express.json({ limit: '10mb' }), (req, res) => {
  const db = getDb();

  try {
    const webhookStmt = db.prepare(`
      INSERT INTO webhooks (source, payload_json)
      VALUES (?, ?)
    `);

    const info = webhookStmt.run(
      req.get('x-webhook-source') || 'unknown',
      JSON.stringify(req.body)
    );

    res.status(201).json({
      id: info.lastInsertRowid,
      message: 'webhook stored'
    });
  } catch (err) {
    logger.error({ err, source: 'generic-webhook' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
