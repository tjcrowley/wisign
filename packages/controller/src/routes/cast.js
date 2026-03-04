'use strict';
const castManager = require('../cast');
const flingManager = require('../fling');

async function castRoutes(fastify) {
  // List discovered Chromecasts (includes active playlist state)
  fastify.get('/api/cast/devices', async () => {
    return castManager.getDevices();
  });

  // Cast a single sign to a Chromecast
  fastify.post('/api/cast/assign', async (req, reply) => {
    const { device_id, sign_id, orientation = 'landscape' } = req.body || {};
    if (!device_id || !sign_id) return reply.code(400).send({ error: 'device_id and sign_id required' });

    const db = require('../db');
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
    if (!sign) return reply.code(404).send({ error: 'Sign not found' });

    const portrait = orientation === 'portrait';
    const renderUrl = `http://127.0.0.1:${fastify.serverPort}/api/signs/${sign_id}/render${portrait ? '?orientation=portrait' : ''}`;
    const { renderSign } = require('../screenshot');
    try {
      const cachedPath = await renderSign(sign_id, renderUrl, { portrait });
      const url = `${fastify.castBaseUrl}${cachedPath}`;
      await castManager.castUrl(device_id, url);
      return { ok: true, url };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Cast a playlist to a Chromecast or Fire TV (server-side loop)
  fastify.post('/api/cast/playlist', async (req, reply) => {
    const { device_id, playlist_id, orientation = 'landscape' } = req.body || {};
    if (!device_id || !playlist_id) return reply.code(400).send({ error: 'device_id and playlist_id required' });

    const db = require('../db');
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlist_id);
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });

    const items = JSON.parse(playlist.items || '[]');
    if (!items.length) return reply.code(400).send({ error: 'Playlist is empty' });

    const localBaseUrl = `http://127.0.0.1:${fastify.serverPort}`;
    const lanBaseUrl   = `http://${fastify.serverHost}:${fastify.serverPort}`;
    const portrait     = orientation === 'portrait';

    try {
      // Route to the right manager based on device type
      const isFire = device_id.startsWith('firetv-');
      const result = isFire
        // Fire TV fetches the URL itself — must be the LAN IP, not 127.0.0.1
        ? await flingManager.castPlaylist(device_id, items, lanBaseUrl, { portrait })
        : await castManager.castPlaylist(device_id, items, fastify.castBaseUrl,
            { portrait, localBaseUrl });
      return { ok: true, playlist: playlist.name, ...result };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Stop casting (single sign or playlist)
  fastify.post('/api/cast/stop', async (req, reply) => {
    const { device_id } = req.body || {};
    if (!device_id) return reply.code(400).send({ error: 'device_id required' });
    try {
      await castManager.stopCast(device_id);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}

module.exports = castRoutes;
