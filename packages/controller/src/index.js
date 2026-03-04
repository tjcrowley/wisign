'use strict';
const Fastify = require('fastify');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.FTSIGN_PORT || '3000', 10);
const HOST = process.env.FTSIGN_HOST || '0.0.0.0';

function getCastBaseUrl() {
  // Use HTTPS Tailscale Serve URL for cast content so Chromecast's receiver
  // (loaded from gstatic.com over HTTPS) isn't blocked by mixed-content policy.
  return process.env.FTSIGN_CAST_URL || 'https://hermes.tailb3d66d.ts.net';
}

function getLanIP() {
  if (process.env.FTSIGN_LAN_IP) return process.env.FTSIGN_LAN_IP;
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Prevent castv2-client TLS errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (castv2/TLS):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason?.message || reason);
});

const fastify = Fastify({ logger: { level: 'warn' } });

async function start() {
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/'
  });

  await fastify.register(require('@fastify/websocket'));

  // Access log — shows us whether cast devices are fetching images
  fastify.addHook('onRequest', (req, reply, done) => {
    if (req.ip !== '127.0.0.1' && req.ip !== '::1') {
      console.log(`[HTTP] ${req.ip} ${req.method} ${req.url}`);
    }
    done();
  });

  fastify.serverPort = PORT;
  fastify.serverHost = getLanIP();
  fastify.castBaseUrl = getCastBaseUrl();

  require('./ws/handler').setup(fastify);
  require('./playlist-manager').init(fastify);

  fastify.register(require('./routes/screens'));
  fastify.register(require('./routes/signs'));
  fastify.register(require('./routes/assign'));
  fastify.register(require('./routes/playlists'));
  fastify.register(require('./routes/cast'));
  fastify.register(require('./routes/fling'));

  await fastify.listen({ port: PORT, host: HOST });

  const lanIP = getLanIP();
  console.log(`\n🖥️  FTSign Controller`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${lanIP}:${PORT}`);
  console.log(`📡 WebSocket: ws://${lanIP}:${PORT}/ws\n`);

  require('./discovery').advertise(PORT);
  require('./cast').init();
  require('./fling').init();

  // Use Tailscale Funnel for public HTTPS (required by Chromecast's receiver
  // which runs in a gstatic.com HTTPS context and blocks mixed-content HTTP).
  // Run: tailscale funnel --bg 3000
  // Override with FTSIGN_CAST_URL env var if needed.
  if (!process.env.FTSIGN_CAST_URL) {
    fastify.castBaseUrl = 'https://hermes.tailb3d66d.ts.net';
    console.log(`[Cast] Public HTTPS URL: ${fastify.castBaseUrl}`);
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
