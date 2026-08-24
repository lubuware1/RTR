// Posts a (possibly hand-edited) social draft to X via Zernio, called from
// admin.html's Social Posts review section when you click "Post to X".
//
// Request shape confirmed from https://docs.zernio.com/posts/create-post:
//   POST {ZERNIO_BASE}/v1/posts
//   Authorization: Bearer <ZERNIO_API_KEY>
//   { content, platforms: [{ platform: 'twitter', accountId }], publishNow: true }
//
// NOT yet confirmed against a real account — the docs excerpt didn't state
// the actual API base URL, so ZERNIO_BASE below is a best guess
// (https://api.zernio.com) and may need correcting once this is tested
// live. If posting fails with a connection/DNS error rather than an auth
// or validation error, that's the first thing to check.
//
// Requires two Netlify env vars (server-side only):
//   ZERNIO_API_KEY     — from the Zernio dashboard
//   ZERNIO_ACCOUNT_ID  — the connected X account's ID within Zernio,
//                         visible in the dashboard after connecting X via
//                         their OAuth flow

const ZERNIO_BASE = 'https://api.zernio.com';
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const ZERNIO_ACCOUNT_ID = process.env.ZERNIO_ACCOUNT_ID;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!ZERNIO_API_KEY || !ZERNIO_ACCOUNT_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ZERNIO_API_KEY / ZERNIO_ACCOUNT_ID not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }
  const text = String(payload.text || '').trim();
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'text is required' }) };
  }
  if (text.length > 280) {
    return { statusCode: 400, body: JSON.stringify({ error: `Text is ${text.length} characters — X's limit is 280` }) };
  }

  try {
    const res = await fetch(`${ZERNIO_BASE}/v1/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ZERNIO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: text,
        platforms: [{ platform: 'twitter', accountId: ZERNIO_ACCOUNT_ID }],
        publishNow: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data.error || data.message || `Zernio returned ${res.status}` }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, result: data }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: `post-to-x error: ${err.message}` }) };
  }
};
