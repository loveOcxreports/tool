// netlify/functions/blob-write.js
// Accepts POST from PA flow — maps SharePoint items OR pre-built tickets.
// Writes to monthly-tickets (default) or daily-tickets (?store=daily)

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

function toWAT(isoStr) {
  try {
    var d = new Date(isoStr);
    return d.toLocaleString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch(e) { return ''; }
}

function mapStatus(v) {
  if (!v) return 'unresolved';
  var u = v.toUpperCase();
  if (u === 'RESOLVED') return 'resolved';
  if (u === 'IN PROGRESS') return 'progress';
  return 'unresolved';
}

function mapItem(item) {
  // If already pre-built (has 'id' field starting with tk_), pass through
  if (item.id && String(item.id).indexOf('tk_') === 0) return item;

  // Raw SharePoint item
  var id = item.ID || item.Id || item.id || '';
  var created = item.Created || item.created || '';
  var appStatus = (item.APPStatus && (item.APPStatus.Value || item.APPStatus)) || item.appStatus || '';

  return {
    id: 'tk_' + id,
    num: String(id),
    created: created,
    time: toWAT(created),
    name: item.CustomerName || item.name || '',
    phone: item.TelephoneNumber || item.phone || '',
    email: item.EmailAddress || item.email || '',
    meter: item.MeterNumber || item.meter || '',
    addr: item.CustomerAddress || item.addr || '',
    bu: (item.BusinessUnit && (item.BusinessUnit.Value || item.BusinessUnit)) || item.bu || '',
    issue: item.ComplaintDescription || item.issue || '',
    category: item.ComplaintCategory || item.category || '',
    resp: (item.Responsible_x0020_Party && (item.Responsible_x0020_Party.Value || item.Responsible_x0020_Party)) || item.resp || '',
    status: mapStatus(appStatus),
    appStatus: appStatus,
    note: item.ActionTaken || item.note || '',
    resolvedDate: item.ResolvedDate || item.resolvedDate || '',
    resolvedBy: item.Resolvedby || item.resolvedBy || '',
    agentName: (item.Assignedto && item.Assignedto.DisplayName) || item.agentName || '',
    agentEmail: (item.Assignedto && item.Assignedto.Email) || item.agentEmail || ''
  };
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
    var parsed;
    try { parsed = JSON.parse(raw); } catch(e) { parsed = []; }

    // Accept: array of items, or {tickets:[...]}, or {value:[...]} (SharePoint format)
    var items = Array.isArray(parsed) ? parsed
      : (parsed.tickets ? parsed.tickets
      : (parsed.value ? parsed.value : []));

    var tickets = items.map(mapItem).filter(function(t) { return t.id && t.id !== 'tk_'; });

    if (!tickets.length) {
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, store: blobKey, count: 0, warning: 'Empty array received' }) };
    }

    var payload = JSON.stringify({ tickets: tickets, count: tickets.length, cachedAt: new Date().toISOString(), source: store });

    var res = await httpsReq('PUT',
      'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + blobKey,
      { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json' },
      payload
    );

    if (res.status >= 300) {
      return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Blob write failed: HTTP ' + res.status }) };
    }

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, store: blobKey, count: tickets.length }) };
  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: e.message }) };
  }
};
