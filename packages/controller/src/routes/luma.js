'use strict';
const luma = require('../luma');

async function lumaRoutes(fastify) {
  // List upcoming events (JSON)
  fastify.get('/api/luma/events', async () => {
    return luma.getEvents();
  });

  // Force refresh from Luma API
  fastify.post('/api/luma/sync', async () => {
    const events = await luma.refresh();
    return { ok: true, count: events.length };
  });

  // Render a single event slide as HTML
  fastify.get('/api/luma/sign/:index', async (req, reply) => {
    const index = parseInt(req.params.index, 10);
    const event = luma.getEventByIndex(index);
    if (!event) return reply.code(404).send('Event not found');

    const baseUrl = `http://${fastify.serverHost}:${fastify.serverPort}`;
    const html = luma.buildEventSignHTML(event, baseUrl);
    reply.type('text/html').send(html);
  });

  // Auto-cycling slideshow (all upcoming events)
  fastify.get('/api/luma/sign', async (req, reply) => {
    const baseUrl = `http://${fastify.serverHost}:${fastify.serverPort}`;
    const html = luma.buildCyclingSignHTML(baseUrl);
    reply.type('text/html').send(html);
  });
}

module.exports = lumaRoutes;
