const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const diagnostics = require('../lib/diagnostics');
const logger = require('../middleware/logging');

// Rate limit: 10 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'too many requests' },
  standardHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check origin if needed
    return false;
  }
});

router.use(limiter);

/**
 * POST /api/diagnose/dig
 * Resolve hostname via dig
 */
router.post('/dig', async (req, res) => {
  const { hostname } = req.body;
  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  if (!hostname) {
    return res.status(400).json({ error: 'hostname required', request_id });
  }

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
    const status = err.status || 500;
    res.status(status).json({
      error: 'dig test failed',
      test_type: 'dig',
      success: false,
      request_id
    });
  }
});

/**
 * POST /api/diagnose/curl
 * Fetch URL with timeout and SSRF protection
 */
router.post('/curl', async (req, res) => {
  const { url, timeout = 15000 } = req.body;
  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  if (!url) {
    return res.status(400).json({ error: 'url required', request_id });
  }

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
    const status = err.status || 500;
    res.status(status).json({
      error: 'curl test failed',
      test_type: 'curl',
      success: false,
      request_id
    });
  }
});

/**
 * POST /api/diagnose/mtr
 * Traceroute with latency stats
 */
router.post('/mtr', async (req, res) => {
  const { host, timeout = 60000 } = req.body;
  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  if (!host) {
    return res.status(400).json({ error: 'host required', request_id });
  }

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
    const status = err.status || 500;
    res.status(status).json({
      error: 'mtr test failed',
      test_type: 'mtr',
      success: false,
      request_id
    });
  }
});

/**
 * POST /api/diagnose/resolve
 * DNS resolve via Node.js, with SSRF protection
 */
router.post('/resolve', async (req, res) => {
  const { hostname } = req.body;
  const request_id = req.get('x-request-id') || Math.random().toString(36).slice(2);

  if (!hostname) {
    return res.status(400).json({ error: 'hostname required', request_id });
  }

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
    const status = err.status || 500;
    res.status(status).json({
      error: 'resolve test failed',
      test_type: 'resolve',
      success: false,
      request_id
    });
  }
});

module.exports = router;
