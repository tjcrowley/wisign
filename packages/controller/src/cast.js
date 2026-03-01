'use strict';
/**
 * Chromecast / Cast-enabled device manager
 *
 * Uses castv2-client to discover and control Cast devices on the local network.
 *
 * NOTE: To cast arbitrary HTML, you need a registered Cast Receiver App:
 *   1. Sign up at https://cast.google.com/publish ($5 one-time fee)
 *   2. Register a "Custom Receiver" pointing to:
 *      http://<controller-ip>:<port>/cast-receiver.html
 *   3. Set WISIGN_CAST_APP_ID=<your-app-id> in your environment
 *
 * Without a registered App ID, we fall back to the Default Media Receiver
 * which can only play media files (not arbitrary HTML).
 *
 * For development/testing, you can use the "Staging Backdrop" App ID:
 *   E8C28D3C  (Google's test receiver — loads a URL in an iframe)
 */

const { Client, DefaultMediaReceiver } = require('castv2-client');
const Bonjour = require('bonjour-service').Bonjour;

const APP_ID = process.env.WISIGN_CAST_APP_ID || 'CC1AD845'; // Default Media Receiver

const devices = new Map(); // device_id -> { name, host, port, service }
const clients = new Map(); // device_id -> Client instance

function init() {
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'googlecast' });

  browser.on('up', (service) => {
    const id = service.txt?.id || service.name;
    const existing = devices.get(id);
    const info = {
      id,
      name: service.txt?.fn || service.name,
      host: service.host || (service.addresses && service.addresses[0]),
      port: service.port || 8009,
      model: service.txt?.md || 'Unknown',
      status: 'available'
    };
    devices.set(id, info);
    if (!existing) console.log(`[Cast] Discovered: ${info.name} (${info.host})`);
  });

  browser.on('down', (service) => {
    const id = service.txt?.id || service.name;
    const dev = devices.get(id);
    if (dev) {
      dev.status = 'unavailable';
      console.log(`[Cast] Lost: ${dev.name}`);
    }
  });

  console.log('[Cast] Scanning for Cast devices...');
}

function getDevices() {
  return Array.from(devices.values());
}

function connectDevice(deviceId) {
  return new Promise((resolve, reject) => {
    const device = devices.get(deviceId);
    if (!device) return reject(new Error(`Device ${deviceId} not found`));

    if (clients.has(deviceId)) {
      return resolve(clients.get(deviceId));
    }

    const client = new Client();
    client.connect({ host: device.host, port: device.port }, () => {
      clients.set(deviceId, client);
      resolve(client);
    });
    client.on('error', (err) => {
      clients.delete(deviceId);
      reject(err);
    });
    client.on('close', () => clients.delete(deviceId));
  });
}

async function castUrl(deviceId, url) {
  const client = await connectDevice(deviceId);
  return new Promise((resolve, reject) => {
    client.launch(DefaultMediaReceiver, (err, player) => {
      if (err) return reject(err);

      // For a Custom Receiver with WISIGN_CAST_APP_ID, you'd send a custom
      // message to load the URL in a WebView. With DefaultMediaReceiver we
      // load it as a "web page" media item — works for simple HTML.
      const media = {
        contentId: url,
        contentType: 'text/html',
        streamType: 'NONE',
        metadata: {
          type: 0,
          metadataType: 0,
          title: 'WiSign'
        }
      };

      player.load(media, { autoplay: true }, (err, status) => {
        if (err) return reject(err);
        resolve(status);
      });
    });
  });
}

async function stopCast(deviceId) {
  const client = clients.get(deviceId);
  if (!client) return;
  return new Promise((resolve) => client.stop(resolve));
}

module.exports = { init, getDevices, castUrl, stopCast };
