'use strict';
const flingManager = require('../fling');

async function flingRoutes(fastify) {
  // List discovered Fire TV devices
  fastify.get('/api/fling/devices', async () => {
    return flingManager.getDevices();
  });

  // Cast a sign to a Fire TV
  fastify.post('/api/fling/assign', async (req, reply) => {
    const { device_id, sign_id } = req.body || {};
    if (!device_id || !sign_id) return reply.code(400).send({ error: 'device_id and sign_id required' });

    const db = require('../db');
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
    if (!sign) return reply.code(404).send({ error: 'Sign not found' });

    // Fire TV is on the local LAN — use local HTTP URL (no Tailscale/HTTPS needed)
    const url = `http://${fastify.serverHost}:${fastify.serverPort}/api/signs/${sign_id}/render`;

    try {
      const result = await flingManager.castUrl(device_id, url);
      return { ok: true, url, ...result };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
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
