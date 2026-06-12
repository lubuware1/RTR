const https = require('https');

const API_KEY = '15b079ce9d02424994eae82a3e5f4a31';

exports.handler = async (event) => {
  const { id } = event.queryStringParameters || {};
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
  }

  const path = `/v4/matches/${id}`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(
        { hostname: 'api.football-data.org', path, headers: { 'X-Auth-Token': API_KEY } },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: data,
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
