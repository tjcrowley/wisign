'use strict';
// Preload script — minimal, just exposes safe context if needed
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('ftsign', {
  version: process.env.npm_package_version || '0.1.0'
});
