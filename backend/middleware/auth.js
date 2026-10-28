const crypto = require('crypto');

function requireKey(req, res, next) {
  const given = Buffer.from(req.get('x-api-key') || '');
  const want = Buffer.from(process.env.API_KEY || '');

  if (!process.env.API_KEY) {
    return res.status(500).json({ error: 'API_KEY not configured' });
  }

  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return res.status(401).json({ error: 'invalid or missing x-api-key' });
  }

  next();
}

module.exports = { requireKey };
