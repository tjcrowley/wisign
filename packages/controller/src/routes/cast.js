'use strict';
const castManager = require('../cast');

async function castRoutes(fastify) {
  // List discovered Chromecasts (includes active playlist state)
  fastify.get('/api/cast/devices', async () => {
    return castManager.getDevices();
  });

  // Cast a single sign to a Chromecast
  fastify.post('/api/cast/assign', async (req, reply) => {
    const { device_id, sign_id } = req.body || {};
    if (!device_id || !sign_id) return reply.code(400).send({ error: 'device_id and sign_id required' });

    const db = require('../db');
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
    if (!sign) return reply.code(404).send({ error: 'Sign not found' });

    const renderUrl = `http://127.0.0.1:${fastify.serverPort}/api/signs/${sign_id}/render`;
    const baseUrl   = `http://${fastify.serverHost}:${fastify.serverPort}`;
    const { renderSign } = require('../screenshot');
    try {
      const cachedPath = await renderSign(sign_id, renderUrl);
      const url = `${baseUrl}${cachedPath}`;
      await castManager.castUrl(device_id, url);
      return { ok: true, url };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Cast a playlist to a Chromecast (server-side loop)
  fastify.post('/api/cast/playlist', async (req, reply) => {
    const { device_id, playlist_id } = req.body || {};
    if (!device_id || !playlist_id) return reply.code(400).send({ error: 'device_id and playlist_id required' });

    const db = require('../db');
    const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlist_id);
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });

    const items = JSON.parse(playlist.items || '[]');
    if (!items.length) return reply.code(400).send({ error: 'Playlist is empty' });

    const baseUrl = `http://${fastify.serverHost}:${fastify.serverPort}`;

    try {
      const result = await castManager.castPlaylist(device_id, items, baseUrl);
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
