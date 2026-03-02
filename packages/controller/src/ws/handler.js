'use strict';
const playlistManager = require('../playlist-manager');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const HEARTBEAT_INTERVAL = 10; // seconds
const DEGRADED_MISSED = 3;
const OFFLINE_MISSED = 10;

// Map of device_id -> { ws, missedHeartbeats, timer }
const connections = new Map();
// Map of device_id -> ws (shared with assign route)
const wsClients = new Map();

let _fastify;
function setup(fastify) {
  _fastify = fastify;
  fastify.wsClients = wsClients;
  fastify.get("/ws", { websocket: true }, (connection, req) => {
    const socket = connection.socket;
    const remoteAddr = req.socket?.remoteAddress || req.ip || "unknown";
    console.log("[WS] New connection from " + remoteAddr);
    let deviceId = null;

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'REGISTER': handleRegister(socket, msg); break;
        case 'HEARTBEAT': handleHeartbeat(socket, msg); break;
        case 'ACK': handleAck(msg); break;
        case 'ERROR': handleError(msg); break;
        case 'PONG': break;
      }

      if (msg.device_id) deviceId = msg.device_id;
    });

    socket.on('ping', () => socket.pong());
    socket.on('close', () => {
      if (deviceId) {
        const conn = connections.get(deviceId);
        if (conn) clearInterval(conn.timer);
        connections.delete(deviceId);
        wsClients.delete(deviceId);
        db.prepare("UPDATE screens SET status = 'offline' WHERE device_id = ?").run(deviceId);
        console.log(`[WS] Disconnected: ${deviceId}`);
      }
    });
  });

  // Offline detection loop
  setInterval(() => {
    for (const [devId, conn] of connections.entries()) {
      conn.missedHeartbeats++;
      if (conn.missedHeartbeats >= OFFLINE_MISSED) {
        db.prepare("UPDATE screens SET status='offline' WHERE device_id=?").run(devId);
      } else if (conn.missedHeartbeats >= DEGRADED_MISSED) {
        db.prepare("UPDATE screens SET status='degraded' WHERE device_id=?").run(devId);
      }
    }
  }, HEARTBEAT_INTERVAL * 1000);
}

function handleRegister(socket, msg) {
  const { device_id, payload = {} } = msg;
  if (!device_id) return;

  const existing = db.prepare('SELECT * FROM screens WHERE device_id = ?').get(device_id);
  let screenId;

  if (existing) {
    screenId = existing.id;
    db.prepare(`UPDATE screens SET status='online', last_seen_at=datetime('now'), platform=?, capabilities=?, software_version=?, ip=? WHERE device_id=?`)
      .run(payload.platform || existing.platform, JSON.stringify(payload.capabilities || {}), payload.software_version || '', payload.ip || '', device_id);
  } else {
    screenId = uuidv4();
    db.prepare(`INSERT INTO screens (id, device_id, display_name, platform, capabilities, software_version, ip, status, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'))`)
      .run(screenId, device_id, payload.display_name || 'New Screen', payload.platform || 'unknown', JSON.stringify(payload.capabilities || {}), payload.software_version || '', payload.ip || '');
  }

  wsClients.set(device_id, socket);
  connections.set(device_id, { ws: socket, missedHeartbeats: 0 });

  const screen = db.prepare('SELECT * FROM screens WHERE device_id = ?').get(device_id);
  const currentAssignment = screen.current_assignment ? JSON.parse(screen.current_assignment) : null;

  const reply = {
    type: 'REGISTER_OK',
    timestamp: new Date().toISOString(),
    payload: {
      screen_id: screenId,
      controller_time: new Date().toISOString(),
      heartbeat_interval_sec: HEARTBEAT_INTERVAL,
      current_assignment: currentAssignment
    }
  };
  socket.send(JSON.stringify(reply));

  // Resume playlist or push existing sign
  if (!playlistManager.resumeIfNeeded(screen)) {
  if (currentAssignment?.sign_id) {
    const renderUrl = `http://${_fastify.serverHost}:${_fastify.serverPort}/api/signs/${currentAssignment.sign_id}/render`;
    socket.send(JSON.stringify({
      type: 'LOAD_SIGN',
      request_id: uuidv4(),
      timestamp: new Date().toISOString(),
      payload: { mode: 'url', url: renderUrl, cache_policy: 'no-cache' }
    }));
  }
  } // end resumeIfNeeded

  console.log(`[WS] Registered: ${payload.display_name || device_id} (${payload.platform})`);
}

function handleHeartbeat(socket, msg) {
  const { device_id, payload = {} } = msg;
  if (!device_id) return;

  const conn = connections.get(device_id);
  if (conn) conn.missedHeartbeats = 0;

  db.prepare("UPDATE screens SET status='online', last_seen_at=datetime('now'), ip=COALESCE(?,ip) WHERE device_id=?")
    .run(payload.ip || null, device_id);
}

function handleAck(msg) {
  const { device_id, payload = {} } = msg;
  console.log(`[WS] ACK from ${device_id}: sign=${payload.sign_id} status=${payload.status} render_ms=${payload.render_time_ms}`);
}

function handleError(msg) {
  const { device_id, payload = {} } = msg;
  console.error(`[WS] ERROR from ${device_id}: ${payload.code} - ${payload.message}`);
}

module.exports = { setup };
