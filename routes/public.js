const express = require('express');
const { translateError } = require('../lib/akamai');

const router = express.Router();

// Reference ID format: 30.25383217.1793469445.5bdcf8 (hex digits + dots)
const REF_PATTERN = /^[0-9a-f]{1,8}(\.[0-9a-f]{1,16}){2,5}$/i;
const EXPECTED_FORMAT = '30.25383217.1793469445.5bdcf8';

/**
 * POST /akamai-diag
 * Body: { "reference_id": "30.1e383217.1793472950.c99c8d" }
 * (camelCase "referenceId" also accepted)
 *
 * Calls Akamai Edge Diagnostics error-translator and returns the full
 * result once the async job completes.
 */
router.post('/akamai-diag', express.json({ limit: '2kb' }), async (req, res) => {
  const raw = req.body?.reference_id ?? req.body?.referenceId ?? '';
  const ref = String(raw).trim();

  console.log('[akamai-diag] request for ref:', ref);

  if (!ref || ref.length > 64 || !REF_PATTERN.test(ref)) {
    return res.status(400).json({
      error: 'invalid reference_id',
      expected_format: EXPECTED_FORMAT
    });
  }

  try {
    const result = await translateError(ref, { traceForwardLogs: true });
    console.log('[akamai-diag] done:', ref, result.executionStatus);
    return res.status(200).json({ ok: true, data: result });
  } 
  catch (err) {
    // Log full detail server-side, return a safe message to the browser
    console.error('[akamai-diag] Akamai call failed:', err.statusCode, err.message, JSON.stringify(err.body || {}));
    const status = err.statusCode === 504 ? 504 : err.code === 'CONFIG' ? 500 : 502;
    return res.status(status).json({
      error: err.code === 'CONFIG' ? 'server misconfigured' : 'upstream diagnostics failed',
      detail: err.statusCode === 504 ? 'timed out' : undefined
    });
  }
});

module.exports = router;
