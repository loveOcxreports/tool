// netlify/functions/blob-write.js
// Accepts POST from PA flow — writes tickets to Netlify Blob default store.
// ?store=daily → daily-tickets key
// ?store=monthly (default) → monthly-tickets key

const https = require('https');

function httpsReq(method, urlStr, hdrs, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var data = body || '';
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: method, headers: Object.assign({ 'Content-Length': Buffer.byteLength(data) }, hdrs) };
    var req = https.request(opts, function (res) {
      var d = ''; res.on('data', function (c) { d += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: d }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
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

  var qs = event.queryStringParameters || {};
  var store = (qs.store || 'monthly').toLowerCase();
  var blobKey = store === 'daily' ? 'daily-tickets' : 'monthly-tickets';

  try {
    var raw = event.body || '[]';
    var tickets = [];
    try { var parsed = JSON.parse(raw); tickets = Array.isArray(parsed) ? parsed : (parsed.tickets || []); } catch(e) { tickets = []; }

    var payload = JSON.stringify({ tickets: tickets, count: tickets.length, cachedAt: new Date().toISOString(), source: store });

    var res = await httpsReq('PUT',
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + blobKey,
      { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json' },
      payload
    );

    if (res.status >= 300) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Blob write failed: ' + res.status }) };
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, store: blobKey, count: tickets.length }) };
  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: e.message }) };
  }
};
