'use strict';
const flingManager = require('../fling');

async function flingRoutes(fastify) {
  // List discovered Fire TV devices
  fastify.get('/api/fling/devices', async () => {
    return flingManager.getDevices();
  });

  // Cast a sign to a Fire TV
  fastify.post('/api/fling/assign', async (req, reply) => {
    const { device_id, sign_id, orientation = 'landscape' } = req.body || {};
    if (!device_id || !sign_id) return reply.code(400).send({ error: 'device_id and sign_id required' });

    const db = require('../db');
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
    if (!sign) return reply.code(404).send({ error: 'Sign not found' });

    // Fire TV is on the local LAN — use local HTTP URL (no Tailscale/HTTPS needed)
    let url;
    if (sign.type === 'tower_tv') {
      url = `http://${fastify.serverHost}:${fastify.serverPort}/tower-tv/index.html`;
    } else {
      const portrait = orientation === 'portrait';
      const params = new URLSearchParams({ kiosk: '1' });
      if (portrait) params.set('orientation', 'portrait');
      url = `http://${fastify.serverHost}:${fastify.serverPort}/api/signs/${sign_id}/render?${params}`;
    }

    try {
      // Pass orientation to the player wrapper — it handles CSS rotation
      const result = await flingManager.castUrl(device_id, url, { orientation });
      return { ok: true, url, orientation, ...result };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Persistent player page — loaded once, polls for sign updates (no address bar between signs)
  fastify.get('/api/fling/player/:deviceId', async (req, reply) => {
    reply.type('text/html').send(flingManager.buildPlayerHtml(req.params.deviceId));
  });

  // Current sign state for a device (polled by the player page)
  fastify.get('/api/fling/state/:deviceId', async (req) => {
    return flingManager.getState(req.params.deviceId) || { url: '', orientation: 'landscape' };
  });

  // Broadcast a sign or playlist to ALL discovered Fire TVs at once
  fastify.post('/api/fling/broadcast', async (req, reply) => {
    const { sign_id, playlist_id, orientation = 'landscape' } = req.body || {};
    if (!sign_id && !playlist_id) return reply.code(400).send({ error: 'sign_id or playlist_id required' });

    const db = require('../db');
    const devices = flingManager.getDevices();
    if (!devices.length) return reply.code(404).send({ error: 'No Fire TV devices discovered yet' });

    const results = [];
    const errors = [];

    await Promise.allSettled(devices.map(async (device) => {
      try {
        if (playlist_id) {
          // Fetch playlist items
          const items = db.prepare(
            `SELECT pi.sign_id, pi.duration_sec FROM playlist_items pi
             WHERE pi.playlist_id = ? ORDER BY pi.position ASC`
          ).all(playlist_id);
          if (!items.length) throw new Error(`Playlist ${playlist_id} has no items`);
          const baseUrl = `http://${fastify.serverHost}:${fastify.serverPort}`;
          await flingManager.castPlaylist(device.id, items, baseUrl, { portrait: orientation === 'portrait' });
          results.push({ device_id: device.id, name: device.name, ok: true, mode: 'playlist', playlist_id });
        } else {
          const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
          if (!sign) throw new Error(`Sign ${sign_id} not found`);
          let url;
          if (sign.type === 'tower_tv') {
            url = `http://${fastify.serverHost}:${fastify.serverPort}/tower-tv/index.html`;
          } else {
            const portrait = orientation === 'portrait';
            const params = new URLSearchParams({ kiosk: '1' });
            if (portrait) params.set('orientation', 'portrait');
            url = `http://${fastify.serverHost}:${fastify.serverPort}/api/signs/${sign_id}/render?${params}`;
          }
          await flingManager.castUrl(device.id, url, { orientation });
          results.push({ device_id: device.id, name: device.name, ok: true, mode: 'sign', sign_id });
        }
      } catch (err) {
        errors.push({ device_id: device.id, name: device.name, error: err.message });
      }
    }));

    return {
      ok: errors.length === 0,
      total: devices.length,
      succeeded: results.length,
      failed: errors.length,
      results,
      errors,
    };
  });

  // Stop casting on a Fire TV
  fastify.post('/api/fling/stop', async (req, reply) => {
    const { device_id } = req.body || {};
    if (!device_id) return reply.code(400).send({ error: 'device_id required' });
    try {
      const result = await flingManager.stopCast(device_id);
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = flingRoutes;
