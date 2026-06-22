// netlify/functions/blob-read.js
// NO external dependencies — uses only built-in Node.js https module.
// Called by both hubs to read cached monthly tickets.
// GET /.netlify/functions/blob-read?token=ekedp-blob-2026

const https = require('https');

function httpsGet(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject);
  });
}

function httpsRequest(options) {
  return new Promise(function (resolve, reject) {
    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function (event) {
  var CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var qs = event.queryStringParameters || {};
  var token = (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) ||
    qs.token || qs['x-app-token'] || '';
  if (!process.env.EK_BLOB_TOKEN || token !== process.env.EK_BLOB_TOKEN) {
    return { statusCode: 401, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'Unauthorized — check your token' }) };
  }

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';

  if (!netlifyToken) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };
  }

  try {
    // Step 1: Get signed S3 read URL from Netlify
    var metaRes = await httpsRequest({
      hostname: 'api.netlify.com',
      path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + netlifyToken }
    });

    if (metaRes.status === 404) {
      return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }) };
    }
    if (metaRes.status >= 400) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error: 'Netlify API error: ' + metaRes.status }) };
    }

    // Step 2: Follow S3 signed URL if returned
    var meta;
    try { meta = JSON.parse(metaRes.body); } catch (e) { meta = null; }

    var finalData;
    if (meta && meta.url) {
      var s3Res = await httpsGet(meta.url);
      if (s3Res.status >= 400) {
        return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ error: 'S3 fetch error: ' + s3Res.status }) };
      }
      try { finalData = JSON.parse(s3Res.body); } catch (e) { finalData = meta; }
    } else {
      finalData = meta || {};
    }

    // Normalise: wrap plain array
    if (Array.isArray(finalData)) finalData = { tickets: finalData, cachedAt: new Date().toISOString(), count: finalData.length };

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(finalData) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ error: 'Read failed: ' + e.message }) };
  }
};
