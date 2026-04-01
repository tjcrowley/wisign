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

// Persistent player state — avoids re-navigating the browser between signs
// (address bar appears on every am start; with the player page it only appears once)
const deviceState    = new Map(); // deviceId -> { url, orientation }
const playerLaunched = new Set(); // deviceIds where player page is already running

// Set by init() so castUrl can build the player URL
let _serverHost = 'localhost';
let _serverPort = 3000;

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

function init(fastify) {
  if (fastify) {
    _serverHost = fastify.serverHost || 'localhost';
    _serverPort = fastify.serverPort || 3000;
  }
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

  // ── Wake heartbeat — keeps Fire TVs from sleeping ──────────────────────────
  // Sends KEYCODE_WAKEUP + re-applies kiosk settings every 4 minutes
  setInterval(async () => {
    for (const device of devices.values()) {
      try {
        const s = `adb -s ${device.host}:${ADB_PORT} shell`;
        await run(`${s} input keyevent KEYCODE_WAKEUP`);
        await run(`${s} settings put global stay_on_while_plugged_in 3`);
        await run(`${s} settings put system screen_off_timeout 2147483647`);
        await run(`${s} settings put global policy_control immersive.full=\\*`);
        console.log(`[Fling] Wake heartbeat sent to ${device.name}`);
      } catch (err) {
        console.warn(`[Fling] Wake heartbeat failed for ${device.name}: ${err.message}`);
      }
    }
  }, 4 * 60 * 1000);
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
    await run(`${s} settings put global policy_control immersive.full=\\*`);

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
 * Update the sign shown by the persistent player page.
 * If the player isn't running yet, launch it via ADB (only happens once per device).
 * Subsequent sign changes just update the state — no browser navigation, no address bar.
 *
 * @param {string} deviceId
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.orientation] - 'landscape' (default) or 'portrait'
 */
async function castUrl(deviceId, url, options = {}) {
  const device = devices.get(deviceId);
  if (!device) throw new Error(`Fire TV device ${deviceId} not found`);

  const orientation = options.orientation || 'landscape';

  // Always update state first so the player can pick it up immediately
  deviceState.set(deviceId, { url, orientation });

  if (!playerLaunched.has(deviceId)) {
    playerLaunched.add(deviceId);

    await adbConnect(device.host);
    await run(`adb -s ${device.host}:${ADB_PORT} shell input keyevent KEYCODE_WAKEUP`);

    // Launch the persistent player page — this is the ONLY am start we ever do
    const playerUrl = `http://${_serverHost}:${_serverPort}/api/fling/player/${deviceId}`;
    const escaped   = playerUrl.replace(/'/g, "'\\''");
    await run(
      `adb -s ${device.host}:${ADB_PORT} shell am start ` +
      `-a android.intent.action.VIEW -f 0x10008000 -d '${escaped}'`
    );

    // Post-launch: re-apply immersive mode + tap to dismiss address bar
    // Two passes: first at 2s (page loading), second at 5s (fully rendered)
    const postLaunchKiosk = async () => {
      try {
        const s = `adb -s ${device.host}:${ADB_PORT} shell`;
        await run(`${s} settings put global policy_control immersive.full=\\*`);
        await run(`${s} input tap 960 540`);
        console.log(`[Fling] Post-launch kiosk tap sent to ${device.host}`);
      } catch (err) {
        console.warn(`[Fling] Post-launch kiosk step failed: ${err.message}`);
      }
    };
    setTimeout(postLaunchKiosk, 2000);
    setTimeout(postLaunchKiosk, 5000);
    setTimeout(postLaunchKiosk, 10000);
  }
  // Player is running — it polls /api/fling/state/:id and will pick up the new URL

  return { ok: true };
}

/**
 * Stop the running player and clear all state for a device.
 */
async function stopCast(deviceId) {
  stopPlaylist(deviceId);
  deviceState.delete(deviceId);
  playerLaunched.delete(deviceId); // force re-launch next time

  const device = devices.get(deviceId);
  if (!device) return;

  await adbConnect(device.host);
  await run(`adb -s ${device.host}:${ADB_PORT} shell am force-stop ${FIRE_APP_ID}`);

  return { ok: true };
}

// ── Player state API ──────────────────────────────────────────────────────────

function getState(deviceId) {
  const state = deviceState.get(deviceId);
  if (!state) return null;
  return { url: state.url, orientation: state.orientation || 'landscape' };
}

function buildPlayerHtml(deviceId) {
  // Portrait rotation strategy:
  // Fire TV Silk Browser always reports a landscape viewport (980×490)
  // regardless of OS rotation settings. When the TV is physically turned
  // on its side, we need to rotate the iframe 90° inside the player page.
  //
  // The player polls /api/fling/state/:id which returns { url, orientation }.
  // When orientation is "portrait", we:
  //   1. Size the iframe to 490×980 (swapped dimensions)
  //   2. Rotate it 90° with transform-origin centered
  //   3. The physical TV rotation makes it read correctly
  //
  // This keeps the sign content completely untouched — it renders in its
  // native landscape layout and the player wrapper handles the rotation.

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=980, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  .wrap { position: fixed; inset: 0; overflow: hidden; }

  /* Landscape (default) — iframe fills viewport */
  #sign-frame {
    position: absolute;
    border: none; display: block;
    left: 0; top: 0;
    width: 100vw; height: 100vh;
  }

  /* Portrait — iframe is tall/narrow, rotated 90° CW.
     Silk viewport = 980×490. We make iframe 490×980 (portrait)
     then rotate it so it spans the full 980×490 landscape viewport.
     After physical TV rotation (90° CCW), the user sees 1080×1920 portrait. */
  body.portrait #sign-frame {
    width: 490px;
    height: 980px;
    left: 50%;
    top: 50%;
    transform: rotate(90deg) translate(-50%, -50%);
    transform-origin: 0 0;
  }
