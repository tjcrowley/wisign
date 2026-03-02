'use strict';
/**
 * Chromecast / Cast-enabled device manager
 *
 * Uses castv2-client + Puppeteer screenshots to cast sign content via the
 * Default Media Receiver — no Cast developer registration required.
 *
 * Playlist support: server-side loop per device, cycling screenshots on a timer.
 */

const { Client, DefaultMediaReceiver } = require('castv2-client');
const Bonjour = require('bonjour-service').Bonjour;

const devices  = new Map(); // device_id -> device info
const clients  = new Map(); // device_id -> castv2 Client
const playlists = new Map(); // device_id -> { items, index, timer, baseUrl }

function init() {
  const bonjour  = new Bonjour();
  const browser  = bonjour.find({ type: 'googlecast' });

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
      console.log(`[Cast] Lost: ${dev.name}`);
    }
  });

  console.log('[Cast] Scanning for Cast devices...');
}

function getDevices() {
  return Array.from(devices.values()).map(d => ({
    ...d,
    playlist: playlists.has(d.id) ? {
      index:    playlists.get(d.id).index,
      total:    playlists.get(d.id).items.length,
      sign_id:  playlists.get(d.id).items[playlists.get(d.id).index]?.sign_id
    } : null
  }));
}

// ── Connection ────────────────────────────────────────────────────────────────

function connectDevice(deviceId) {
  return new Promise((resolve, reject) => {
    const device = devices.get(deviceId);
    if (!device) return reject(new Error(`Device ${deviceId} not found`));

    if (clients.has(deviceId)) return resolve(clients.get(deviceId));

    const client = new Client();
    client.connect({ host: device.host, port: device.port }, () => {
      clients.set(deviceId, client);
      resolve(client);
    });
    client.on('error', () => clients.delete(deviceId));
    client.on('close',  () => clients.delete(deviceId));
  });
}

// ── Single sign cast ──────────────────────────────────────────────────────────

async function castUrl(deviceId, url) {
  const client = await connectDevice(deviceId);
  return new Promise((resolve, reject) => {
    client.launch(DefaultMediaReceiver, (err, player) => {
      if (err) return reject(err);
      const media = {
        contentId:   url,
        contentType: 'image/jpeg',
        streamType:  'NONE',
        metadata: { type: 0, metadataType: 0, title: 'WiSign' }
      };
      player.load(media, { autoplay: true }, (err, status) => {
        if (err) return reject(err);
        resolve(status);
      });
    });
  });
}

// ── Playlist cast ─────────────────────────────────────────────────────────────

/**
 * Start a server-side playlist loop on a cast device.
 * @param {string} deviceId
 * @param {Array}  items    - [{ sign_id, duration_sec }, ...]
 * @param {string} baseUrl  - e.g. http://192.168.x.x:3000
 */
async function castPlaylist(deviceId, items, baseUrl) {
  if (!items || !items.length) throw new Error('Playlist has no items');

  // Stop any existing loop on this device
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
      console.error(`[Cast] Playlist cast error on ${deviceId}:`, err.message);
    }

    if (!state.active) return;

    // Advance index and schedule next
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

// ── Stop all ──────────────────────────────────────────────────────────────────

async function stopCast(deviceId) {
  stopPlaylist(deviceId);
  const client = clients.get(deviceId);
  if (!client) return;
  return new Promise((resolve) => client.stop(resolve));
}

module.exports = { init, getDevices, castUrl, castPlaylist, stopCast };
