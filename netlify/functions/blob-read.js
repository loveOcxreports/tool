// netlify/functions/blob-read.js
// Reads monthly tickets from Netlify Blob default store.
// GET /.netlify/functions/blob-read

const https = require('https');

function httpsGet(urlStr, hdrs) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: hdrs || {} };
    https.request(opts, function (res) {
      if ([301,302,307,308].indexOf(res.statusCode) > -1 && res.headers.location) {
        return httpsGet(res.headers.location, hdrs).then(resolve).catch(reject);
      }
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject).end();
  });
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = '295cb737-81ef-436d-91e5-0def385f4b88';

  if (!netlifyToken) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set in env vars' }) };
  }

  try {
    // Step 1: Get signed S3 URL from Netlify Blob API
    var res1 = await httpsGet(
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/monthly-tickets',
      { 'Authorization': 'Bearer ' + netlifyToken }
    );

    if (res1.status === 404) {
      return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No blob yet — run PA flow first' }) };
    }
    if (res1.status !== 200) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Netlify API error: ' + res1.status, detail: res1.body }) };
    }

    var meta;
    try { meta = JSON.parse(res1.body); } catch(e) { meta = null; }

    // Step 2: Follow S3 URL if needed
    var data;
    if (meta && meta.url) {
      var res2 = await httpsGet(meta.url, {});
      if (!res2.ok && res2.status !== 200) {
        return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'S3 fetch failed: ' + res2.status }) };
      }
      try { data = JSON.parse(res2.body); } catch(e) { data = res2.body; }
    } else {
      data = meta;
    }

    // Normalise: array → wrap in {tickets, cachedAt, count}
    var normalized = Array.isArray(data)
      ? { tickets: data, cachedAt: new Date().toISOString(), count: data.length, source: 'blob' }
      : (data && data.tickets ? data : { tickets: [], cachedAt: new Date().toISOString(), count: 0, source: 'blob-empty' });

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify(normalized) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Function error: ' + e.message }) };
  }
};
