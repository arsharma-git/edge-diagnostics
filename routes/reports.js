const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/reports/summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query.days || '30', 10) || 30, 365);
  const range = `-${days} days`;

  const one = (sql) => db.prepare(sql).get(range);
  const many = (sql) => db.prepare(sql).all(range);

  const summary = {
    window_days: days,
    totals: one(`
      SELECT COUNT(*) AS sessions,
             COUNT(DISTINCT reference_error_id) AS unique_reference_ids,
             COUNT(DISTINCT origin_hostname) AS unique_origins
      FROM sessions WHERE created_at >= datetime('now', ?)
    `),
    by_error_class: many(`
      SELECT error_class, COUNT(*) AS count FROM sessions
      WHERE created_at >= datetime('now', ?)
      GROUP BY error_class ORDER BY count DESC
    `),
    by_outcome: many(`
      SELECT outcome, COUNT(*) AS count FROM sessions
      WHERE created_at >= datetime('now', ?)
      GROUP BY outcome ORDER BY count DESC
    `),
    by_status: many(`
      SELECT http_status, COUNT(*) AS count FROM sessions
      WHERE created_at >= datetime('now', ?) AND http_status IS NOT NULL
      GROUP BY http_status ORDER BY count DESC
    `),
    top_origins: many(`
      SELECT origin_hostname, COUNT(*) AS count,
             GROUP_CONCAT(DISTINCT error_class) AS error_classes
      FROM sessions
      WHERE created_at >= datetime('now', ?) AND origin_hostname IS NOT NULL
      GROUP BY origin_hostname ORDER BY count DESC LIMIT 20
    `),
    top_reference_ids: many(`
      SELECT reference_error_id, COUNT(*) AS count,
             GROUP_CONCAT(DISTINCT outcome) AS outcomes
      FROM sessions
      WHERE created_at >= datetime('now', ?) AND reference_error_id IS NOT NULL
      GROUP BY reference_error_id ORDER BY count DESC LIMIT 20
    `),
    tests_by_type: many(`
      SELECT test_type, COUNT(*) AS runs, SUM(success) AS succeeded,
             ROUND(AVG(duration_ms)) AS avg_ms
      FROM tests WHERE created_at >= datetime('now', ?)
      GROUP BY test_type
    `),
    daily: many(`
      SELECT date(created_at) AS day, COUNT(*) AS count FROM sessions
      WHERE created_at >= datetime('now', ?)
      GROUP BY day ORDER BY day
    `)
  };

  res.json(summary);
});

// GET /api/reports/sessions
router.get('/sessions', (req, res) => {
  const db = getDb();
  const { status, origin, ref, outcome, days = 30, limit = 100, offset = 0 } = req.query;

  const safeLimit = Math.min(parseInt(limit, 10) || 100, 1000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);

  let where = [`created_at >= datetime('now', '-${safeDays} days')`];
  let params = [];

  if (status) {
    where.push('http_status = ?');
    params.push(parseInt(status, 10));
  }
  if (origin) {
    where.push('origin_hostname LIKE ?');
    params.push(`%${origin}%`);
  }
  if (ref) {
    where.push('reference_error_id = ?');
    params.push(ref);
  }
  if (outcome) {
    where.push('outcome = ?');
    params.push(outcome);
  }

  const whereStr = where.join(' AND ');
  const rows = db.prepare(`
    SELECT * FROM sessions WHERE ${whereStr}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE ${whereStr}`)
    .get(...params);

  res.json({
    data: rows,
    pagination: { limit: safeLimit, offset: safeOffset, total: total.count }
  });
});

// GET /api/reports/sessions/:id
router.get('/sessions/:id', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'not found' });
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

// GET /api/reports/export.csv
router.get('/export.csv', (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query.days || '30', 10) || 30, 365);

  const rows = db.prepare(`
    SELECT id, created_at, reference_error_id, http_status, error_class,
           origin_hostname, edge_ip, edge_location, outcome, notes
    FROM sessions
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
  `).all(days);

  const escapeCSV = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const cols = [
    'id', 'created_at', 'reference_error_id', 'http_status', 'error_class',
    'origin_hostname', 'edge_ip', 'edge_location', 'outcome', 'notes'
  ];

  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escapeCSV(r[c])).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="diagnostics-export.csv"');
  res.send([header, body].join('\n'));
});

module.exports = router;
