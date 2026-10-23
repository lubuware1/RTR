// Scheduled function (see ../../netlify.toml) — every 10 minutes, imports new
// story documents from a Google Drive folder into RTR Articles as hidden
// drafts. Nothing goes live until you click "Publish" in admin.html.
//
// Workflow: write the story in the Claude app using the template below, paste
// it into a Google Doc (or save as .txt/.md) in the shared Drive folder, done.
//
// Document template (fixed, one field per line, then a "---" line, then body):
//
//   HEADLINE: Simon Hooper overturns his own call after four-minute review
//   DEK: A breakdown of the angle that changed the decision at St James' Park.
//   TAG: incident            (incident | match | forum | rating | fantasy | live)
//   TAG TEXT: VAR Review     (optional — label shown on the card)
//   META LEFT: GW14          (optional)
//   META RIGHT: Feature      (optional)
//   IMAGE: var               (optional placeholder style: pitch | var | crowd | locker)
//   ---
//   Body paragraphs, separated by a blank line.
//
// Docs that don't parse (no HEADLINE, no body) are skipped and logged, and
// retried next run, so fixing the doc is enough. Imported files are tracked by
// the UNIQUE drive_file_id column (supabase/articles-drive-import-setup.sql),
// so a repeat run can never create duplicates.
//
// Netlify env vars (server-side only):
//   SUPABASE_SERVICE_ROLE_KEY      — same one sync-live-incidents uses
//   GOOGLE_SERVICE_ACCOUNT_JSON    — full JSON key of a Google service account
//                                    (Drive API enabled on its project)
//   DRIVE_FOLDER_ID                — the folder's ID (last part of its URL);
//                                    share the folder with the service
//                                    account's email as Viewer

const crypto = require('crypto');

const SUPABASE_URL = 'https://sxufittkehlktlfvicom.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const FOLDER_ID = process.env.DRIVE_FOLDER_ID;

const TAGS = ['incident', 'match', 'forum', 'rating', 'fantasy', 'live'];
const VARIANTS = ['pitch', 'var', 'crowd', 'locker'];

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token -> ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// Pure parser so the template is easy to test: returns an article-shaped
// object, or { error } explaining why the doc was rejected.
function parseStory(text) {
  const clean = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sep = clean.search(/^\s*---+\s*$/m);
  if (sep === -1) return { error: 'no "---" line separating the fields from the body' };
  const head = clean.slice(0, sep);
  const body = clean.slice(sep).replace(/^\s*---+\s*$/m, '').trim();

  const fields = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^\s*([A-Za-z ]+?)\s*:\s*(.*?)\s*$/);
    if (m) fields[m[1].toUpperCase()] = m[2];
  }
  if (!fields['HEADLINE']) return { error: 'missing HEADLINE' };
  if (!body) return { error: 'empty body' };

  const tag = (fields['TAG'] || 'match').toLowerCase();
  const variant = (fields['IMAGE'] || 'pitch').toLowerCase();
  return {
    tag: TAGS.includes(tag) ? tag : 'match',
    tag_text: fields['TAG TEXT'] || '',
    headline: fields['HEADLINE'],
    dek: fields['DEK'] || '',
    body,
    meta_left: fields['META LEFT'] || '',
    meta_right: fields['META RIGHT'] || '',
    media: { type: 'css', variant: VARIANTS.includes(variant) ? variant : 'pitch' },
  };
}

exports.handler = async () => {
  if (!SERVICE_KEY) return { statusCode: 500, body: 'SUPABASE_SERVICE_ROLE_KEY not configured' };
  if (!SA_JSON || !FOLDER_ID) return { statusCode: 500, body: 'GOOGLE_SERVICE_ACCOUNT_JSON / DRIVE_FOLDER_ID not configured' };

  try {
    const token = await getGoogleToken(JSON.parse(SA_JSON));
    const gFetch = (url) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    const q = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed = false`);
    const listRes = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=100&orderBy=createdTime desc`);
    if (!listRes.ok) throw new Error(`Drive list -> ${listRes.status} ${await listRes.text()}`);
    const files = (await listRes.json()).files || [];
    if (!files.length) return { statusCode: 200, body: 'Folder empty' };

    const idList = files.map(f => f.id).join(',');  // Drive IDs are URL-safe
    const knownRes = await supabaseFetch(`/RTR%20Articles?select=drive_file_id&drive_file_id=in.(${idList})`);
    if (!knownRes.ok) throw new Error(`Supabase lookup -> ${knownRes.status}`);
    const known = new Set((await knownRes.json()).map(r => r.drive_file_id));

    const log = [];
    for (const f of files) {
      if (known.has(f.id)) continue;
      const isDoc = f.mimeType === 'application/vnd.google-apps.document';
      const isText = f.mimeType === 'text/plain' || f.mimeType === 'text/markdown';
      if (!isDoc && !isText) { log.push(`${f.name}: skipped (${f.mimeType})`); continue; }

      const url = isDoc
        ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`
        : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
      const textRes = await gFetch(url);
      if (!textRes.ok) { log.push(`${f.name}: download failed ${textRes.status}`); continue; }

      const story = parseStory(await textRes.text());
      if (story.error) { log.push(`${f.name}: ${story.error}`); continue; }

      const ins = await supabaseFetch('/RTR%20Articles?on_conflict=drive_file_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ ...story, status: 'draft', drive_file_id: f.id }),
      });
      log.push(`${f.name}: ${ins.ok ? 'imported as draft' : `insert failed ${ins.status}`}`);
    }
    console.log(log.join('\n'));
    return { statusCode: 200, body: log.join('\n') || 'Nothing new' };
  } catch (err) {
    console.error('[sync-drive-stories]', err);
    return { statusCode: 500, body: String(err.message || err) };
  }
};

exports.parseStory = parseStory;
