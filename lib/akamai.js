const EdgeGrid = require('akamai-edgegrid');

const REQUIRED = [
  'AKAMAI_HOST',
  'AKAMAI_CLIENT_TOKEN',
  'AKAMAI_CLIENT_SECRET',
  'AKAMAI_ACCESS_TOKEN'
];

let eg = null;

// Build the client on first use, not at require() time, so a config
// problem returns an error for /akamai-diag instead of crashing the server.
function getClient() {
  if (eg) return eg;
  const missing = REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim());
  if (missing.length) {
    const e = new Error(`Akamai credentials not configured: ${missing.join(', ')}`);
    e.statusCode = 500;
    e.code = 'CONFIG';
    throw e;
  }
  eg = new EdgeGrid({
    host: process.env.AKAMAI_HOST.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    client_token: process.env.AKAMAI_CLIENT_TOKEN.trim(),
    client_secret: process.env.AKAMAI_CLIENT_SECRET.trim(),
    access_token: process.env.AKAMAI_ACCESS_TOKEN.trim()
  });
  return eg;
}

// Log which vars are missing once at startup (names only, never values)
const missingAtBoot = REQUIRED.filter((k) => !process.env[k] || !process.env[k].trim());
if (missingAtBoot.length) {
  console.error('[akamai] WARNING: missing env vars:', missingAtBoot.join(', '));
} else {
  console.log('[akamai] credentials loaded for host', process.env.AKAMAI_HOST.trim());
}

// Promise wrapper around the callback-style library
function send(reqOpts) {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = getClient();
    } catch (err) {
      return reject(err);
    }
    client.auth({
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...reqOpts
    });
    client.send((err, response, body) => {
      if (err) return reject(err);
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = { raw: body };
      }
      if (response.statusCode >= 400) {
        const e = new Error(`Akamai API ${response.statusCode}`);
        e.statusCode = response.statusCode;
        e.body = parsed;
        return reject(e);
      }
      resolve(parsed);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Geo lookup (Edge Diagnostics locate-ip)
 * ------------------------------------------------------------------ */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Every IP that appears in a diagnostics result
function collectIps(diag) {
  const r = (diag && diag.result) || {};
  const set = new Set();
  const add = (ip) => { if (typeof ip === 'string' && IPV4.test(ip)) set.add(ip); };

  [r.clientIp, r.connectingIp, r.edgeServerIp].forEach((o) => o && add(o.ip));
  const logs = (r.logLines && r.logLines.logs) || [];
  logs.forEach((l) => {
    add(l.edgeIp);
    add(l.clientIp);
    add(l.forwardIp);   // "-" is rejected by the regex
  });
  return [...set];
}

// One batched call for all IPs. Returns { "<ip>": { lat, lon, city, ... } }
async function locateIps(ips) {
  if (!ips.length) return {};

  const key = (process.env.AKAMAI_ACCOUNT_SWITCH_KEY || '').trim();
  const path = '/edge-diagnostics/v1/locate-ip' + (key ? `?accountSwitchKey=${encodeURIComponent(key)}` : '');

  const resp = await send({ path, method: 'POST', body: { ipAddresses: ips } });

  const out = {};
  for (const item of (resp && resp.results) || []) {
    if (item.executionStatus !== 'SUCCESS' || !item.geoLocation) continue;
    const g = item.geoLocation;
    if (typeof g.latitude !== 'number' || typeof g.longitude !== 'number') continue;
    out[item.ipAddress] = {
      lat: g.latitude,
      lon: g.longitude,
      city: g.city || '',
      regionCode: g.regionCode || '',
      countryCode: g.countryCode || '',
      asn: g.asNumber || '',
      continent: g.continent || '',
      networkType: g.networkType || '',
      timeZone: g.timeZone || ''
    };
  }
  let geo = {};
  if (current.executionStatus === 'SUCCESS') {
    try {
      const ips = collectIps(current);
      if (ips.length) {
        geo = await locateIps(ips);
      }
    } catch (e) {
      console.warn('[akamai] locate-ip failed:', e.statusCode || '', e.message);
    }
  }
  console.log('[akamai] geo collected for IPs:', Object.keys(geo).length);
  return { ...current, geo };
  return out;
}

/* ------------------------------------------------------------------ *
 * Error translator
 * ------------------------------------------------------------------ */

/**
 * Translate an Akamai error reference code via Edge Diagnostics.
 * Starts the async job, polls until SUCCESS / FAILED / timeout, then
 * attaches geolocation for every IP in the result as `geo`.
 */
async function translateError(errorCode, { traceForwardLogs = true, maxWaitMs = 30000 } = {}) {
  const started = await send({
    path: '/edge-diagnostics/v1/error-translator',
    method: 'POST',
    body: { errorCode, traceForwardLogs }
  });

  const deadline = Date.now() + maxWaitMs;
  let current = started;

  while (current.executionStatus === 'IN_PROGRESS') {
    if (Date.now() >= deadline) {
      const e = new Error('Timed out waiting for Akamai');
      e.statusCode = 504;
      throw e;
    }
    await sleep(Math.max(1, current.retryAfter || 3) * 1000);
    current = await send({ path: current.link, method: 'GET' });
  }

  // Geo is best-effort: a locate-ip failure must never fail the diagnosis.
  let geo = {};
  if (current.executionStatus === 'SUCCESS') {
    try {
      geo = await locateIps(collectIps(current));
    } catch (e) {
      console.warn('[akamai] locate-ip failed:', e.statusCode || '', e.message);
    }
  }
  console.log('[akamai] geo keys:', Object.keys(geo));
  return { ...current, geo };
}

module.exports = { translateError };
