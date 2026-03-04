'use strict';
/**
 * Amazon Fling / Fire TV device manager
 *
 * Uses SSDP to discover Fire TV devices, then ADB over TCP to launch
 * content in the Silk Browser (com.amazon.cloud9).
 *
 * DIAL was attempted but com.amazon.cloud9 accepts POST yet never navigates
 * to the provided URL on current Fire TV firmware — ADB is reliable.
 *
 * Requirements:
 *   - Fire TV: Settings → My Fire TV → Developer Options → ADB Debugging ON
 *   - Accept the "Allow ADB debugging?" prompt on first connect
 *   - Fire TV and controller must be on the same subnet
 */

const { exec } = require('child_process');
const { Client: SsdpClient } = require('node-ssdp');
const http = require('http');

const FIRE_APP_ID = process.env.FTSIGN_FIRE_APP_ID || 'com.amazon.cloud9';
const ADB_PORT = parseInt(process.env.FTSIGN_ADB_PORT || '5555', 10);
const DIAL_ST = 'urn:dial-multiscreen-org:service:dial:1';

// device_id -> { id, name, host, dialPort, dialPath, status, type }
const devices = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

/**
 * Fetch the DIAL device description XML to extract friendly name + app URL base.
 */
async function fetchDialInfo(location) {
  try {
    const res = await httpGet(location);
    if (res.status !== 200) return null;

    const nameMatch = res.body.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
    const name = nameMatch ? nameMatch[1].trim() : 'Fire TV';

    // Skip Roku devices — they advertise via SSDP/DIAL but aren't Fire TVs
    const isRoku = /roku-com/i.test(res.body) || /urn:roku-com/i.test(res.body);
    if (isRoku) {
      console.log(`[Fling] Skipping Roku device: ${name}`);
      return null;
    }

    const appUrl = res.headers['application-url'] || res.headers['Application-URL'];
    if (!appUrl) return null;

    const u = new URL(appUrl);
    return {
      name,
      host: u.hostname,
      dialPort: parseInt(u.port || '80', 10),
      dialPath: u.pathname.replace(/\/$/, '')
    };
  } catch {
    return null;
  }
}

/**
 * Ensure ADB is connected to the device. Reconnects if needed.
 */
async function adbConnect(host) {
  try {
    const out = await run(`adb connect ${host}:${ADB_PORT}`);
    // "connected" or "already connected" = good; "failed"/"unable" = bad
    if (out.includes('failed') || out.includes('unable')) {
      throw new Error(out);
    }
    return true;
  } catch (err) {
    throw new Error(`ADB connect to ${host}:${ADB_PORT} failed: ${err.message}`);
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

    // Port 8008 = Chromecast — skip, castv2 handles those
    if (info.dialPort === 8008) return;

    const id = `firetv-${info.host}`;
    if (!devices.has(id)) {
      console.log(`[Fling] Discovered: ${info.name} (${info.host})`);
      // Pre-connect ADB and apply kiosk settings so first cast is instant
      adbConnect(info.host)
        .then(() => setupKiosk(info.host))
        .catch((err) => {
          console.warn(`[Fling] ADB pre-connect failed for ${info.host}: ${err.message}`);
        });
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

  function scan() { ssdp.search(DIAL_ST); }
  scan();
  setInterval(scan, 30_000);
  console.log('[Fling] Scanning for Fire TV devices...');
}

function getDevices() {
  return Array.from(devices.values());
}

// ── Kiosk setup ───────────────────────────────────────────────────────────────

/**
 * Configure Fire TV for unattended kiosk/signage use.
 * Safe to call multiple times — all settings are idempotent.
 */
async function setupKiosk(host) {
  const s = `adb -s ${host}:${ADB_PORT} shell`;
  try {
    // Stay on while plugged in (1=AC, 2=USB, 3=both)
    await run(`${s} settings put global stay_on_while_plugged_in 3`);
    // Max screen timeout (never sleep)
    await run(`${s} settings put system screen_off_timeout 2147483647`);
    // Immersive mode: hide nav + status bar for all apps
    await run(`${s} settings put global policy_control 'immersive.full=*'`);

    // Disable screensaver/daydream
    await run(`${s} settings put secure screensaver_enabled 0`);
    console.log(`[Fling] Kiosk mode configured on ${host}`);
  } catch (err) {
    console.warn(`[Fling] Kiosk setup warning on ${host}: ${err.message}`);
  }
}

/**
 * Get the task ID of the currently running Silk Browser instance.
 */
async function getSilkTaskId(host) {
  try {
    const out = await run(`adb -s ${host}:${ADB_PORT} shell am stack list`);
    const match = out.match(/taskId=(\d+): com\.amazon\.cloud9/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Cast control ──────────────────────────────────────────────────────────────

/**
 * Launch a URL on a Fire TV via ADB browser intent.
 */
async function castUrl(deviceId, url) {
  const device = devices.get(deviceId);
  if (!device) throw new Error(`Fire TV device ${deviceId} not found`);

  await adbConnect(device.host);

  // Wake the screen in case it went dark
  await run(`adb -s ${device.host}:${ADB_PORT} shell input keyevent KEYCODE_WAKEUP`);

  const escaped = url.replace(/'/g, "'\\''");
  // Flags: FLAG_ACTIVITY_NEW_TASK (0x10000000) | FLAG_ACTIVITY_CLEAR_TASK (0x00008000)
  await run(
    `adb -s ${device.host}:${ADB_PORT} shell am start ` +
    `-a android.intent.action.VIEW ` +
    `-f 0x10008000 ` +
    `-d '${escaped}'`
  );

  return { ok: true };
}

/**
 * Stop the running FTSign app on a Fire TV via ADB.
 */
async function stopCast(deviceId) {
  const device = devices.get(deviceId);
  if (!device) return;

  await adbConnect(device.host);
  await run(`adb -s ${device.host}:${ADB_PORT} shell am force-stop ${FIRE_APP_ID}`);

  return { ok: true };
}

module.exports = { init, getDevices, castUrl, stopCast };
