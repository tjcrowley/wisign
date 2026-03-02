'use strict';
/**
 * FTSign Chromecast manager
 *
 * Launches DefaultMediaReceiver once per device and reuses the player
 * session for all subsequent loads — avoids "Load cancelled" errors
 * that occur when re-launching the app for every playlist slide.
 */

const { Client, DefaultMediaReceiver } = require('castv2-client');
const Bonjour = require('bonjour-service').Bonjour;

const devices   = new Map(); // device_id -> device info
const clients   = new Map(); // device_id -> { client, player }
const playlists = new Map(); // device_id -> { items, index, timer, baseUrl, active }

// ── Discovery ─────────────────────────────────────────────────────────────────

function init() {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'googlecast' });

  browser.on('up', (service) => {
    const id = service.txt?.id || service.name;
    const existing = devices.get(id);
    const info = {
      id,
      name:   service.txt?.fn || service.name,
      host:   service.host || (service.addresses && service.addresses[0]),
      port:   service.port || 8009,
      model:  service.txt?.md || 'Unknown',
      status: 'available'
    };
    devices.set(id, info);
    if (!existing) console.log(`[Cast] Discovered: ${info.name} (${info.host})`);
  });

  browser.on('down', (service) => {
    const id = service.txt?.id || service.name;
    const dev = devices.get(id);
    if (dev) {
      dev.status = 'unavailable';
      clients.delete(id);
      console.log(`[Cast] Lost: ${dev.name}`);
    }
  });

  console.log('[Cast] Scanning for Cast devices...');
}

function getDevices() {
  return Array.from(devices.values()).map(d => ({
    ...d,
    playlist: playlists.has(d.id) ? {
      index:   playlists.get(d.id).index,
      total:   playlists.get(d.id).items.length,
      sign_id: playlists.get(d.id).items[playlists.get(d.id).index]?.sign_id
    } : null
  }));
}

// ── Session management ────────────────────────────────────────────────────────

/**
 * Get (or create) a { client, player } session for a device.
 * Launches DefaultMediaReceiver only once; subsequent calls reuse the player.
 */
function getSession(deviceId) {
  return new Promise((resolve, reject) => {
    const existing = clients.get(deviceId);
    if (existing && existing.player) return resolve(existing);

    const device = devices.get(deviceId);
    if (!device) return reject(new Error(`Device ${deviceId} not found`));

    const client = new Client();
    client.setMaxListeners(20);

    client.connect({ host: device.host, port: device.port }, () => {
      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          client.close();
          return reject(err);
        }
        const session = { client, player };
        clients.set(deviceId, session);

        // Clean up session if player or client closes
        player.on('close', () => clients.delete(deviceId));
        client.on('error', () => clients.delete(deviceId));
        client.on('close', () => clients.delete(deviceId));

        resolve(session);
      });
    });

    client.on('error', (err) => {
      clients.delete(deviceId);
      reject(err);
    });
  });
}

// ── Single image load ─────────────────────────────────────────────────────────

async function castUrl(deviceId, url) {
  // If session is stale (e.g. after network change), clear it so we reconnect
  const session = await getSession(deviceId);

  return new Promise((resolve, reject) => {
    const media = {
      contentId:   url,
      contentType: 'image/jpeg',
      streamType:  'NONE',
      metadata: { type: 0, metadataType: 0, title: 'FTSign' }
    };
    session.player.load(media, { autoplay: true }, (err, status) => {
      if (err) {
        // Session may be dead — clear it so next call reconnects
        clients.delete(deviceId);
        return reject(err);
      }
      resolve(status);
    });
  });
}

// ── Playlist loop ─────────────────────────────────────────────────────────────

async function castPlaylist(deviceId, items, baseUrl) {
  if (!items || !items.length) throw new Error('Playlist has no items');

  stopPlaylist(deviceId);

  const state = { items, index: 0, baseUrl, timer: null, active: true };
  playlists.set(deviceId, state);

  async function castNext() {
    if (!state.active) return;

    const item = state.items[state.index];
    const url  = `${baseUrl}/api/signs/${item.sign_id}/screenshot.jpg`;

    try {
      await castUrl(deviceId, url);
      console.log(`[Cast] Playlist ${deviceId}: sign ${state.index + 1}/${state.items.length} (${item.duration_sec}s)`);
    } catch (err) {
      console.error(`[Cast] Playlist error on ${deviceId}:`, err.message);
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

// ── Stop ──────────────────────────────────────────────────────────────────────

async function stopCast(deviceId) {
  stopPlaylist(deviceId);
  const session = clients.get(deviceId);
  clients.delete(deviceId);
  if (!session) return;
  return new Promise((resolve) => {
    try { session.client.stop(resolve); } catch { resolve(); }
  });
}

module.exports = { init, getDevices, castUrl, castPlaylist, stopCast };
