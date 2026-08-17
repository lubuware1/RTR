const crypto = require('crypto');

const SECRET = process.env.ADMIN_PANEL_PASSWORD;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(expiresAt) {
  return crypto.createHmac('sha256', SECRET).update(String(expiresAt)).digest('hex');
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Admin panel password not configured' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }

  if (payload.action === 'login') {
    const password = String(payload.password || '');
    if (!password || !timingSafeStringEqual(password, SECRET)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Incorrect password' }) };
    }
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const token = `${expiresAt}.${sign(expiresAt)}`;
    return { statusCode: 200, body: JSON.stringify({ ok: true, token, expiresAt }) };
  }

  if (payload.action === 'verify') {
    const token = String(payload.token || '');
    const [expiresAtStr, sig] = token.split('.');
    const expiresAt = Number(expiresAtStr);
    const isValid = expiresAt && sig && Date.now() <= expiresAt && timingSafeStringEqual(sig, sign(expiresAt));
    return { statusCode: 200, body: JSON.stringify({ ok: !!isValid }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
