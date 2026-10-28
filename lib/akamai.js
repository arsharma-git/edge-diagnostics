const logger = require('../middleware/logging');

async function logLookup(referenceId, clientIp = null) {
  try {
    // Placeholder for Akamai API integration
    logger.info({ referenceId, clientIp, msg: 'log lookup request' });
    return { error: 'not implemented' };
  } catch (err) {
    logger.error({ err, referenceId });
    throw err;
  }
}

module.exports = {
  logLookup
};
