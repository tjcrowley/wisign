'use strict';
const castManager = require('../cast');

async function castRoutes(fastify) {
  // List discovered Chromecasts
  fastify.get('/api/cast/devices', async () => {
    return castManager.getDevices();
  });

  // Cast a sign to a Chromecast
  fastify.post('/api/cast/assign', async (req, reply) => {
    const { device_id, sign_id } = req.body || {};
    if (!device_id || !sign_id) return reply.code(400).send({ error: 'device_id and sign_id required' });

    const db = require('../db');
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(sign_id);
    if (!sign) return reply.code(404).send({ error: 'Sign not found' });

    const url = `http://${fastify.serverHost}:${fastify.serverPort}/api/signs/${sign_id}/render`;

    try {
      await castManager.castUrl(device_id, url);
      return { ok: true, url };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Stop casting on a device
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
