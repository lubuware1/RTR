const API_KEY = '15b079ce9d02424994eae82a3e5f4a31';
const BASE = 'https://api.football-data.org/v4';

exports.handler = async (event) => {
  const { matchday, season = '2025', comp = 'PL' } = event.queryStringParameters || {};
  if (!matchday) {
    return { statusCode: 400, body: JSON.stringify({ error: 'matchday required' }) };
  }

  try {
    const res = await fetch(
      `${BASE}/competitions/${comp.toUpperCase()}/matches?matchday=${matchday}&season=${season}`,
      { headers: { 'X-Auth-Token': API_KEY } }
    );
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
