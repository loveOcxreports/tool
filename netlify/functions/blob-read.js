// netlify/functions/blob-read.js
// Reads monthly tickets from Netlify Blob default store.
// GET /.netlify/functions/blob-read?token=ekedp-blob-2026

const https = require('https');

function httpsGet(urlStr, headers) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: headers || {} };
    https.request(opts, function (res) {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
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

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  try {
    // Step 1: Ask Netlify for blob → returns {url: "signed-S3-url"}
    var res = await httpsGet(
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/monthly-tickets',
      { 'Authorization': 'Bearer ' + netlifyToken }
    );

    if (res.status === 404) {
      return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }) };
    }
    if (res.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Netlify API error: HTTP ' + res.status, detail: res.body.slice(0, 200) }) };
    }

    var parsed;
    try { parsed = JSON.parse(res.body); } catch (e) { parsed = null; }

    // Step 2: If Netlify returned a presigned S3 URL, follow it
    if (parsed && parsed.url) {
      var s3 = await httpsGet(parsed.url, {});
      if (s3.status >= 400) {
        return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'S3 fetch error: HTTP ' + s3.status }) };
      }
      try { parsed = JSON.parse(s3.body); } catch (e) { parsed = null; }
    }

    if (!parsed) return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Could not parse blob data' }) };
    if (Array.isArray(parsed)) parsed = { tickets: parsed, cachedAt: new Date().toISOString(), count: parsed.length };

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(parsed) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Read failed: ' + e.message }) };
  }
};
