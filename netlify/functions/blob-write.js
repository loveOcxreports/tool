// netlify/functions/blob-write.js
// Accepts both daily and monthly PA flow writes.
// Use ?store=daily for daily flow, ?store=monthly for monthly flow.
// Defaults to 'monthly' if no store param.

const https = require('https');

function httpsReq(method, urlStr, hdrs, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: method, headers: Object.assign({ 'Content-Length': Buffer.byteLength(body || '') }, hdrs) };
    var req = https.request(opts, function (res) {
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = '295cb737-81ef-436d-91e5-0def385f4b88';

  if (!netlifyToken) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };
  }

  // Determine which blob store to write to
  var qs = event.queryStringParameters || {};
  var store = (qs.store || 'monthly').toLowerCase(); // 'daily' or 'monthly'
  var blobKey = store === 'daily' ? 'daily-tickets' : 'monthly-tickets';

  try {
    var raw = event.body || '[]';
    // Parse and normalise
    var tickets = JSON.parse(raw);
    if (!Array.isArray(tickets)) tickets = tickets.tickets || [];

    var payload = JSON.stringify({
      tickets: tickets,
      count: tickets.length,
      cachedAt: new Date().toISOString(),
      source: store
    });

    // Write to Netlify Blob
    var res = await httpsReq(
      'PUT',
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + blobKey,
      { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json' },
      payload
    );

    if (res.status >= 300) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Blob write failed: ' + res.status, detail: res.body }) };
    }

    return {
      statusCode: 200,
      headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ok: true, store: blobKey, count: tickets.length, cachedAt: new Date().toISOString() })
    };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Function error: ' + e.message }) };
  }
};
