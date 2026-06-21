// netlify/functions/blob-read.js
// Called by both hubs to read cached monthly ticket data.
// Uses @netlify/blobs which handles S3 internally.
// GET /.netlify/functions/blob-read?token=<EK_BLOB_TOKEN>

const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) ||
    (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized — check your token' }) };
  }

  try {
    const store = getStore({ name: 'ek-monthly', context });
    const data = await store.get('monthly-tickets', { type: 'json' });

    if (!data) {
      return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }) };
    }

    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Blob read error: ' + e.message }) };
  }
};
