// netlify/functions/blob-read.js
// Reads tickets from Netlify Blob — merges daily + monthly stores.
// GET /.netlify/functions/blob-read?store=daily|monthly|all (default: all)

const https = require('https');

function httpsGet(urlStr, hdrs) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlStr);
    var opts = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: hdrs || {} };
    https.request(opts, function (res) {
      if ([301,302,307,308].indexOf(res.statusCode) > -1 && res.headers.location) {
        return httpsGet(res.headers.location, {}).then(resolve).catch(reject);
      }
      var data = ''; res.on('data', function (c) { data += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    }).on('error', reject).end();
  });
}

async function readBlob(siteId, token, key) {
  try {
    var r1 = await httpsGet('https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + key, { 'Authorization': 'Bearer ' + token });
    if (r1.status === 404) return null;
    if (r1.status !== 200) return null;
    var meta = JSON.parse(r1.body);
    if (meta && meta.url) {
      var r2 = await httpsGet(meta.url, {});
      return JSON.parse(r2.body);
    }
    return meta;
  } catch(e) { return null; }
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = '295cb737-81ef-436d-91e5-0def385f4b88';

  if (!netlifyToken) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };
  }

  var qs = event.queryStringParameters || {};
  var store = (qs.store || 'all').toLowerCase();

  try {
    var monthly = null, daily = null;

    if (store === 'monthly') {
      monthly = await readBlob(siteId, netlifyToken, 'monthly-tickets');
    } else if (store === 'daily') {
      daily = await readBlob(siteId, netlifyToken, 'daily-tickets');
    } else {
      // Read both and merge — monthly is the base, daily updates on top
      monthly = await readBlob(siteId, netlifyToken, 'monthly-tickets');
      daily = await readBlob(siteId, netlifyToken, 'daily-tickets');
    }

    // Get ticket arrays
    var monthlyTickets = (monthly && (Array.isArray(monthly) ? monthly : monthly.tickets)) || [];
    var dailyTickets = (daily && (Array.isArray(daily) ? daily : daily.tickets)) || [];

    // Merge: start with monthly, overlay daily (by ticket id)
    var merged = monthlyTickets.slice();
    var idMap = {};
    merged.forEach(function(t, i) { if (t.id) idMap[t.id] = i; });
    dailyTickets.forEach(function(t) {
      if (t.id && idMap[t.id] !== undefined) {
        merged[idMap[t.id]] = t; // update existing
      } else {
        merged.push(t); // add new daily ticket not in monthly
      }
    });

    if (!merged.length) {
      return { statusCode: 404, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'No blob data yet — run PA flow first' }) };
    }

    return {
      statusCode: 200,
      headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        tickets: merged,
        count: merged.length,
        cachedAt: new Date().toISOString(),
        source: store,
        monthlyCount: monthlyTickets.length,
        dailyCount: dailyTickets.length
      })
    };

  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Function error: ' + e.message }) };
  }
};
