const { execFile } = require('child_process');
const util = require('util');
const dns = require('dns').promises;
const logger = require('../middleware/logging');

const execFileAsync = util.promisify(execFile);

// Timeout helper
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    )
  ]);
}

// DIG
async function dig(hostname) {
  const start = Date.now();
  const timeout = parseInt(process.env.DIG_TIMEOUT || '10000', 10);

  try {
    const { stdout } = await withTimeout(
      execFileAsync('dig', ['+short', '+timeout=5', hostname]),
      timeout
    );

    const result = stdout.trim();
    return {
      success: !!result,
      duration_ms: Date.now() - start,
      data: { output: result }
    };
  } catch (err) {
    logger.warn({ err, cmd: 'dig', hostname });
    throw err;
  }
}

// CURL
async function curl(url, timeout = 15000) {
  const start = Date.now();
  const safeTimeout = Math.min(timeout, 60000);

  try {
    const { stdout } = await withTimeout(
      execFileAsync('curl', [
        '-sS',
        '-w', '\n%{http_code}',
        '--max-time', String(safeTimeout / 1000),
        '--connect-timeout', '5',
        '--speed-time', '5',
        url
      ], { maxBuffer: 1024 * 1024 }),
      safeTimeout + 1000
    );

    const lines = stdout.trim().split('\n');
    const httpCode = parseInt(lines[lines.length - 1], 10);
    const body = lines.slice(0, -1).join('\n').slice(0, 1000);

    return {
      success: httpCode >= 200 && httpCode < 500,
      duration_ms: Date.now() - start,
      data: { http_code: httpCode, body }
    };
  } catch (err) {
    logger.warn({ err, cmd: 'curl', url });
    throw err;
  }
}

// MTR
async function mtr(host, timeout = 60000) {
  const start = Date.now();
  const safeTimeout = Math.min(timeout, 120000);
  const hops = process.env.MTR_HOPS || 30;

  try {
    const { stdout } = await withTimeout(
      execFileAsync('mtr', [
        '-r',
        '-c', '3',
        '-m', String(hops),
        '-j',
        host
      ], { maxBuffer: 5 * 1024 * 1024 }),
      safeTimeout + 2000
    );

    const data = JSON.parse(stdout);
    return {
      success: true,
      duration_ms: Date.now() - start,
      data
    };
  } catch (err) {
    logger.warn({ err, cmd: 'mtr', host });
    throw err;
  }
}

// DNS Resolve
async function resolve(hostname) {
  const start = Date.now();
  const timeout = parseInt(process.env.DIG_TIMEOUT || '10000', 10);

  try {
    const addresses = await withTimeout(
      dns.resolve4(hostname, { timeout: 5000 }),
      timeout
    );

    return {
      success: !!addresses.length,
      duration_ms: Date.now() - start,
      data: { addresses }
    };
  } catch (err) {
    logger.warn({ err, cmd: 'resolve', hostname });
    throw err;
  }
}

module.exports = {
  dig,
  curl,
  mtr,
  resolve
};
