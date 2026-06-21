// netlify/functions/blob-read.js
// Reads monthly tickets from Netlify Blob store.
// Handles both 302 redirect and {url:...} JSON response from Netlify API.
// GET /.netlify/functions/blob-read?token=ekedp-blob-2026 (no npm dependencies)

const https = require('https');

function httpsGet(urlStr) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: { 'User-Agent': 'EKEDP-BlobRead/1.0' } };
    https.request(opts, function (res) {
      // Follow redirects (301/302/307)
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject).end();
  });
}

function netlifyGet(siteId, netlifyToken) {
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + netlifyToken, 'User-Agent': 'EKEDP-BlobRead/1.0' }
    };
    https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    }).on('error', reject).end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) || qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Unauthorized — check your token' }) };
  }

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  try {
    // Step 1: Call Netlify Blob API
    var step1 = await netlifyGet(siteId, netlifyToken);

    if (step1.status === 404) {
      return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }) };
    }

    // Case A: Netlify returned a redirect to S3
    if ((step1.status === 301 || step1.status === 302 || step1.status === 307) && step1.headers.location) {
      var s3 = await httpsGet(step1.headers.location);
      var finalData = JSON.parse(s3.body);
      if (Array.isArray(finalData)) finalData = { tickets: finalData, cachedAt: new Date().toISOString(), count: finalData.length };
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(finalData) };
    }

    // Case B: Netlify returned JSON with {url: "..."}
    var meta;
    try { meta = JSON.parse(step1.body); } catch (e) { meta = null; }

    if (meta && meta.url) {
      var s3b = await httpsGet(meta.url);
      var finalDataB = JSON.parse(s3b.body);
      if (Array.isArray(finalDataB)) finalDataB = { tickets: finalDataB, cachedAt: new Date().toISOString(), count: finalDataB.length };
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(finalDataB) };
    }

    // Case C: Netlify returned data directly
    if (meta && (meta.tickets || meta.count)) {
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(meta) };
    }

    return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Unexpected API response: ' + step1.status, detail: step1.body.slice(0, 200) }) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Read failed: ' + e.message }) };
  }
};
