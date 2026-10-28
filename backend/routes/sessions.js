const express = require('express');
const router = express.Router();
const { requireKey } = require('../middleware/auth');
const { getDb } = require('../db');

// POST /api/sessions - Create a session
router.post('/', requireKey, (req, res) => {
  const db = getDb();
  const {
    reference_error_id,
    http_status,
    origin_hostname,
    edge_ip,
    edge_location,
    request_url,
    client_ip,
    outcome,
    notes
  } = req.body;

  if (!http_status) {
    return res.status(400).json({ error: 'http_status required' });
  }

  const error_class = http_status >= 500 ? String(http_status) : 'non-5xx';

  const stmt = db.prepare(`
    INSERT INTO sessions (
      reference_error_id, http_status, error_class, origin_hostname,
      edge_ip, edge_location, request_url, client_ip, outcome, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    reference_error_id || null,
    http_status,
    error_class,
    origin_hostname || null,
    edge_ip || null,
    edge_location || null,
    request_url || null,
    client_ip || null,
    outcome || 'inconclusive',
    notes || null
  );

  res.status(201).json({
    id: info.lastInsertRowid,
    reference_error_id,
    http_status,
    error_class
  });
});

// GET /api/sessions - List sessions
router.get('/', (req, res) => {
  const db = getDb();
  const {
    status,
    origin,
    ref,
    outcome,
    days = 30,
    limit = 100,
    offset = 0
  } = req.query;

  const safeLimit = Math.min(parseInt(limit, 10) || 100, 1000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);

  let whereClause = [`created_at >= datetime('now', '-${safeDays} days')`];
  let params = [];

  if (status) {
    whereClause.push('http_status = ?');
    params.push(parseInt(status, 10));
  }
  if (origin) {
    whereClause.push('origin_hostname LIKE ?');
    params.push(`%${origin}%`);
  }
  if (ref) {
    whereClause.push('reference_error_id = ?');
    params.push(ref);
  }
  if (outcome) {
    whereClause.push('outcome = ?');
    params.push(outcome);
  }

  const where = whereClause.join(' AND ');
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM sessions WHERE ${where}
  `).get(...params);

  res.json({
    data: rows,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: total.count
    }
  });
});

// GET /api/sessions/:id - Get a single session with tests
router.get('/:id', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const tests = db.prepare('SELECT * FROM tests WHERE session_id = ? ORDER BY created_at')
    .all(req.params.id)
    .map((t) => ({
      ...t,
      result: t.result_json ? JSON.parse(t.result_json) : null,
      result_json: undefined
    }));

  res.json({ ...session, tests });
});

// PATCH /api/sessions/:id - Update session outcome/notes
router.patch('/:id', requireKey, (req, res) => {
  const db = getDb();
  const { outcome, notes } = req.body;

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const stmt = db.prepare(`
    UPDATE sessions SET outcome = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(outcome || session.outcome, notes || session.notes, req.params.id);

  res.json({ id: req.params.id, outcome: outcome || session.outcome });
});

module.exports = router;
