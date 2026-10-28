const express = require('express');
const router = express.Router();
const diagnostics = require('../lib/diagnostics');
const logger = require('../middleware/logging');

// POST /api/diagnose/dig
router.post('/dig', async (req, res) => {
  const { hostname } = req.body;

  if (!hostname) {
    return res.status(400).json({ error: 'hostname required' });
  }

  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  try {
    const result = await diagnostics.dig(hostname);
    res.json({
      test_type: 'dig',
      target: hostname,
      success: result.success,
      duration_ms: result.duration_ms,
      result: result.data,
      request_id
    });
  } catch (err) {
    logger.error({ err, test: 'dig', hostname });
    res.status(500).json({
      error: err.message,
      test_type: 'dig',
      success: false,
      request_id
    });
  }
});

// POST /api/diagnose/curl
router.post('/curl', async (req, res) => {
  const { url, timeout = 15000 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url required' });
  }

  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  try {
    const result = await diagnostics.curl(url, timeout);
    res.json({
      test_type: 'curl',
      target: url,
      success: result.success,
      duration_ms: result.duration_ms,
      result: result.data,
      request_id
    });
  } catch (err) {
    logger.error({ err, test: 'curl', url });
    res.status(500).json({
      error: err.message,
      test_type: 'curl',
      success: false,
      request_id
    });
  }
});

// POST /api/diagnose/mtr
router.post('/mtr', async (req, res) => {
  const { host, timeout = 60000 } = req.body;

  if (!host) {
    return res.status(400).json({ error: 'host required' });
  }

  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  try {
    const result = await diagnostics.mtr(host, timeout);
    res.json({
      test_type: 'mtr',
      target: host,
      success: result.success,
      duration_ms: result.duration_ms,
      result: result.data,
      request_id
    });
  } catch (err) {
    logger.error({ err, test: 'mtr', host });
    res.status(500).json({
      error: err.message,
      test_type: 'mtr',
      success: false,
      request_id
    });
  }
});

// POST /api/diagnose/resolve
router.post('/resolve', async (req, res) => {
  const { hostname } = req.body;

  if (!hostname) {
    return res.status(400).json({ error: 'hostname required' });
  }

  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  try {
    const result = await diagnostics.resolve(hostname);
    res.json({
      test_type: 'resolve',
      target: hostname,
      success: result.success,
      duration_ms: result.duration_ms,
      result: result.data,
      request_id
    });
  } catch (err) {
    logger.error({ err, test: 'resolve', hostname });
    res.status(500).json({
      error: err.message,
      test_type: 'resolve',
      success: false,
      request_id
    });
  }
});

module.exports = router;
