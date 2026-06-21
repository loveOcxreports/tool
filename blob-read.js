// netlify/functions/blob-read.js
// Uses NETLIFY_BLOBS_CONTEXT (auto-injected) for internal blob access — no S3 dance.
// Falls back to external API if context not available.
// GET /.netlify/functions/blob-read?token=ekedp-blob-2026

const https = require('https');

function httpGet(urlStr, headers) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: headers || {} };
    https.request(opts, function (res) {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        return httpGet(res.headers.location, {}).then(resolve).catch(reject);
      }
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data, headers: res.headers }); });
    }).on('error', reject).end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) || qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    var res;

    // Method 1: Use NETLIFY_BLOBS_CONTEXT (auto-injected internal access — fastest, no S3 redirect)
    var ctx = process.env.NETLIFY_BLOBS_CONTEXT ? JSON.parse(process.env.NETLIFY_BLOBS_CONTEXT) : null;
    if (ctx && ctx.url && ctx.token) {
      var internalUrl = ctx.url.replace(/\/$/, '') + '/' + (ctx.siteID || process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88') + '/ek-monthly/monthly-tickets';
      res = await httpGet(internalUrl, { 'Authorization': 'Bearer ' + ctx.token });
    }

    // Method 2: External Netlify API
    if (!res || res.status === 404) {
      var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
      var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
      if (netlifyToken) {
        // Try path-based format
        res = await httpGet('https://api.netlify.com/api/v1/blobs/' + siteId + '/ek-monthly/monthly-tickets', { 'Authorization': 'Bearer ' + netlifyToken });
        // If that 404s, try query-param format
        if (res.status === 404) {
          res = await httpGet('https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly', { 'Authorization': 'Bearer ' + netlifyToken });
        }
      }
    }

    if (!res) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No read method available' }) };
    if (res.status === 404) return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }) };
    if (res.status >= 400) return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'API error: HTTP ' + res.status, detail: res.body.slice(0, 200) }) };

    // Parse response — might be JSON with {url:...} or direct data
    var parsed;
    try { parsed = JSON.parse(res.body); } catch (e) { parsed = null; }

    // If it returned a presigned URL, follow it
    if (parsed && parsed.url) {
      var s3 = await httpGet(parsed.url, {});
      try { parsed = JSON.parse(s3.body); } catch (e) { parsed = null; }
    }

    if (!parsed) return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Could not parse blob data' }) };
    if (Array.isArray(parsed)) parsed = { tickets: parsed, cachedAt: new Date().toISOString(), count: parsed.length };

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Read failed: ' + e.message }) };
  }
};
