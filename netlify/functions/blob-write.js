// netlify/functions/blob-write.js
// Writes monthly tickets to Netlify Blob store.
// Handles various body formats PA might send.

const https = require('https');
const http = require('http');

function httpPut(urlStr, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var buf = Buffer.from(body, 'utf8');
    var opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length }
    };
    var req = (url.protocol === 'https:' ? https : http).request(opts, function (res) {
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function netlifyPut(siteId, netlifyToken, payload) {
  return new Promise(function (resolve, reject) {
    var buf = Buffer.from(payload, 'utf8');
    var opts = {
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json', 'Content-Length': buf.length }
    };
    var req = https.request(opts, function (res) {
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data, headers: res.headers }); });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  // Token check — accept header OR query param
  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) || qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  // Parse body — be lenient: raw array, {tickets:[...]}, or stringified
  var rawBody = event.body || '[]';
  var data;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    // Try to extract JSON from the body if it has extra content
    var match = rawBody.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) {
      try { data = JSON.parse(match[1]); } catch (e2) {
        return { statusCode: 400, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Invalid JSON body', received: rawBody.slice(0, 100) }) };
      }
    } else {
      return { statusCode: 400, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Invalid JSON body', received: rawBody.slice(0, 100) }) };
    }
  }

  // Normalise to array
  var tickets = Array.isArray(data) ? data : (Array.isArray(data.tickets) ? data.tickets : []);
  var month = (data && !Array.isArray(data) && data.month) || new Date().toISOString().slice(0, 7);
  var source = (data && !Array.isArray(data) && data.source) || (tickets.length < 50 ? 'daily' : 'monthly');
  var payload = JSON.stringify({ tickets: tickets, month: month, source: source, cachedAt: new Date().toISOString(), count: tickets.length });

  try {
    // Direct PUT to Netlify Blob API
    var res = await netlifyPut(siteId, netlifyToken, payload);

    if (res.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Netlify API error: ' + res.status, detail: res.body.slice(0, 300) }) };
    }

    // If Netlify returns a presigned S3 URL, PUT to it
    var meta;
    try { meta = JSON.parse(res.body); } catch (e) { meta = null; }
    if (meta && meta.url) {
      var s3 = await httpPut(meta.url, payload);
      if (s3.status >= 400) {
        return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'S3 upload error: ' + s3.status }) };
      }
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, month: month, count: tickets.length }) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Write failed: ' + e.message }) };
  }
};
