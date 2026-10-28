require('dotenv').config();
require('express-async-errors');

const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./middleware/logging');

const db = require('./db');
const { requireKey } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const sessionRoutes = require('./routes/sessions');
const testRoutes = require('./routes/tests');
const reportRoutes = require('./routes/reports');
const diagnoseRoutes = require('./routes/diagnose');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

// Logging
app.use(pinoHttp({ logger }));

// Middleware
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/sessions/:sessionId/tests', testRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/diagnose', requireKey, diagnoseRoutes);
app.use('/api/webhooks', webhookRoutes);

// Health check endpoint (no auth)
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing...');
  db.closeDb();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing...');
  db.closeDb();
  process.exit(0);
});

const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Backend listening on http://127.0.0.1:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
