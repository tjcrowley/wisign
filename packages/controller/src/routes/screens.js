'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

async function screensRoutes(fastify) {
  fastify.get('/api/screens', async () => {
    return db.prepare('SELECT * FROM screens ORDER BY display_name').all().map(parseScreen);
  });

  fastify.get('/api/screens/:id', async (req, reply) => {
    const s = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'Not found' });
    return parseScreen(s);
  });

  fastify.put('/api/screens/:id', async (req, reply) => {
    const { display_name, location, tags, notes } = req.body || {};
    db.prepare(`UPDATE screens SET display_name=COALESCE(?,display_name), location=COALESCE(?,location), tags=COALESCE(?,tags), notes=COALESCE(?,notes) WHERE id=?`)
      .run(display_name, location, tags ? JSON.stringify(tags) : null, notes, req.params.id);
    const s = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
    return s ? parseScreen(s) : reply.code(404).send({ error: 'Not found' });
  });

  fastify.delete('/api/screens/:id', async (req, reply) => {
    db.prepare('DELETE FROM screens WHERE id = ?').run(req.params.id);
    reply.code(204).send();
  });
}

function parseScreen(s) {
  return {
    ...s,
    tags: JSON.parse(s.tags || '[]'),
    capabilities: JSON.parse(s.capabilities || '{}'),
    current_assignment: s.current_assignment ? JSON.parse(s.current_assignment) : null
  };
}

module.exports = screensRoutes;
