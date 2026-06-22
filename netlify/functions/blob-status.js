// netlify/functions/blob-status.js
// Returns metadata about what's cached in the blob (without loading all tickets)

const https = require('https');
const http = require('http');

function httpGet(urlStr) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var req = (url.protocol === 'https:' ? https : http).get(url, function (res) {
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
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

  var siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  try {
    // Get blob metadata from Netlify
    var metaRes = await new Promise(function (resolve, reject) {
      var opts = {
        hostname: 'api.netlify.com',
        path: '/api/v1/sites/' + siteId + '/blobs/monthly-tickets?store=ek-monthly',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + netlifyToken }
      };
      var req = https.request(opts, function (res) {
        var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data, headers: res.headers }); });
      });
      req.on('error', reject);
      req.end();
    });

    if (metaRes.status === 404) {
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ cached: false, message: 'No blob cached yet — run the PA flow first.' }) };
    }

    var meta;
    try { meta = JSON.parse(metaRes.body); } catch (e) { meta = null; }

    // Follow S3 URL to get the actual data
    if (meta && meta.url) {
      var s3Res = await httpGet(meta.url);
      var data;
      try { data = JSON.parse(s3Res.body); } catch (e) { data = null; }
      if (data) {
        return {
          statusCode: 200,
          headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            cached: true,
            count: data.count || (Array.isArray(data.tickets) ? data.tickets.length : 0),
            month: data.month || 'unknown',
            source: data.source || 'unknown',
            cachedAt: data.cachedAt || 'unknown',
            lastTicketNum: Array.isArray(data.tickets) && data.tickets.length ? data.tickets[0].num : null
          })
        };
      }
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ cached: true, rawStatus: metaRes.status, note: 'Could not parse blob data' }) };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Status check failed: ' + e.message }) };
  }
};
