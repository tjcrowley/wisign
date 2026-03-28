'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

async function signsRoutes(fastify) {
  fastify.get('/api/signs', async () => {
    return db.prepare('SELECT * FROM signs ORDER BY name').all();
  });

  fastify.post('/api/signs', async (req, reply) => {
    const { name, type = 'raw_html', html = '', url = '' } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const id = uuidv4();
    db.prepare(`INSERT INTO signs (id, name, type, html, url) VALUES (?, ?, ?, ?, ?)`).run(id, name, type, html, url);
    return db.prepare('SELECT * FROM signs WHERE id = ?').get(id);
  });

  fastify.get('/api/signs/:id', async (req, reply) => {
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    return s || reply.code(404).send({ error: 'Not found' });
  });

  fastify.put('/api/signs/:id', async (req, reply) => {
    const { name, html, url, type } = req.body || {};
    db.prepare(`UPDATE signs SET name=COALESCE(?,name), html=COALESCE(?,html), url=COALESCE(?,url), type=COALESCE(?,type), version=version+1, updated_at=datetime('now') WHERE id=?`)
      .run(name, html, url, type, req.params.id);
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    return s || reply.code(404).send({ error: 'Not found' });
  });

  fastify.delete('/api/signs/:id', async (req, reply) => {
    db.prepare('DELETE FROM signs WHERE id = ?').run(req.params.id);
    reply.code(204).send();
  });

  // Screenshot: render sign to JPEG (for casting via Default Media Receiver)
  fastify.get('/api/signs/:id/screenshot.jpg', async (req, reply) => {
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    if (!s) return reply.code(404).send('Not found');
    const { renderToJpeg } = require('../screenshot');
    const renderUrl = `http://127.0.0.1:${fastify.serverPort}/api/signs/${s.id}/render`;
    try {
      const jpeg = await renderToJpeg(renderUrl);
      reply.type('image/jpeg').send(jpeg);
    } catch (err) {
      reply.code(500).send({ error: 'Screenshot failed: ' + err.message });
    }
  });

  // Render sign HTML directly
  // ?orientation=portrait  → portrait-native HTML for raw_html types
  // ?orientation=landscape (or omitted) → landscape iframe wrapper
  // ?kiosk=1 → fullscreen script injection
  fastify.get('/api/signs/:id/render', async (req, reply) => {
    const s = db.prepare('SELECT * FROM signs WHERE id = ?').get(req.params.id);
    if (!s) return reply.code(404).send('Not found');

    const wantPortrait = req.query.orientation === 'portrait';
    const wantKiosk    = req.query.kiosk === '1';

    const fsScript = `
  <script>
    function goFullscreen() {
      var el = document.documentElement;
      var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (fn) fn.call(el).catch(function(){});
    }
    window.addEventListener('load', function() {
      goFullscreen();
      setTimeout(goFullscreen, 600);
      setTimeout(goFullscreen, 2000);
    });
    document.addEventListener('fullscreenchange', function() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        setTimeout(goFullscreen, 200);
      }
    });
  </script>`;

    // ── tower_tv: redirect to the static app ──
    if (s.type === 'tower_tv') {
      return reply.redirect('/tower-tv/index.html');
    }

    // ── Portrait mode: serve portrait-native HTML directly ──
    if (wantPortrait) {
      let portraitHtml = s.html;

      if (wantKiosk) {
        portraitHtml = portraitHtml.replace('</body>', fsScript + '\n</body>');
      }
      return reply.type('text/html').send(portraitHtml);
    }

    // ── Landscape with kiosk: iframe wrapper with scaling ──
    if (wantKiosk) {
      const clientHost = req.headers.host || `${fastify.serverHost}:${fastify.serverPort}`;
      const rawUrl = `http://${clientHost}/api/signs/${s.id}/render`;
      const SW = 1920, SH = 1080;

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  .wrap { position: fixed; inset: 0; overflow: hidden; }
  #sign-frame {
    position: absolute;
    width: ${SW}px; height: ${SH}px;
    border: none; display: block;
    transform-origin: 0 0;
  }
</style>
  <script>
    function scaleSign() {
      var f = document.getElementById('sign-frame');
      var aw = window.innerWidth, ah = window.innerHeight;
      var scale = Math.min(aw / ${SW}, ah / ${SH});
      var x = (aw - ${SW} * scale) / 2;
      var y = (ah - ${SH} * scale) / 2;
      f.style.transform = 'scale(' + scale + ')';
      f.style.left = x + 'px';
      f.style.top  = y + 'px';
    }
    window.addEventListener('load',   scaleSign);
    window.addEventListener('resize', scaleSign);
  </script>${fsScript}
</head>
<body>
  <div class="wrap">
    <iframe id="sign-frame" src="${rawUrl}" scrolling="no" allowfullscreen></iframe>
  </div>
</body>
</html>`;
      return reply.type('text/html').send(html);
    }

    // ── Default: serve raw HTML or redirect ──
    if (s.type === 'url') {
      reply.redirect(s.url);
    } else {
      reply.type('text/html').send(s.html);
    }
  });
}

module.exports = signsRoutes;
