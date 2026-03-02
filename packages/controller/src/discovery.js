'use strict';
/**
 * FTSign Discovery
 *
 * Advertises the controller on the LAN using two methods:
 *  1. UDP broadcast (port 3002) — works on any flat network, no multicast needed
 *  2. mDNS/Bonjour — works on simple home/office networks
 *
 * Players listen for the UDP broadcast and connect automatically.
 * Falls back to FTSIGN_CONTROLLER env var for cross-subnet setups.
 */
const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = parseInt(process.env.FTSIGN_DISCOVERY_PORT || '3002', 10);
const BROADCAST_INTERVAL = 5000; // ms

let udpSocket = null;
let broadcastTimer = null;
let mdnsBonjour = null;

function getLanIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

function getBroadcastAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal && iface.cidr) {
        // Compute broadcast from IP + subnet mask
        const parts = iface.address.split('.').map(Number);
        const mask = iface.netmask.split('.').map(Number);
        const broadcast = parts.map((p, i) => (p & mask[i]) | (~mask[i] & 255));
        addrs.push(broadcast.join('.'));
      }
    }
  }
  // Always include 255.255.255.255 as fallback
  if (!addrs.includes('255.255.255.255')) addrs.push('255.255.255.255');
  return addrs;
}

function advertise(httpPort) {
  const payload = JSON.stringify({
    type: 'FTSIGN_CONTROLLER',
    port: httpPort,
    ips: getLanIPs(),
    version: '0.1.0'
  });

  // ── UDP broadcast ──────────────────────────────────────────────────────────
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpSocket.bind(() => {
    udpSocket.setBroadcast(true);

    const send = () => {
      const buf = Buffer.from(payload);
      for (const addr of getBroadcastAddresses()) {
        udpSocket.send(buf, 0, buf.length, DISCOVERY_PORT, addr, (err) => {
          if (err && !err.message.includes('EACCES')) {
            // Silently ignore permission errors on restricted networks
          }
        });
      }
    };

    send();
    broadcastTimer = setInterval(send, BROADCAST_INTERVAL);
    console.log(`[Discovery] Broadcasting on UDP port ${DISCOVERY_PORT} every ${BROADCAST_INTERVAL / 1000}s`);
    console.log(`[Discovery] Broadcast targets: ${getBroadcastAddresses().join(', ')}`);
  });

  udpSocket.on('error', (err) => {
    console.warn('[Discovery] UDP broadcast error:', err.message);
  });

  // ── mDNS (best-effort) ─────────────────────────────────────────────────────
  try {
    const { Bonjour } = require('bonjour-service');
    mdnsBonjour = new Bonjour();
    mdnsBonjour.publish({ name: 'FTSign Controller', type: 'ftsign', port: httpPort, txt: { version: '0.1.0' } });
    console.log('[Discovery] mDNS advertising _ftsign._tcp.local');
  } catch (err) {
    console.warn('[Discovery] mDNS unavailable:', err.message);
  }
}

function destroy() {
  clearInterval(broadcastTimer);
  if (udpSocket) { try { udpSocket.close(); } catch {} }
  if (mdnsBonjour) { try { mdnsBonjour.destroy(); } catch {} }
}

module.exports = { advertise, destroy, DISCOVERY_PORT };
