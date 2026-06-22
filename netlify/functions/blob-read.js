// netlify/functions/blob-read.js
// Reads tickets from Netlify Blob — merges daily + monthly stores.

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
    // Step 1: get signed S3 URL from Netlify
    var r1 = await httpsGet(
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + key,
      { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    );
    if (r1.status === 404) return null;
    if (r1.status !== 200) return null;

    // Try to parse as direct content first
    try {
      var direct = JSON.parse(r1.body);
      // If it has tickets array — it's direct content
      if (direct && (Array.isArray(direct) || Array.isArray(direct.tickets))) return direct;
      // If it has a signed URL — follow it immediately
      if (direct && direct.url) {
        var r2 = await httpsGet(direct.url, {});
        if (r2.status !== 200) return null;
        return JSON.parse(r2.body);
      }
    } catch(e) {}
    return null;
  } catch(e) { return null; }
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, {'Content-Type':'application/json'}), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  try {
    var monthly = await readBlob(siteId, netlifyToken, 'monthly-tickets');
    var daily = await readBlob(siteId, netlifyToken, 'daily-tickets');

    var monthlyTickets = (monthly && (Array.isArray(monthly) ? monthly : monthly.tickets)) || [];
    var dailyTickets = (daily && (Array.isArray(daily) ? daily : daily.tickets)) || [];

    // Merge: monthly is base, daily updates on top
    var merged = monthlyTickets.slice();
    var idMap = {};
    merged.forEach(function(t, i) { if (t.id) idMap[t.id] = i; });
    dailyTickets.forEach(function(t) {
      if (t.id && idMap[t.id] !== undefined) merged[idMap[t.id]] = t;
      else merged.push(t);
    });

    if (!merged.length) {
      return { statusCode: 404, headers: Object.assign({}, CORS, {'Content-Type':'application/json'}), body: JSON.stringify({ error: 'No blob data yet — run PA flow first', monthlyRaw: !!monthly, dailyRaw: !!daily }) };
    }

    return {
      statusCode: 200,
      headers: Object.assign({}, CORS, {'Content-Type':'application/json'}),
      body: JSON.stringify({ tickets: merged, count: merged.length, cachedAt: new Date().toISOString(), source: 'all', monthlyCount: monthlyTickets.length, dailyCount: dailyTickets.length })
    };
  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, {'Content-Type':'application/json'}), body: JSON.stringify({ error: e.message }) };
  }
};
