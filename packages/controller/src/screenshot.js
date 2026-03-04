'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs   = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT           = { width: 1920, height: 1080 };
const VIEWPORT_PORTRAIT  = { width: 1080, height: 1920 };
const CACHE_DIR   = path.join(__dirname, '..', 'public', 'screenshots');
const TIMEOUT_MS  = 20000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let _browser = null;

async function getBrowser() {
  if (_browser) {
    try { await _browser.pages(); return _browser; } catch {}
    _browser = null;
  }
  _browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
           '--disable-dev-shm-usage', '--disable-web-security']
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

async function renderSign(signId, renderUrl, options = {}) {
  const portrait = !!options.portrait;
  const suffix   = portrait ? '-portrait' : '';
  const viewport = portrait ? VIEWPORT_PORTRAIT : VIEWPORT;
  const outPath  = path.join(CACHE_DIR, `${signId}${suffix}.jpg`);
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(renderUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS })
      .catch(() => page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS }));
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 90, fullPage: false });
    return `/screenshots/${signId}${suffix}.jpg`;
  } catch (err) {
    console.error(`[Screenshot] Failed for ${signId}:`, err.message);
    // Return cached version if available, otherwise rethrow
    if (fs.existsSync(outPath)) {
      console.log(`[Screenshot] Using cached version for ${signId}`);
      return `/screenshots/${signId}${suffix}.jpg`;
    }
    throw err;
  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
}

async function renderToJpeg(url) {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS });
    return await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
}

module.exports = { renderSign, renderToJpeg };
