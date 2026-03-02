'use strict';
/**
 * Amazon Fling / Fire TV device manager
 *
 * Uses SSDP (Simple Service Discovery Protocol) + DIAL (Device and
 * Application Layer) to discover Fire TV devices on the local network
 * and launch content on them.
 *
 * Discovery:
 *   Fire TVs advertise via SSDP as urn:dial-multiscreen-org:service:dial:1
 *   We query each discovered device's DIAL server to get its friendly name.
 *
 * Casting:
 *   We launch the Amazon Silk Browser (or a sideloaded WiSign receiver APK)
 *   via the DIAL REST API, passing the sign URL as a query param.
 *
 *   Default app: "com.amazon.webviewservice" (Silk Browser)
 *   Override:    WISIGN_FIRE_APP_ID env var (e.g. your sideloaded APK package)
 *
 *   Silk Browser DIAL launch payload:
 *     v=<url-encoded sign URL>
 *
 * Requirements:
 *   - Fire TV and controller must be on the same subnet
 *   - ADB Debugging or "Allow apps from unknown sources" NOT required for Silk
 *   - Fire TV must be awake (no deep sleep)
 */

const http = require('http');
const { Client: SsdpClient } = require('node-ssdp');

const FIRE_APP_ID = process.env.WISIGN_FIRE_APP_ID || 'com.amazon.webviewservice';
const DIAL_ST = 'urn:dial-multiscreen-org:service:dial:1';

// device_id -> { id, name, host, dialPort, dialPath, status, type }
const devices = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = body || '';
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(postData),
        'Origin': 'package:' + FIRE_APP_ID
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpDelete(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'DELETE'
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch the DIAL device description XML to extract friendly name + app URL base.
 * Returns { name, host, dialPort, dialPath } or null on failure.
 */
async function fetchDialInfo(location) {
  try {
    const res = await httpGet(location);
    if (res.status !== 200) return null;

    const nameMatch = res.body.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
    const name = nameMatch ? nameMatch[1].trim() : 'Fire TV';

    // Application-URL header tells us where to send DIAL app commands
    const appUrl = res.headers['application-url'] || res.headers['Application-URL'];
    if (!appUrl) return null;

    const u = new URL(appUrl);
    return {
      name,
      host: u.hostname,
      dialPort: parseInt(u.port || '80', 10),
      dialPath: u.pathname.replace(/\/$/, '') // strip trailing slash
    };
  } catch {
    return null;
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────────

function init() {
  const ssdp = new SsdpClient();

  ssdp.on('response', async (headers, statusCode, rinfo) => {
    if (statusCode !== 200) return;
    const location = headers.LOCATION;
    if (!location) return;

    const info = await fetchDialInfo(location);
    if (!info) return;

    // Port 8008 = Google Cast / Chromecast built-in — skip, castv2 handles these
    if (info.dialPort === 8008) return;

    // Use host as stable ID (Fire TVs don't always have a UUID in SSDP)
    const id = `firetv-${info.host}`;
    if (!devices.has(id)) {
      console.log(`[Fling] Discovered: ${info.name} (${info.host})`);
    }

    devices.set(id, {
      id,
      name: info.name,
      host: info.host,
      dialPort: info.dialPort,
      dialPath: info.dialPath,
      status: 'available',
      type: 'firetv'
    });
  });

  // Initial scan + periodic refresh every 30 s
  function scan() {
    ssdp.search(DIAL_ST);
  }

  scan();
  setInterval(scan, 30_000);
  console.log('[Fling] Scanning for Fire TV devices...');
}

function getDevices() {
  return Array.from(devices.values());
}

// ── Cast control ──────────────────────────────────────────────────────────────

/**
 * Launch the sign URL on a Fire TV via DIAL.
 * Silk Browser DIAL endpoint: POST /apps/<FIRE_APP_ID>  body = v=<encodedUrl>
 */
async function castUrl(deviceId, url) {
  const device = devices.get(deviceId);
  if (!device) throw new Error(`Fire TV device ${deviceId} not found`);

  const endpoint = `http://${device.host}:${device.dialPort}${device.dialPath}/${FIRE_APP_ID}`;
  const body = `v=${encodeURIComponent(url)}`;

  const res = await httpPost(endpoint, body);

  // 201 Created = launched successfully; 200 = already running, relaunched
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`DIAL launch failed: HTTP ${res.status} — ${res.body}`);
  }

  // Location header points to the running instance (for stop)
  const instanceUrl = res.headers['location'];
  if (instanceUrl) {
    device._instanceUrl = instanceUrl;
  }

  return { ok: true, status: res.status, instanceUrl };
}

/**
 * Stop the running WiSign app on a Fire TV via DIAL DELETE.
 */
async function stopCast(deviceId) {
  const device = devices.get(deviceId);
  if (!device) return;

  const instanceUrl = device._instanceUrl ||
    `http://${device.host}:${device.dialPort}${device.dialPath}/${FIRE_APP_ID}/run`;

  const res = await httpDelete(instanceUrl);
  device._instanceUrl = null;
  return { ok: true, status: res.status };
}

module.exports = { init, getDevices, castUrl, stopCast };
