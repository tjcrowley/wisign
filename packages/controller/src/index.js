'use strict';
const Fastify = require('fastify');
const path = require('path');

const PORT = parseInt(process.env.WISIGN_PORT || '3000', 10);
const HOST = process.env.WISIGN_HOST || '0.0.0.0';

const fastify = Fastify({ logger: { level: 'warn' } });

async function start() {
  // Static admin UI
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/'
  });

  // WebSocket support
  await fastify.register(require('@fastify/websocket'));

  // Expose server info on fastify instance for routes
  fastify.serverPort = PORT;
  fastify.serverHost = HOST === '0.0.0.0' ? 'localhost' : HOST;

  // WebSocket handler
  require('./ws/handler').setup(fastify);

  // REST routes
  fastify.register(require('./routes/screens'));
  fastify.register(require('./routes/signs'));
  fastify.register(require('./routes/assign'));
  fastify.register(require('./routes/cast'));

  await fastify.listen({ port: PORT, host: HOST });

  console.log(`\n🖥️  WiSign Controller running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`🌐 Admin UI: http://localhost:${PORT}/\n`);

  // mDNS advertising
  require('./discovery').advertise(PORT);

  // Chromecast discovery
  require('./cast').init();
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
