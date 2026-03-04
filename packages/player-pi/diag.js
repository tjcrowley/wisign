#!/usr/bin/env node
'use strict';
/**
 * FTSign Pi Diagnostics
 * Run this on the Pi to check connectivity to the controller.
 * Usage: node diag.js [controller-ip] [port]
 */

const http = require('http');
const WebSocket = require('ws');
const { Bonjour } = require('bonjour-service');
const os = require('os');

const host = process.argv[2] || process.env.FTSIGN_CONTROLLER_HOST || null;
const port = parseInt(process.argv[3] || process.env.FTSIGN_PORT || '3000', 10);

console.log('\n🔍 FTSign Pi Diagnostics\n');
console.log(`Hostname : ${os.hostname()}`);
console.log(`Platform : ${os.platform()} ${os.arch()}`);
console.log(`Node.js  : ${process.version}`);
console.log(`Local IP : ${getLocalIP()}`);
console.log('');

async function run() {
  // 1. mDNS discovery
  await testMDNS();

  // 2. UDP broadcast listener test
  await testUDP();

  // 3. HTTP + WS if host provided
  if (host) {
    await testHTTP(host, port);
    await testWS(host, port);
  } else {
    console.log('💡 Tip: pass a controller IP to test directly:');
    console.log('   node diag.js 192.168.1.100\n');
  }
}


function testUDP() {
  return new Promise((resolve) => {
    const dgram = require('dgram');
    const DISC_PORT = parseInt(process.env.FTSIGN_DISCOVERY_PORT || '3002', 10);
    console.log('── UDP Broadcast Discovery ──────────────────');
    console.log('   Listening on port ' + DISC_PORT + ' for 8 seconds...');
    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let heard = false;
    udp.bind(DISC_PORT, () => { udp.setBroadcast(true); });
    udp.on('message', (buf, rinfo) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'FTSIGN_CONTROLLER') {
          heard = true;
          console.log('✅ Heard controller broadcast from ' + rinfo.address + ':' + rinfo.port);
          console.log('   → WS URL: ws://' + rinfo.address + ':' + msg.port + '/ws');
          console.log('   → Controller IPs: ' + (msg.ips || []).join(', '));
          udp.close();
          resolve();
        }
      } catch {}
    });
    udp.on('error', e => { console.log('❌ UDP error: ' + e.message); resolve(); });
    setTimeout(() => {
      if (!heard) {
        console.log('❌ No UDP broadcast heard after 8s');
        console.log('   Broadcasts are likely blocked by managed switches/VLANs');
        console.log('   → Use: sudo systemctl edit ftsign-player');
        console.log('     Environment=FTSIGN_CONTROLLER=ws://<controller-ip>:3000/ws');
      }
      try { udp.close(); } catch {}
      console.log('');
      resolve();
    }, 8000);
  });
}
function testMDNS() {
  return new Promise((resolve) => {
    console.log('── mDNS Discovery ──────────────────────────');
    const bonjour = new Bonjour();
    const browser = bonjour.find({ type: 'ftsign' });
    let found = false;

    browser.on('up', (svc) => {
      found = true;
      const h = svc.host || svc.addresses?.[0];
      console.log(`✅ Found controller: ${svc.name} at ${h}:${svc.port}`);
      console.log(`   → If connecting, use: ws://${h}:${svc.port}/ws`);
    });

    setTimeout(() => {
      bonjour.destroy();
      if (!found) console.log('❌ No controller found via mDNS (try direct IP instead)');
      console.log('');
      resolve();
    }, 5000);

    console.log('   Scanning for 5 seconds...');
  });
}

function testHTTP(h, p) {
  return new Promise((resolve) => {
    console.log(`── HTTP: http://${h}:${p}/api/signs ─────────────`);
    const req = http.get({ host: h, port: p, path: '/api/signs', timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const signs = JSON.parse(data);
          console.log(`✅ HTTP OK (${res.statusCode}) — ${signs.length} sign(s) on controller`);
        } catch {
          console.log(`✅ HTTP OK (${res.statusCode}) — response received`);
        }
        console.log('');
        resolve();
      });
    });
    req.on('error', (err) => { console.log(`❌ HTTP failed: ${err.message}\n`); resolve(); });
    req.on('timeout', () => { req.destroy(); console.log(`❌ HTTP timeout\n`); resolve(); });
  });
}

function testWS(h, p) {
  return new Promise((resolve) => {
    const url = `ws://${h}:${p}/ws`;
    console.log(`── WebSocket: ${url} ────────────`);
    const ws = new WebSocket(url, { handshakeTimeout: 5000 });

    ws.on('open', () => {
      console.log('✅ WebSocket connected!');
      // Send a REGISTER and wait for response
      ws.send(JSON.stringify({
        type: 'REGISTER',
        device_id: 'diag-test-device',
        timestamp: new Date().toISOString(),
        payload: { display_name: 'Diag Test', platform: 'diagnostic', capabilities: {}, software_version: '0.0.0' }
      }));
      console.log('   → Sent REGISTER, waiting for REGISTER_OK...');
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log(`✅ Got message: ${msg.type}`);
      if (msg.type === 'REGISTER_OK') {
        console.log('✅ Full end-to-end OK — player should work!\n');
      }
      ws.close();
      resolve();
    });

    ws.on('error', (err) => { console.log(`❌ WebSocket error: ${err.message}\n`); resolve(); });
    ws.on('close', () => resolve());

    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CLOSED) {
        console.log('❌ WebSocket timed out — no response after 5s\n');
        ws.terminate();
        resolve();
      }
    }, 5000);
  });
}

function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface?.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return '127.0.0.1';
}

run().then(() => {
  console.log('── Done ─────────────────────────────────────\n');
  process.exit(0);
});
