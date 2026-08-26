// Dynamically regenerates sitemap.xml from real DB content on every
// request, instead of a static file that silently goes stale (found
// pointing at a removed page, dated months old, and missing every
// article/referee URL entirely). Wired to the public /sitemap.xml path
// via RTR/_redirects.

const SUPABASE_URL = 'https://sxufittkehlktlfvicom.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dWZpdHRrZWhsa3RsZnZpY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTEwNDIsImV4cCI6MjA5MDM2NzA0Mn0.aItkjIGsik_v_T6n167bdwE23ncvvWgwJ4IveT5MFyU';
const BASE = 'https://refrater.uk';

const STATIC_PAGES = [
  { path: '/',               changefreq: 'daily',   priority: '1.0' },
  { path: '/matches.html',   changefreq: 'daily',   priority: '0.9' },
  { path: '/referees.html',  changefreq: 'weekly',  priority: '0.8' },
  { path: '/forum.html',     changefreq: 'daily',   priority: '0.7' },
  { path: '/badges.html',    changefreq: 'monthly', priority: '0.4' },
];

function supabaseFetch(path) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

exports.handler = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const entries = STATIC_PAGES.map(p => urlEntry(`${BASE}${p.path}`, today, p.changefreq, p.priority));

  try {
    const [articlesRes, refsRes] = await Promise.all([
      supabaseFetch('/RTR%20Articles?select=id,updated_at&order=id.asc'),
      supabaseFetch('/RTR%20Referees?select=id&order=id.asc'),
    ]);
    const articles = articlesRes.ok ? await articlesRes.json() : [];
    const refs = refsRes.ok ? await refsRes.json() : [];

    articles.forEach(a => {
      const lastmod = (a.updated_at || today).slice(0, 10);
      entries.push(urlEntry(`${BASE}/article.html?id=${a.id}`, lastmod, 'monthly', '0.6'));
    });
    refs.forEach(r => {
      entries.push(urlEntry(`${BASE}/referee.html?id=${r.id}`, today, 'weekly', '0.5'));
    });
  } catch (e) {
    // Fall back to just the static pages rather than a 502 — a partial
    // sitemap is far better than none for a crawler.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
    body: xml,
  };
};
