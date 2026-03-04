'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const playlistManager = require('../playlist-manager');

async function playlistRoutes(fastify) {
  fastify.get('/api/playlists', async () => {
    return db.prepare('SELECT * FROM playlists ORDER BY name').all().map(parse);
  });

  fastify.post('/api/playlists', async (req, reply) => {
    const { name, items = [] } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const id = uuidv4();
    db.prepare('INSERT INTO playlists (id, name, items) VALUES (?, ?, ?)').run(id, name, JSON.stringify(items));
    return parse(db.prepare('SELECT * FROM playlists WHERE id = ?').get(id));
  });

  fastify.get('/api/playlists/:id', async (req, reply) => {
    const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
    return p ? parse(p) : reply.code(404).send({ error: 'Not found' });
  });

  fastify.put('/api/playlists/:id', async (req, reply) => {
    const { name, items } = req.body || {};
    db.prepare(`UPDATE playlists SET name=COALESCE(?,name), items=COALESCE(?,items), updated_at=datetime('now') WHERE id=?`)
      .run(name, items ? JSON.stringify(items) : null, req.params.id);
    const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
    return p ? parse(p) : reply.code(404).send({ error: 'Not found' });
  });

  fastify.delete('/api/playlists/:id', async (req, reply) => {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
    reply.code(204).send();
  });

  // Get rotation state (which sign is playing on which screen)
  fastify.get('/api/playlists/state', async () => {
    return playlistManager.getState();
  });
}

function parse(p) {
  return { ...p, items: JSON.parse(p.items || '[]'), group_ids: JSON.parse(p.group_ids || '[]') };
}

module.exports = playlistRoutes;
