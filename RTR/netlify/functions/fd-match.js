const API_KEY = '15b079ce9d02424994eae82a3e5f4a31';
const BASE = 'https://api.football-data.org/v4';

exports.handler = async (event) => {
  const { id } = event.queryStringParameters || {};
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
  }

  try {
    const res = await fetch(`${BASE}/matches/${id}`, {
      headers: { 'X-Auth-Token': API_KEY },
    });
    const data = await res.json();

    // football-data.org v4 returns card values as YELLOW / YELLOW_RED / RED,
    // but the frontend counts YELLOW_CARD / YELLOW_RED_CARD / RED_CARD. Normalise
    // so bookings (and the per-card incidents) pull through correctly.
    const CARD_MAP = { YELLOW: 'YELLOW_CARD', YELLOW_RED: 'YELLOW_RED_CARD', RED: 'RED_CARD' };
    if (Array.isArray(data.bookings)) {
      data.bookings = data.bookings.map(b => ({ ...b, card: CARD_MAP[b.card] || b.card }));
    }

    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
