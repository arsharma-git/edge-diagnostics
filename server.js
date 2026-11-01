const express = require('express');
const { getDb } = require('./db');

const app = express();
const errorHandler = require('./middleware/errorHandler');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


// Trust proxy (Akamai/nginx passes real IP)
app.set('trust proxy', 1);

// Health check (internal, no rate limit needed here since nginx applies it)
app.get('/healthz', (req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get(); // Test DB connectivity
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// Public routes (rate-limited by nginx, no auth required)
app.use('/', require('./routes/public'));

// Internal routes (auth required via middleware)
const { requireKey } = require('./middleware/auth');
app.use('/api/sessions', requireKey, require('./routes/sessions'));
app.use('/api/tests', requireKey, require('./routes/tests'));
app.use('/api/reports', requireKey, require('./routes/reports')); // Decide if this needs auth
app.use('/api/webhooks', requireKey, require('./routes/webhooks')); // Check this file

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});

module.exports = app;
app.use(errorHandler);