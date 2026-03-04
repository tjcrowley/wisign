'use strict';
/**
 * FTSign Luma Calendar Integration
 *
 * Fetches upcoming events from a Luma calendar via the public API,
 * filters to a configurable window (default: today → 3 days out),
 * and syncs them as signs in the FTSign database.
 */

const https = require('https');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const LUMA_SLUG = process.env.FTSIGN_LUMA_SLUG || 'frontiertower';
const LUMA_API_URL = `https://api.lu.ma/url?url=${LUMA_SLUG}`;
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const LOOKAHEAD_DAYS = parseInt(process.env.FTSIGN_LUMA_DAYS || '3', 10);

let cachedEvents = [];
let lastFetch = 0;

// ── Fetch from Luma API ───────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FTSign/0.1' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Luma API')); }
      });
    }).on('error', reject);
  });
}

function filterUpcoming(items) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  return items
    .filter((item) => {
      const start = new Date(item.event.start_at);
      return start >= now && start <= cutoff;
    })
    .sort((a, b) => new Date(a.event.start_at) - new Date(b.event.start_at));
}

async function fetchEvents() {
  try {
    console.log(`[Luma] Fetching events from ${LUMA_API_URL}...`);
    const json = await fetchJSON(LUMA_API_URL);

    if (!json.data?.featured_items) {
      console.warn('[Luma] No featured_items in response');
      return [];
    }

    const allItems = json.data.featured_items;
    const upcoming = filterUpcoming(allItems);

    console.log(`[Luma] ${allItems.length} total events, ${upcoming.length} in next ${LOOKAHEAD_DAYS} days`);

    cachedEvents = upcoming.map((item) => ({
      api_id: item.event.api_id,
      name: item.event.name,
      cover_url: item.event.cover_url,
      start_at: item.event.start_at,
      end_at: item.event.end_at,
      timezone: item.event.timezone || 'America/Los_Angeles',
      url_slug: item.event.url,
      luma_url: `https://lu.ma/${item.event.url}`,
      location: item.event.geo_address_info?.address || '',
      guest_count: item.guest_count || 0,
      is_free: item.ticket_info?.is_free ?? true,
    }));

    lastFetch = Date.now();
    return cachedEvents;
  } catch (err) {
    console.error('[Luma] Fetch error:', err.message);
    return cachedEvents; // return stale cache on error
  }
}

// ── Sync events as FTSign signs ───────────────────────────────────────────────

