'use strict';
const { Bonjour } = require('bonjour-service');

let bonjour;

function advertise(port) {
  bonjour = new Bonjour();
  bonjour.publish({ name: 'WiSign Controller', type: 'wisign', port, txt: { version: '0.1.0' } });
  console.log(`[mDNS] Advertising _wisign._tcp.local on port ${port}`);
}

function destroy() {
  if (bonjour) bonjour.destroy();
}

module.exports = { advertise, destroy };
