'use strict';
/**
 * Sign screenshot renderer — pre-renders to disk so Chromecast gets
 * an instant HTTP response when it fetches the image.
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs   = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT    = { width: 1920, height: 1080 };
const CACHE_DIR   = path.join(__dirname, '..', 'public', 'screenshots');

let _browser = null;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

/**
 * Render a sign to a cached JPEG on disk.
 * Returns the public path e.g. /screenshots/<signId>.jpg
 */
async function renderSign(signId, renderUrl) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  const outPath = path.join(CACHE_DIR, `${signId}.jpg`);
  try {
    await page.setViewport(VIEWPORT);
    await page.goto(renderUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 90, fullPage: false });
    return `/screenshots/${signId}.jpg`;
  } finally {
    await page.close();
  }
}

/**
 * On-demand route handler — still available for direct browser preview.
 */
async function renderToJpeg(url) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    return await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
  } finally {
    await page.close();
  }
}

module.exports = { renderSign, renderToJpeg };
