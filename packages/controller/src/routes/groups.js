'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

async function groupRoutes(fastify) {
  fastify.get('/api/groups', async () => {
    return db.prepare('SELECT * FROM groups ORDER BY name').all();
  });

  fastify.post('/api/groups', async (req, reply) => {
    const { name, color = '#6366f1' } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const id = uuidv4();
    db.prepare('INSERT INTO groups (id, name, color) VALUES (?, ?, ?)').run(id, name, color);
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  });

  fastify.put('/api/groups/:id', async (req, reply) => {
    const { name, color } = req.body || {};
    db.prepare(`UPDATE groups SET name=COALESCE(?,name), color=COALESCE(?,color) WHERE id=?`)
      .run(name ?? null, color ?? null, req.params.id);
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    return g || reply.code(404).send({ error: 'Not found' });
  });

  fastify.delete('/api/groups/:id', async (req, reply) => {
    // Unassign from all screens and playlists first
    db.prepare(`UPDATE screens   SET group_id = NULL WHERE group_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM device_config WHERE group_id = ?`).run(req.params.id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
    reply.code(204).send();
  });

  // Assign a group to a screen
  fastify.put('/api/screens/:id/group', async (req, reply) => {
    const { group_id } = req.body || {};
    db.prepare('UPDATE screens SET group_id = ? WHERE id = ?').run(group_id ?? null, req.params.id);
    return { ok: true };
  });

  // Assign groups to a playlist
  fastify.put('/api/playlists/:id/groups', async (req, reply) => {
    const { group_ids = [] } = req.body || {};
    db.prepare(`UPDATE playlists SET group_ids=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(group_ids), req.params.id);
    return { ok: true };
  });

  // Get/set config for a cast device (Chromecast or Fire TV)
  fastify.get('/api/device-config/:id', async (req) => {
    return db.prepare('SELECT * FROM device_config WHERE id = ?').get(req.params.id) || { id: req.params.id, group_id: null, display_name: '', notes: '' };
  });

  fastify.put('/api/device-config/:id', async (req, reply) => {
    const { display_name, group_id, notes } = req.body || {};
    db.prepare(`
      INSERT INTO device_config (id, display_name, group_id, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, display_name),
        group_id     = excluded.group_id,
        notes        = COALESCE(excluded.notes, notes),
        updated_at   = datetime('now')
    `).run(req.params.id, display_name ?? '', group_id ?? null, notes ?? '');
    return db.prepare('SELECT * FROM device_config WHERE id = ?').get(req.params.id);
  });
}

module.exports = groupRoutes;