function buildEventSignHTML(event, baseUrl) {
  const startDate = new Date(event.start_at);
  const endDate = new Date(event.end_at);

  // Format date nicely
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = dayNames[startDate.getDay()];
  const month = monthNames[startDate.getMonth()];
  const date = startDate.getDate();
  const hours = startDate.getHours();
  const minutes = startDate.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const endHours = endDate.getHours();
  const endMinutes = endDate.getMinutes().toString().padStart(2, '0');
  const endAmpm = endHours >= 12 ? 'PM' : 'AM';
  const endHour12 = endHours % 12 || 12;
  const dateStr = `${day}, ${month} ${date} · ${hour12}:${minutes} ${ampm} – ${endHour12}:${endMinutes} ${endAmpm}`;

  const lumaUrl = event.luma_url;
  const coverUrl = event.cover_url;
  const title = event.name.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  const location = (event.location || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px; overflow: hidden;
    font-family: 'Inter', system-ui, sans-serif;
    background: #0a0a0f;
    color: #fff;
    display: flex;
  }
  .cover {
    width: 960px; height: 1080px;
    background: url('${coverUrl}') center/cover no-repeat;
    position: relative;
    flex-shrink: 0;
  }
  .cover::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(to right, transparent 60%, #0a0a0f 100%);
  }
  .info {
    flex: 1; display: flex; flex-direction: column;
    justify-content: center; padding: 60px 80px;
    position: relative; z-index: 1;
  }
  .date {
    font-size: 28px; font-weight: 600;
    color: #a78bfa; margin-bottom: 24px;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .title {
    font-size: 52px; font-weight: 800;
    line-height: 1.15; margin-bottom: 28px;
    max-height: 300px; overflow: hidden;
  }
  .location {
    font-size: 22px; color: #94a3b8;
    margin-bottom: 48px; line-height: 1.4;
  }
  .qr-section {
    display: flex; align-items: center; gap: 28px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px; padding: 28px 36px;
    max-width: 520px;
  }
  .qr-section canvas { border-radius: 12px; flex-shrink: 0; }
  .qr-text { font-size: 20px; color: #cbd5e1; line-height: 1.5; }
  .qr-text strong { color: #a78bfa; font-weight: 700; display: block; font-size: 22px; margin-bottom: 4px; }
  .badge {
    display: inline-block; padding: 8px 20px;
    background: ${event.is_free ? '#16532d' : '#3b1764'};
    color: ${event.is_free ? '#4ade80' : '#c084fc'};
    border-radius: 999px; font-size: 18px; font-weight: 700;
    margin-bottom: 20px;
  }
  .ft-brand {
    position: absolute; bottom: 32px; right: 40px;
    font-size: 16px; color: #475569; font-weight: 600;
    letter-spacing: 2px;
  }
</style>
</head>
<body>
  <div class="cover"></div>
  <div class="info">
    <div class="badge">${event.is_free ? 'FREE' : 'RSVP'}</div>
    <div class="date">${dateStr}</div>
    <div class="title">${title}</div>
    ${location ? `<div class="location">📍 ${location}</div>` : ''}
    <div class="qr-section">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(lumaUrl)}" width="140" height="140" style="border-radius:12px;flex-shrink:0" alt="QR">
      <div class="qr-text">
        <strong>Scan to RSVP</strong>
        lu.ma/${event.url_slug}
      </div>
    </div>
  </div>
  <div class="ft-brand">FRONTIER TOWER</div>
</body>
</html>`;
}

function buildCyclingSignHTML(baseUrl) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920,height=1080">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; overflow: hidden; background: #0a0a0f; }
  iframe { width: 100%; height: 100%; border: none; }
  .empty {
    display: flex; align-items: center; justify-content: center;
    height: 100vh; color: #6366f1; font-family: system-ui, sans-serif;
    font-size: 3vw; text-align: center; flex-direction: column; gap: 1rem;
  }
  .empty p { color: #64748b; font-size: 1.5vw; }
</style>
</head>
<body>
<iframe id="frame"></iframe>
<script>
let events = [];
let index = 0;
const CYCLE_SEC = 15;
const REFRESH_MIN = 15;

async function load() {
  try {
    const res = await fetch('${baseUrl}/api/luma/events');
    events = await res.json();
  } catch(e) { console.error('Luma fetch error', e); }

  if (!events.length) {
    document.body.innerHTML = '<div class="empty"><h2>📅 No upcoming events</h2><p>Check back soon!</p></div>';
    return;
  }
  show();
}

function show() {
  if (!events.length) return;
  document.getElementById('frame').src = '${baseUrl}/api/luma/sign/' + index;
  index = (index + 1) % events.length;
  setTimeout(show, CYCLE_SEC * 1000);
}

load();
setInterval(load, REFRESH_MIN * 60 * 1000);
</script>
</body>
</html>`;
}

// ── Sync to DB ────────────────────────────────────────────────────────────────

function syncSignsToDB(events, baseUrl) {
  // Remove old Luma signs that are no longer upcoming
  const existing = db.prepare("SELECT id, name FROM signs WHERE type = 'luma_event'").all();
  const currentIds = new Set(events.map((e) => `luma-${e.api_id}`));

  for (const sign of existing) {
    if (!currentIds.has(sign.id)) {
      db.prepare('DELETE FROM signs WHERE id = ?').run(sign.id);
      console.log(`[Luma] Removed expired sign: ${sign.name}`);
    }
  }

  // Upsert current events as signs
  for (const event of events) {
    const signId = `luma-${event.api_id}`;
    const html = buildEventSignHTML(event, baseUrl);
    const existingSign = db.prepare('SELECT id FROM signs WHERE id = ?').get(signId);

    if (existingSign) {
      db.prepare("UPDATE signs SET name = ?, html = ?, updated_at = datetime('now') WHERE id = ?")
        .run(`📅 ${event.name}`, html, signId);
    } else {
      db.prepare("INSERT INTO signs (id, name, type, html, version, published) VALUES (?, ?, 'luma_event', ?, 1, 1)")
        .run(signId, `📅 ${event.name}`, html);
      console.log(`[Luma] Created sign: ${event.name}`);
    }
  }

  // Upsert the cycling slideshow sign
  const cycleId = 'luma-cycle';
  const cycleHtml = buildCyclingSignHTML(baseUrl);
  const existingCycle = db.prepare('SELECT id FROM signs WHERE id = ?').get(cycleId);
  if (existingCycle) {
    db.prepare("UPDATE signs SET html = ?, updated_at = datetime('now') WHERE id = ?")
      .run(cycleHtml, cycleId);
  } else {
    db.prepare("INSERT INTO signs (id, name, type, html, version, published) VALUES (?, ?, 'luma_cycle', ?, 1, 1)")
      .run(cycleId, '📅 Luma Events (Auto-Cycle)', cycleHtml);
  }

  return events.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

let _baseUrl = 'http://localhost:3000';

async function init(fastify) {
  _baseUrl = `http://${fastify.serverHost}:${fastify.serverPort}`;
  await refresh();
  setInterval(refresh, REFRESH_INTERVAL);
}

async function refresh() {
  const events = await fetchEvents();
  syncSignsToDB(events, _baseUrl);
  return events;
}

function getEvents() {
  return cachedEvents;
}

function getEventByIndex(index) {
  if (index < 0 || index >= cachedEvents.length) return null;
  return cachedEvents[index];
}

module.exports = { init, refresh, getEvents, getEventByIndex, buildEventSignHTML, buildCyclingSignHTML };
