// netlify/functions/blob-write.js
// Two-step Netlify Blob write: 1) get presigned S3 URL, 2) PUT data to S3.
// POST /.netlify/functions/blob-write?x-app-token=ekedp-blob-2026
// Body: raw JSON array of tickets (no npm dependencies)

const https = require('https');
const http = require('http');

function request(options, body) {
  return new Promise(function (resolve, reject) {
    var mod = options.hostname.endsWith('.amazonaws.com') ? https : https;
    var req = (options.protocol === 'http:' ? http : https).request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) || qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  var data;
  try { data = JSON.parse(event.body || '[]'); } catch (e) {
    return { statusCode: 400, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  var tickets = Array.isArray(data) ? data : (Array.isArray(data.tickets) ? data.tickets : []);
  var month = (data && data.month) || new Date().toISOString().slice(0, 7);
  var payload = JSON.stringify({ tickets: tickets, month: month, cachedAt: new Date().toISOString(), count: tickets.length });

  try {
    // Step 1: Get presigned S3 upload URL from Netlify
    var step1 = await request({
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json' }
    });

    if (step1.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Netlify API error: ' + step1.status, detail: step1.body.slice(0, 200) }) };
    }

    var meta;
    try { meta = JSON.parse(step1.body); } catch (e) { meta = {}; }

    if (!meta.url) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No presigned URL returned', detail: step1.body.slice(0, 200) }) };
    }

    // Step 2: PUT data to S3 presigned URL
    var s3url = new URL(meta.url);
    var s3 = await request({
      hostname: s3url.hostname,
      path: s3url.pathname + s3url.search,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, payload);

    if (s3.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'S3 upload error: ' + s3.status }) };
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, month: month, count: tickets.length }) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Write failed: ' + e.message }) };
  }
};