</style>
<script>
  var currentUrl = '';
  var currentOrientation = 'landscape';

  function goFullscreen() {
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (fn) fn.call(el).catch(function(){});
  }

  function applyOrientation(o) {
    if (o === currentOrientation) return;
    currentOrientation = o;
    if (o === 'portrait') {
      document.body.classList.add('portrait');
    } else {
      document.body.classList.remove('portrait');
    }
  }

  function poll() {
    fetch('/api/fling/state/${deviceId}')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data) {
          if (data.orientation) applyOrientation(data.orientation);
          if (data.url && data.url !== currentUrl) {
            currentUrl = data.url;
            document.getElementById('sign-frame').src = currentUrl;
          }
        }
      })
      .catch(function(){})
      .finally(function() { setTimeout(poll, 800); });
  }

  window.addEventListener('load', function() {
    goFullscreen();
    setTimeout(goFullscreen, 600);
    setTimeout(goFullscreen, 2500);
    setTimeout(goFullscreen, 5000);
    setTimeout(goFullscreen, 10000);
    poll();
  });
  // Also go fullscreen on any user interaction (required by some browsers)
  document.addEventListener('click', goFullscreen);
  document.addEventListener('touchstart', goFullscreen);
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      setTimeout(goFullscreen, 200);
    }
  });
</script>
</head>
<body>
  <div class="wrap">
    <iframe id="sign-frame" src="" scrolling="no" allowfullscreen></iframe>
  </div>
</body>
</html>`;
}

// ── Playlist loop (Fire TV) ───────────────────────────────────────────────────

const playlists = new Map(); // deviceId -> state

async function castPlaylist(deviceId, items, baseUrl, options = {}) {
  if (!items || !items.length) throw new Error('Playlist has no items');

  stopPlaylist(deviceId);

  const state = { items, index: 0, baseUrl, timer: null, active: true };
  playlists.set(deviceId, state);

  async function castNext() {
    if (!state.active) return;

    const item  = state.items[state.index];
    const db = require('./db');
    const sign = db.prepare('SELECT type FROM signs WHERE id = ?').get(item.sign_id);
    let renderUrl;
    if (sign && sign.type === 'tower_tv') {
      renderUrl = `${state.baseUrl}/tower-tv/index.html`;
    } else {
      const portrait = !!options.portrait;
      const params = new URLSearchParams({ kiosk: '1' });
      if (portrait) params.set('orientation', 'portrait');
      renderUrl = `${state.baseUrl}/api/signs/${item.sign_id}/render?${params}`;
    }

    try {
      // For playlist transitions: just update state — player polls and swaps iframe src
      // Use castUrl on first item (may need to launch player); after that it's a no-op launch
      const orientation = options.portrait ? 'portrait' : 'landscape';
      await castUrl(deviceId, renderUrl, { orientation });
      console.log(`[Fling] Playlist ${deviceId}: sign ${state.index + 1}/${state.items.length} (${item.duration_sec}s)`);
    } catch (err) {
      console.error(`[Fling] Playlist error on ${deviceId}:`, err.message);
    }

    if (!state.active) return;
    state.index = (state.index + 1) % state.items.length;
    state.timer = setTimeout(castNext, item.duration_sec * 1000);
  }

  await castNext();
  return { ok: true, total: items.length };
}

function stopPlaylist(deviceId) {
  const state = playlists.get(deviceId);
  if (!state) return;
  state.active = false;
  if (state.timer) clearTimeout(state.timer);
  playlists.delete(deviceId);
}

module.exports = { init, getDevices, castUrl, castPlaylist, stopCast, getState, buildPlayerHtml };
