// ════════════════════════════════════════════════════════
//  RefRater — Local Dev Server
//  Serves the app AND proxies API calls to football-data.org
//  so there are no CORS issues.
//
//  Usage:  node server.js
//  Then open:  http://localhost:3000
//
//  No npm install needed — uses Node.js built-ins only.
// ════════════════════════════════════════════════════════

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;

// Read the API key directly from shared.js so you only set it in one place
function getApiKey() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'shared.js'), 'utf8');
    const m = src.match(/FOOTBALL_DATA_KEY\s*=\s*'([^']*)'/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
};

http.createServer((req, res) => {

  // ── API PROXY ────────────────────────────────────────────
  // Requests to /api/* are forwarded to football-data.org
  if (req.url.startsWith('/api/')) {
    const key = getApiKey();
    // /api/fd-matches?matchday=X&season=Y&comp=Z  →  /v4/competitions/{comp}/matches?matchday=X&season=Y
    let apiPath;
    if (req.url.startsWith('/api/fd-matches')) {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const comp     = qs.get('comp')     || 'PL';
      const matchday = qs.get('matchday') || '1';
      const season   = qs.get('season')   || '2025';
      apiPath = `/v4/competitions/${comp}/matches?matchday=${matchday}&season=${season}`;
    } else {
      apiPath = '/v4' + req.url.slice(4); // legacy: /api/competitions/... etc
    }

    if (!key) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FOOTBALL_DATA_KEY not set in shared.js' }));
      return;
    }

    const options = {
      hostname: 'api.football-data.org',
      path: apiPath,
      headers: { 'X-Auth-Token': key },
    };

    https.get(options, apiRes => {
      res.writeHead(apiRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      apiRes.pipe(res);
    }).on('error', e => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });

    return;
  }

  // ── STATIC FILES ─────────────────────────────────────────
  const urlPath  = req.url.split('?')[0];
  const filePath = path.join(__dirname, urlPath === '/' ? 'matches.html' : urlPath);
  const ext      = path.extname(filePath) || '.html';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 — file not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });

}).listen(PORT, () => {
  const key = getApiKey();
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║   RefRater Dev Server                ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║   http://localhost:${PORT}               ║`);
  console.log(`  ║   API key: ${key ? key.slice(0,8) + '…  ✓' : 'NOT SET ✗             '}          ║`);
  console.log('  ╚══════════════════════════════════════╝\n');
});
