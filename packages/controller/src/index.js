'use strict';
const Fastify = require('fastify');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.WISIGN_PORT || '3000', 10);
const HOST = process.env.WISIGN_HOST || '0.0.0.0';

function getLanIP() {
  if (process.env.WISIGN_LAN_IP) return process.env.WISIGN_LAN_IP;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const fastify = Fastify({ logger: { level: 'warn' } });

async function start() {
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/'
  });

  await fastify.register(require('@fastify/websocket'));

  fastify.serverPort = PORT;
  fastify.serverHost = getLanIP();

  require('./ws/handler').setup(fastify);
  require('./playlist-manager').init(fastify);

  fastify.register(require('./routes/screens'));
  fastify.register(require('./routes/signs'));
  fastify.register(require('./routes/assign'));
  fastify.register(require('./routes/playlists'));
  fastify.register(require('./routes/cast'));

  await fastify.listen({ port: PORT, host: HOST });

  const lanIP = getLanIP();
  console.log(`\n🖥️  WiSign Controller`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${lanIP}:${PORT}`);
  console.log(`📡 WebSocket: ws://${lanIP}:${PORT}/ws\n`);

  require('./discovery').advertise(PORT);
  require('./cast').init();
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
