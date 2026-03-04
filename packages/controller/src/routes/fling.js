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
    const portrait = orientation === 'portrait';
    const params = new URLSearchParams({ kiosk: '1' });
    if (portrait) params.set('orientation', 'portrait');
    const url = `http://${fastify.serverHost}:${fastify.serverPort}/api/signs/${sign_id}/render?${params}`;

    try {
      const result = await flingManager.castUrl(device_id, url);
      return { ok: true, url, ...result };
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
    return flingManager.getState(req.params.deviceId) || { url: '' };
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
