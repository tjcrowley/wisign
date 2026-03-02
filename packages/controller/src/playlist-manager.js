'use strict';
/**
 * Playlist Manager
 * Tracks the current position in a playlist for each screen,
 * and sends LOAD_SIGN at the right intervals.
 */
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// screen_id -> { playlist_id, index, timer }
const state = new Map();

let _fastify = null;

function init(fastify) {
  _fastify = fastify;
}

function getRenderUrl(sign_id) {
  return `http://${_fastify.serverHost}:${_fastify.serverPort}/api/signs/${sign_id}/render`;
}

function getPlaylist(playlist_id) {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlist_id);
  if (!p) return null;
  p.items = JSON.parse(p.items || '[]');
  return p;
}

const lastSent = new Map(); // screen_id -> sign_id

function sendSign(screen, sign_id) {
  if (lastSent.get(screen.id) === sign_id) {
    // Only skip duplicate if it was JUST sent (not a rotation)
  }
  const ws = _fastify.wsClients?.get(screen.device_id);
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type: 'LOAD_SIGN',
    request_id: uuidv4(),
    timestamp: new Date().toISOString(),
    payload: { mode: 'url', url: getRenderUrl(sign_id), sign_id, cache_policy: 'no-cache' }
  }));
}

function scheduleNext(screen_id, device_id, playlist_id, index) {
  const existing = state.get(screen_id);
  if (existing?.timer) clearTimeout(existing.timer);

  const playlist = getPlaylist(playlist_id);
  if (!playlist || !playlist.items.length) return;

  const item = playlist.items[index % playlist.items.length];
  if (!item) return;

  const timer = setTimeout(() => {
    const newIndex = (index + 1) % playlist.items.length;
    const nextItem = playlist.items[newIndex];

    // Update state
    state.set(screen_id, { playlist_id, index: newIndex, timer: null });
    db.prepare("UPDATE screens SET current_assignment = ? WHERE id = ?")
      .run(JSON.stringify({ mode: 'playlist', playlist_id, index: newIndex }), screen_id);

    // Push next sign
    const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(screen_id);
    if (screen) sendSign(screen, nextItem.sign_id);

    // Schedule the one after
    scheduleNext(screen_id, device_id, playlist_id, newIndex);
  }, item.duration_sec * 1000);

  state.set(screen_id, { playlist_id, index, timer });
}

/**
 * Start or resume a playlist on a screen.
 * If resumeIndex is provided, starts from that position.
 */
function startPlaylist(screen, playlist_id, resumeIndex = 0, skipSend = false) {
  const playlist = getPlaylist(playlist_id);
  if (!playlist || !playlist.items.length) return;

  const index = resumeIndex % playlist.items.length;
  const item = playlist.items[index];

  // Send current sign immediately (unless skipping)
  if (!skipSend) sendSign(screen, item.sign_id);

  // Update DB
  db.prepare("UPDATE screens SET current_assignment = ? WHERE id = ?")
    .run(JSON.stringify({ mode: 'playlist', playlist_id, index }), screen.id);

  // Schedule rotation
  scheduleNext(screen.id, screen.device_id, playlist_id, index);
}

/** Stop a playlist on a screen */
function stopPlaylist(screen_id) {
  const s = state.get(screen_id);
  if (s?.timer) clearTimeout(s.timer);
  state.delete(screen_id);
}

/** Resume playlist after player reconnects */
function resumeIfNeeded(screen) {
  const assignment = screen.current_assignment ? JSON.parse(screen.current_assignment) : null;
  if (assignment?.mode !== 'playlist') return false;
  // Resume from saved index
  startPlaylist(screen, assignment.playlist_id, assignment.index || 0);
  return true;
}

/** Get current state for all screens */
function getState() {
  const result = {};
  for (const [screen_id, s] of state.entries()) {
    result[screen_id] = { playlist_id: s.playlist_id, index: s.index };
  }
  return result;
}

module.exports = { init, startPlaylist, stopPlaylist, resumeIfNeeded, getState };
