'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const dgram = require('dgram');
const { Bonjour } = require('bonjour-service');

const isDev = process.argv.includes('--dev');
const DATA_DIR = app.getPath('userData');
const ID_FILE = path.join(DATA_DIR, 'device-id.json');

// Stable device ID
function getDeviceId() {
  try {
    const data = JSON.parse(fs.readFileSync(ID_FILE, 'utf8'));
    return data.id;
  } catch {
    const id = uuidv4();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ID_FILE, JSON.stringify({ id }));
    return id;
  }
}

const DEVICE_ID = getDeviceId();
let mainWindow;
let ws;
let controllerHost = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let heartbeatInterval = 10;
let lastSignUrl = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: !isDev,
    kiosk: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#000000',
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  showWaiting();
}

function showWaiting(message = 'Connecting to FTSign Controller...') {
  const html = `data:text/html,<!DOCTYPE html><html><head><style>
    body{background:#0f1117;color:#6366f1;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;flex-direction:column;gap:1rem}
    h2{font-size:3vw}p{color:#64748b;font-size:1.5vw}small{color:#374151}
  </style></head><body>
    <h2>📺 FTSign Player</h2>
    <p>${message}</p>
    <small>Device ID: ${DEVICE_ID.slice(0, 8)}...</small>
  </body></html>`;
  mainWindow.loadURL(html);
}

// mDNS discovery
function discoverController() {
  if (process.env.FTSIGN_CONTROLLER) {
    controllerHost = process.env.FTSIGN_CONTROLLER;
    connectWS();
    return;
  }

  const DISC_PORT = parseInt(process.env.FTSIGN_DISCOVERY_PORT || '3002', 10);
  let found = false;

  // UDP broadcast
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.bind(DISC_PORT, () => { udp.setBroadcast(true); });
  udp.on('message', (buf, rinfo) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg.type !== 'FTSIGN_CONTROLLER') return;
      const wsUrl = 'ws://' + rinfo.address + ':' + msg.port + '/ws';
      if (!found) { found = true; try { udp.close(); } catch {} }
      if (controllerHost !== wsUrl) { controllerHost = wsUrl; connectWS(); }
    } catch {}
  });

  // mDNS fallback
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'ftsign' });
  browser.on('up', (service) => {
    if (found) return;
    found = true;
    const host = service.host || (service.addresses && service.addresses[0]) || 'localhost';
    const port = service.port || 3000;
    controllerHost = 'ws://' + host + ':' + port + '/ws';
    bonjour.destroy();
    connectWS();
  });

  setTimeout(() => {
    if (!found) {
      bonjour.destroy();
      const fallback = process.env.FTSIGN_CONTROLLER || 'ws://localhost:3000/ws';
      console.log('[Discovery] Timeout — trying fallback: ' + fallback);
      controllerHost = fallback;
      connectWS();
    }
  }, 15000);
}

function connectWS() {
  if (ws) { try { ws.terminate(); } catch {} }
  clearTimeout(reconnectTimer);

  showWaiting(`Connecting to ${controllerHost}...`);

  ws = new WebSocket(controllerHost);

  ws.on('open', () => {
    console.log('[WS] Connected');
    const { width, height } = mainWindow.getBounds();
    ws.send(JSON.stringify({
      type: 'REGISTER',
      device_id: DEVICE_ID,
      timestamp: new Date().toISOString(),
      payload: {
        display_name: require('os').hostname(),
        platform: 'electron',
        capabilities: { w: width, h: height, orientation: width >= height ? 'landscape' : 'portrait', webgl: true },
        software_version: app.getVersion(),
        ip: getLocalIP()
      }
    }));

    // Heartbeat
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'HEARTBEAT',
          device_id: DEVICE_ID,
          timestamp: new Date().toISOString(),
          payload: { uptime_sec: Math.floor(process.uptime()), ip: getLocalIP(), current_sign_id: null, free_mem_mb: Math.floor(process.memoryUsage().rss / 1024 / 1024) }
        }));
      }
    }, heartbeatInterval * 1000);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleMessage(msg);
  });

  ws.on('close', () => {
    console.log('[WS] Disconnected — reconnecting in 5s');
    clearInterval(heartbeatTimer);
    showWaiting('Connection lost. Reconnecting...');
    reconnectTimer = setTimeout(() => connectWS(), 5000);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'REGISTER_OK': {
      const { heartbeat_interval_sec, current_assignment } = msg.payload || {};
      if (heartbeat_interval_sec) heartbeatInterval = heartbeat_interval_sec;
      if (current_assignment?.sign_id) {
        console.log(`[WS] Got existing assignment: ${current_assignment.sign_id}`);
      }
      break;
    }
    case 'LOAD_SIGN': {
      const { url, mode } = msg.payload || {};
      if (url) {
        console.log(`[WS] Loading sign: ${url}`);
        lastSignUrl = url;
        const startTime = Date.now();
        mainWindow.loadURL(url).then(() => {
          const renderMs = Date.now() - startTime;
          ws.send(JSON.stringify({
            type: 'ACK',
            request_id: msg.request_id,
            device_id: DEVICE_ID,
            timestamp: new Date().toISOString(),
            payload: { status: 'rendered', sign_id: msg.payload?.sign_id, render_time_ms: renderMs }
          }));
        }).catch((err) => {
          ws.send(JSON.stringify({
            type: 'ERROR',
            request_id: msg.request_id,
            device_id: DEVICE_ID,
            payload: { code: 'LOAD_FAILED', message: err.message }
          }));
        });
      }
      break;
    }
    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG', device_id: DEVICE_ID, timestamp: new Date().toISOString() }));
      break;
  }
}

function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

app.whenReady().then(() => {
  createWindow();
  discoverController();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ESC to exit kiosk (dev convenience)
if (isDev) {
  const { globalShortcut } = require('electron');
  app.whenReady().then(() => globalShortcut.register('Escape', () => app.quit()));
}
