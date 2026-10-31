const { execFile } = require('child_process');
const util = require('util');
const dns = require('dns').promises;
const net = require('net');
const logger = require('../middleware/logging');

const execFileAsync = util.promisify(execFile);

// Validation regex for hostnames
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Validate hostname: no leading dash, valid DNS name or IP
 */
function assertHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname) {
    throw Object.assign(new Error('hostname must be a non-empty string'), { status: 400 });
  }
  if (hostname.startsWith('-') || hostname.startsWith('.')) {
    throw Object.assign(new Error('hostname cannot start with dash or dot'), { status: 400 });
  }
  // Allow valid hostname or valid IP address
  if (!HOSTNAME_RE.test(hostname) && !net.isIP(hostname)) {
    throw Object.assign(new Error('invalid hostname or IP address'), { status: 400 });
  }
}


/**
 * Reject private/reserved IPs (SSRF protection)
 */
function assertPublicIP(ip) {
  const deny = (msg) => { throw Object.assign(new Error(msg), { status: 403 }); };

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) deny('reserved address');
    if (a === 10) deny('private address');
    if (a === 127) deny('loopback address');
    if (a === 100 && b >= 64 && b <= 127) deny('carrier-grade NAT address');
    if (a === 169 && b === 254) deny('link-local address');
    if (a === 172 && b >= 16 && b <= 31) deny('private address');
    if (a === 192 && b === 168) deny('private address');
    if (a === 192 && b === 0) deny('reserved address');
    if (a === 198 && (b === 18 || b === 19)) deny('benchmark address');
    if (a >= 224) deny('multicast or reserved address');
  } else if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') deny('loopback address');
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) deny('link-local address');
    if (lower.startsWith('fc') || lower.startsWith('fd')) deny('unique local address');
    if (lower.startsWith('ff')) deny('multicast address');
    // IPv4-mapped (::ffff:a.b.c.d): check the embedded IPv4
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return assertPublicIP(mapped[1]);
  } else {
    deny('not an IP address');
  }
}

/**
 * CURL: fetch URL with SSRF protection (resolve, validate, pin IP, no redirects)
 */
async function curl(url, timeout = 15000) {
  if (typeof url !== 'string' || !url) {
    throw Object.assign(new Error('url must be a non-empty string'), { status: 400 });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw Object.assign(new Error('invalid URL'), { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw Object.assign(new Error('only http and https URLs allowed'), { status: 400 });
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw Object.assign(new Error('credentials in URL not allowed'), { status: 400 });
  }

  // new URL() strips IPv6 brackets only via .hostname with brackets kept; normalize
  const host = parsedUrl.hostname.replace(/^\[|\]$/g, '');

  // Resolve to concrete IPs and validate every one
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    assertHostname(host);
    try {
      const results = await dns.lookup(host, { all: true });
      ips = results.map((r) => r.address);
    } catch (e) {
      throw Object.assign(new Error('could not resolve host'), { status: 400 });
    }
  }
  if (!ips.length) {
    throw Object.assign(new Error('could not resolve host'), { status: 400 });
  }
  ips.forEach(assertPublicIP);

  const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
  const pinnedIp = ips[0];

  const start = Date.now();
  const t = Number(timeout);
  const safeTimeout = Math.min(Math.max(Number.isFinite(t) ? t : 15000, 1000), 30000);

  try {
    const { stdout } = await withTimeout(
      execFileAsync('curl', [
        '-sS',
        '-w', '\n%{http_code}',
        '--max-time', String(Math.floor(safeTimeout / 1000)),
        '--connect-timeout', '5',
        '--proto', '=http,https',
        '--max-redirs', '0',                       // no redirects (rebinding/redirect SSRF)
        '--resolve', `${host}:${port}:${pinnedIp.includes(':') ? `[${pinnedIp}]` : pinnedIp}`,
        '--max-filesize', '1048576',
        '--',
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
      data: { http_code: httpCode, body_preview: body.length > 100 ? body.slice(0, 100) + '...' : body }
    };
  } catch (err) {
    logger.warn({ err, cmd: 'curl', url });
    throw Object.assign(new Error('curl command failed'), { status: 500, cause: err });
  }
}

/**
 * Timeout helper with proper cleanup
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * DIG: resolve hostname to IP
 */
async function dig(hostname) {
  assertHostname(hostname);
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
    throw Object.assign(new Error('dig command failed'), { status: 500, cause: err });
  }
}

/**
 * CURL: fetch URL with SSRF mitigation
 */

/**
 * MTR: traceroute with latency
 */
async function mtr(host, timeout = 60000) {
  assertHostname(host);
  
  const start = Date.now();
  const safeTimeout = Math.min(Math.max(timeout, 5000), 120000); // Clamp 5-120 seconds
  const hops = Math.min(Math.max(parseInt(process.env.MTR_HOPS || '30', 10), 1), 64);

  try {
    const { stdout } = await withTimeout(
      execFileAsync('mtr', [
        '-r',
        '-c', '3',
        '-m', String(hops),
        '-j',
        '--',
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
    throw Object.assign(new Error('mtr command failed'), { status: 500, cause: err });
  }
}

/**
 * DNS Resolve: Node.js native DNS lookup
 */
async function resolve(hostname) {
  assertHostname(hostname);
  
  const start = Date.now();
  const timeout = parseInt(process.env.DIG_TIMEOUT || '10000', 10);

  try {
    const addresses = await withTimeout(
      dns.resolve4(hostname, { timeout: 5000 }),
      timeout
    );
    
    // Reject private IPs in results
    for (const addr of addresses) {
      try {
        assertPublicIP(addr);
      } catch (e) {
        logger.warn({ hostname, addr, reason: e.message });
      }
    }
    
    return {
      success: !!addresses.length,
      duration_ms: Date.now() - start,
      data: { addresses }
    };
  } catch (err) {
    logger.warn({ err, cmd: 'resolve', hostname });
    throw Object.assign(new Error('resolve command failed'), { status: 500, cause: err });
  }
}

module.exports = {
  dig,
  curl,
  mtr,
  resolve
};
