// Local dev server — serves RTR/ files + proxies football-data.org API
// Usage: node local-server.js
// Then open: http://localhost:3000

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT    = 3000;
const ROOT    = path.join(__dirname, 'RTR');
const FD_KEY  = '15b079ce9d02424994eae82a3e5f4a31';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── API proxy ───────────────────────────────────────────
  if (parsed.pathname === '/api/fd-matches') {
    const { matchday, season = '2025' } = parsed.query;
    if (!matchday) { res.writeHead(400); res.end('matchday required'); return; }

    const apiUrl = `https://api.football-data.org/v4/competitions/PL/matches?matchday=${matchday}&season=${season}`;
    https.get(apiUrl, { headers: { 'X-Auth-Token': FD_KEY } }, apiRes => {
      let body = '';
      apiRes.on('data', d => body += d);
      apiRes.on('end', () => {
        res.writeHead(apiRes.statusCode, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
      });
    }).on('error', e => { res.writeHead(502); res.end(e.message); });
    return;
  }

  // ── Static files ────────────────────────────────────────
  let filePath = parsed.pathname === '/' ? '/matches-api.html' : parsed.pathname;
  filePath = path.join(ROOT, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  RefRater dev server running`);
  console.log(`  Open: http://localhost:${PORT}\n`);
});
