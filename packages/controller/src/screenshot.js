'use strict';
/**
 * Sign screenshot renderer using puppeteer-core + system Chrome.
 * Renders a sign's HTML to a JPEG for casting via Default Media Receiver.
 */

const puppeteer = require('puppeteer-core');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 1920, height: 1080 };

let _browser = null;

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

async function renderToJpeg(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
    return jpeg;
  } finally {
    await page.close();
  }
}

module.exports = { renderToJpeg };
