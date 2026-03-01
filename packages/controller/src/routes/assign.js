'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

async function assignRoutes(fastify) {
  fastify.post('/api/assign', async (req, reply) => {
    const { target_type, target_id, mode = 'sign', ref_id } = req.body || {};
    if (!ref_id) return reply.code(400).send({ error: 'ref_id required' });

    const id = uuidv4();
    db.prepare(`INSERT INTO assignments (id, target_type, target_id, mode, ref_id) VALUES (?, ?, ?, ?, ?)`)
      .run(id, target_type || 'screen', target_id || 'all', mode, ref_id);

    const assignment = JSON.stringify({ mode, sign_id: ref_id });

    // Determine which screens to push to
    let screens = [];
    if (!target_id || target_id === 'all') {
      screens = db.prepare("SELECT * FROM screens WHERE status != 'offline'").all();
    } else {
      const s = db.prepare('SELECT * FROM screens WHERE id = ?').get(target_id);
      if (s) screens = [s];
    }

    // Update screen records
    for (const screen of screens) {
      db.prepare("UPDATE screens SET current_assignment = ? WHERE id = ?").run(assignment, screen.id);
    }

    // Push via WebSocket (fastify.wsClients is set in ws/handler.js)
    const sign = db.prepare('SELECT * FROM signs WHERE id = ?').get(ref_id);
    if (sign && fastify.wsClients) {
      const renderUrl = `http://localhost:${fastify.serverPort}/api/signs/${ref_id}/render`;
      const msg = JSON.stringify({
        type: 'LOAD_SIGN',
        request_id: id,
        timestamp: new Date().toISOString(),
        payload: { mode: 'url', url: renderUrl, cache_policy: 'no-cache' }
      });

      for (const screen of screens) {
        const ws = fastify.wsClients.get(screen.device_id);
        if (ws && ws.readyState === 1) ws.send(msg);
      }
    }

    return { ok: true, assignment_id: id, screens_targeted: screens.length };
  });

  fastify.get('/api/assignments', async () => {
    return db.prepare('SELECT * FROM assignments ORDER BY created_at DESC LIMIT 100').all();
  });
}

module.exports = assignRoutes;
