const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireKey } = require('../middleware/auth');
const { getDb } = require('../db');

// POST /api/sessions/:sessionId/tests - Record a test
router.post('/', requireKey, (req, res) => {
  const db = getDb();
  const {
    test_type,
    target,
    success,
    duration_ms,
    result,
    error_message
  } = req.body;

  const { sessionId } = req.params;

  if (!test_type) {
    return res.status(400).json({ error: 'test_type required' });
  }

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const stmt = db.prepare(`
    INSERT INTO tests (
      session_id, test_type, target, success, duration_ms, result_json, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    sessionId,
    test_type,
    target || null,
    success ? 1 : 0,
    duration_ms || null,
    result ? JSON.stringify(result) : null,
    error_message || null
  );

  res.status(201).json({
    id: info.lastInsertRowid,
    test_type,
    success,
    duration_ms
  });
});

// GET /api/sessions/:sessionId/tests - List tests for session
router.get('/', (req, res) => {
  const db = getDb();
  const { sessionId } = req.params;

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }

  const tests = db.prepare('SELECT * FROM tests WHERE session_id = ? ORDER BY created_at')
    .all(sessionId)
    .map((t) => ({
      ...t,
      result: t.result_json ? JSON.parse(t.result_json) : null,
      result_json: undefined
    }));

  res.json({ data: tests });
});

module.exports = router;
