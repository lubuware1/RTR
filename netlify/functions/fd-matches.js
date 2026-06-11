const https = require('https');

const FOOTBALL_DATA_KEY = '15b079ce9d02424994eae82a3e5f4a31';

exports.handler = async (event) => {
  const { matchday, season = '2025', comp = 'PL' } = event.queryStringParameters || {};

  if (!matchday) {
    return { statusCode: 400, body: JSON.stringify({ error: 'matchday param required' }) };
  }

  const path = `/v4/competitions/${comp}/matches?matchday=${matchday}&season=${season}`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(
        { hostname: 'api.football-data.org', path, headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } },
        res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`football-data.org returned ${res.statusCode}: ${body.slice(0, 200)}`));
            } else {
              resolve(body);
            }
          });
        }
      ).on('error', reject);
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: data,
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
