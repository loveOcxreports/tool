// netlify/functions/blob-write.js
// Called by Power Automate to cache monthly ticket data.
// Uses @netlify/blobs which handles S3 internally.
// POST /.netlify/functions/blob-write
// Header: x-app-token: <EK_BLOB_TOKEN>
// Body: { "tickets": [...] }

const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) ||
    (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const tickets = Array.isArray(data) ? data : (Array.isArray(data.tickets) ? data.tickets : []);
  const month = data.month || new Date().toISOString().slice(0, 7);
  const store = getStore({ name: 'ek-monthly', context });
  await store.setJSON('monthly-tickets', { tickets, month, cachedAt: new Date().toISOString(), count: tickets.length });

  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, month, count: tickets.length }) };
};
