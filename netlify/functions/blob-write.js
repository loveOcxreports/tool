// netlify/functions/blob-write.js
// NO external dependencies — uses only built-in Node.js https module.
// Called by Power Automate to cache monthly tickets.
// POST /.netlify/functions/blob-write?token=ekedp-blob-2026
// Body: raw JSON array of tickets

const https = require('https');

function httpsRequest(options, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function (event, context) {
  var CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) ||
    qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';

  if (!netlifyToken) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };
  }

  var data;
  try { data = JSON.parse(event.body || '[]'); } catch (e) {
    return { statusCode: 400, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  var tickets = Array.isArray(data) ? data : (Array.isArray(data.tickets) ? data.tickets : []);
  var month = (data && data.month) || new Date().toISOString().slice(0, 7);
  var payload = JSON.stringify({ tickets: tickets, month: month, cachedAt: new Date().toISOString(), count: tickets.length });

  try {
    // Step 1: Get signed S3 upload URL from Netlify
    var metaRes = await httpsRequest({
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + netlifyToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }
    }, payload);

    if (metaRes.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error: 'Netlify API error: ' + metaRes.status, detail: metaRes.body }) };
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ok: true, month: month, count: tickets.length }) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'Write failed: ' + e.message }) };
  }
};
