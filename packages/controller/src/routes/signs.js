'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

async function signsRoutes(fastify) {
  fastify.get('/api/signs', async () => {
    return db.prepare('SELECT * FROM signs ORDER BY name').all();
  });

  fastify.post('/api/signs', async (req, reply) => {
    const { name, type = 'raw_html', html = '', url = '' } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const id = uuidv4();
    db.prepare(`INSERT INTO signs (id, name, type, html, url) VALUES (?, ?, ?, ?, ?)`).run(id, name, type, html, url);
    return db.prepare('SELECT * FROM signs WHERE id = ?').get(id);
  });

  fastify.get('/api/signs/:id', async (req, reply) => {
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    return s || reply.code(404).send({ error: 'Not found' });
  });

  fastify.put('/api/signs/:id', async (req, reply) => {
    const { name, html, url, type } = req.body || {};
    db.prepare(`UPDATE signs SET name=COALESCE(?,name), html=COALESCE(?,html), url=COALESCE(?,url), type=COALESCE(?,type), version=version+1, updated_at=datetime('now') WHERE id=?`)
      .run(name, html, url, type, req.params.id);
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    return s || reply.code(404).send({ error: 'Not found' });
  });

  fastify.delete('/api/signs/:id', async (req, reply) => {
    db.prepare('DELETE FROM signs WHERE id = ?').run(req.params.id);
    reply.code(204).send();
  });

  // Render sign HTML directly
  fastify.get('/api/signs/:id/render', async (req, reply) => {
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    if (!s) return reply.code(404).send('Not found');
    if (s.type === 'url') {
      reply.redirect(s.url);
    } else {
      reply.type('text/html').send(s.html);
    }
  });
}

module.exports = signsRoutes;
