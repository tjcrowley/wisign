#!/usr/bin/env node
'use strict';
/**
 * WiSign Pi Agent
 * Connects to the WiSign controller via WebSocket and controls
 * Chromium via the Chrome DevTools Protocol (CDP).
 */

const http = require('http');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const { Bonjour } = require('bonjour-service');

const PORT        = parseInt(process.env.WISIGN_PORT || '3000', 10);
const CDP_PORT    = parseInt(process.env.WISIGN_CDP_PORT || '9222', 10);
const CONTROLLER  = process.env.WISIGN_CONTROLLER || null;
const DEV         = process.env.WISIGN_DEV === '1';
const DATA_DIR    = process.env.WISIGN_DATA || path.join(os.homedir(), '.wisign-player');
const ID_FILE     = path.join(DATA_DIR, 'device-id.json');
const HB_INTERVAL = 10;

function getDeviceId() {
  try { return JSON.parse(fs.readFileSync(ID_FILE, 'utf8')).id; } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const id = uuidv4();
  fs.writeFileSync(ID_FILE, JSON.stringify({ id }));
  return id;
}

const DEVICE_ID = getDeviceId();
console.log(`[WiSign Pi] Device ID: ${DEVICE_ID}`);

let chromiumProc = null;
let cdpWs = null;
let cdpMsgId = 1;

function findChromium() {
  for (const bin of ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome']) {
    try { execSync(`which ${bin}`, { stdio: 'ignore' }); return bin; } catch {}
  }
  return null;
}

function launchChromium() {
  const bin = findChromium();
  if (!bin) {
    console.error('[Chromium] Not found! Run: sudo apt install -y chromium-browser');
    return;
  }
  const flags = [
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-infobars', '--disable-session-crashed-bubble',
    '--disable-features=TranslateUI', '--noerrdialogs',
    '--autoplay-policy=no-user-gesture-required',
    '--check-for-update-interval=604800',
    DEV ? '--window-size=1280,720' : '--kiosk',
    'about:blank'
  ];
  console.log(`[Chromium] Launching ${bin}...`);
  chromiumProc = spawn(bin, flags, { stdio: 'ignore' });
  chromiumProc.on('exit', (code) => {
    console.log(`[Chromium] Exited (${code}) — restarting in 3s`);
    chromiumProc = null;
    setTimeout(launchChromium, 3000);
  });
}

function cdpGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function connectCDP() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await cdpGet('/json');
      const page = targets.find(t => t.type === 'page');
      if (page) {
        cdpWs = new WebSocket(page.webSocketDebuggerUrl);
        cdpWs.on('open', () => console.log('[CDP] Connected'));
        cdpWs.on('close', () => { cdpWs = null; setTimeout(connectCDP, 2000); });
        cdpWs.on('error', () => { cdpWs = null; });
        return;
      }
    } catch {}
    await sleep(1000);
  }
  console.error('[CDP] Failed to connect to Chromium after 30s');
}

function cdpSend(method, params = {}) {
  if (!cdpWs || cdpWs.readyState !== WebSocket.OPEN) return;
  cdpWs.send(JSON.stringify({ id: cdpMsgId++, method, params }));
}

function navigateTo(url) {
  console.log(`[CDP] Navigate → ${url}`);
  cdpSend('Page.navigate', { url });
}

function showMessage(title, sub = '') {
  const enc = encodeURIComponent(
    `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}body{background:#0f1117;color:#6366f1;` +
    `font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;` +
    `height:100vh;flex-direction:column;gap:1rem;text-align:center}` +
    `h2{font-size:3vw}p{color:#64748b;font-size:1.5vw}small{color:#374151;font-size:1vw}` +
    `</style></head><body><h2>📺 WiSign</h2><p>${title}</p><small>${sub}</small></body></html>`
  );
  navigateTo(`data:text/html,${enc}`);
}

let wisignWs = null;
let heartbeatTimer = null;

function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface?.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}

function connectController(wsUrl) {
  if (wisignWs) { try { wisignWs.terminate(); } catch {} }
  console.log(`[WiSign] Connecting to ${wsUrl}`);
  showMessage('Connecting to controller...', wsUrl);

  wisignWs = new WebSocket(wsUrl);

  wisignWs.on('open', () => {
    wisignWs.send(JSON.stringify({
      type: 'REGISTER', device_id: DEVICE_ID, timestamp: new Date().toISOString(),
      payload: {
        display_name: os.hostname(), platform: 'raspberry_pi',
        capabilities: { w: 1920, h: 1080, orientation: 'landscape', webgl: true },
        software_version: '0.1.0', ip: getLocalIP()
      }
    }));
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (wisignWs?.readyState === WebSocket.OPEN) {
        wisignWs.send(JSON.stringify({
          type: 'HEARTBEAT', device_id: DEVICE_ID, timestamp: new Date().toISOString(),
          payload: { uptime_sec: Math.floor(os.uptime()), ip: getLocalIP(), free_mem_mb: Math.floor(os.freemem() / 1048576) }
        }));
      }
    }, HB_INTERVAL * 1000);
  });

  wisignWs.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'REGISTER_OK':
        console.log('[WiSign] Registered ✓');
        if (!msg.payload?.current_assignment?.sign_id) showMessage('Ready', os.hostname());
        break;
      case 'LOAD_SIGN': {
        const { url } = msg.payload || {};
        if (url) {
          navigateTo(url);
          wisignWs.send(JSON.stringify({
            type: 'ACK', request_id: msg.request_id, device_id: DEVICE_ID,
            timestamp: new Date().toISOString(),
            payload: { status: 'rendered', sign_id: msg.payload?.sign_id, render_time_ms: 0 }
          }));
        }
        break;
      }
      case 'PING':
        wisignWs.send(JSON.stringify({ type: 'PONG', device_id: DEVICE_ID, timestamp: new Date().toISOString() }));
        break;
    }
  });

  wisignWs.on('close', () => {
    console.log('[WiSign] Disconnected — reconnecting in 5s');
    clearInterval(heartbeatTimer);
    showMessage('Connection lost', 'Reconnecting...');
    setTimeout(() => connectController(wsUrl), 5000);
  });

  wisignWs.on('error', err => console.error('[WiSign] Error:', err.message));
}

function discover() {
  if (CONTROLLER) { connectController(CONTROLLER); return; }
  console.log('[Discovery] Scanning for WiSign controller...');
  showMessage('Scanning for controller...', 'mDNS');
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'wisign' });
  let found = false;
  browser.on('up', (svc) => {
    if (found) return; found = true;
    const host = svc.host || svc.addresses?.[0] || 'localhost';
    bonjour.destroy();
    connectController(`ws://${host}:${svc.port || 3000}/ws`);
  });
  setTimeout(() => {
    if (!found) { bonjour.destroy(); connectController(`ws://localhost:${PORT}/ws`); }
  }, 15000);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  launchChromium();
  await sleep(2500);
  await connectCDP();
  await sleep(300);
  discover();
}

main().catch(err => { console.error(err); process.exit(1); });
