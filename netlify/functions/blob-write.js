// netlify/functions/blob-write.js
// Accepts POST from PA — handles both pre-built tickets AND raw SharePoint items
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
  try { return new Date(isoStr).toLocaleString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }); } catch(e) { return ''; }
}

function mapStatus(v) {
  if (!v) return 'unresolved';
  var u = String(v).toUpperCase();
  if (u === 'RESOLVED') return 'resolved';
  if (u === 'IN PROGRESS') return 'progress';
  return 'unresolved';
}

function mapItem(item) {
  // Already formatted (has id starting with tk_)
  if (item.id && String(item.id).indexOf('tk_') === 0) return item;

  // Raw SharePoint — try every possible ID field name
  var id = item.ID || item.Id || item.id || item.iD || '';
  // Also try OData id which might be a URL
  if (!id && item['odata.id']) { var m = String(item['odata.id']).match(/\((\d+)\)/); if (m) id = m[1]; }
  if (!id) return null; // can't map without ID

  var appStatusField = item.APPStatus || item.appStatus || item.Appstatus || item.APPSTATUS || '';
  var appStatus = (appStatusField && typeof appStatusField === 'object') ? (appStatusField.Value || '') : appStatusField;

  var buField = item.BusinessUnit || item.businessUnit || item.bu || '';
  var bu = (buField && typeof buField === 'object') ? (buField.Value || '') : buField;

  var respField = item.Responsible_x0020_Party || item['Responsible Party'] || item.resp || '';
  var resp = (respField && typeof respField === 'object') ? (respField.Value || '') : respField;

  var assignedTo = item.Assignedto || item.AssignedTo || item.assignedTo || {};
  
  return {
    id: 'tk_' + id,
    num: String(id),
    created: item.Created || item.created || '',
    time: toWAT(item.Created || item.created || ''),
    name: item.CustomerName || item.customerName || item.name || '',
    phone: item.TelephoneNumber || item.telephoneNumber || item.phone || '',
    email: item.EmailAddress || item.emailAddress || item.email || '',
    meter: item.MeterNumber || item.meterNumber || item.meter || '',
    addr: item.CustomerAddress || item.customerAddress || item.addr || '',
    bu: bu,
    issue: item.ComplaintDescription || item.complaintDescription || item.issue || '',
    category: item.ComplaintCategory || item.complaintCategory || item.category || '',
    resp: resp,
    status: mapStatus(appStatus),
    appStatus: appStatus,
    note: item.ActionTaken || item.actionTaken || item.note || '',
    resolvedDate: item.ResolvedDate || item.resolvedDate || '',
    resolvedBy: item.Resolvedby || item.resolvedBy || '',
    agentName: (assignedTo && assignedTo.DisplayName) || item.agentName || '',
    agentEmail: (assignedTo && assignedTo.Email) || item.agentEmail || ''
  };
}

exports.handler = async function (event) {
  var CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-app-token, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  var netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  var siteId = '295cb737-81ef-436d-91e5-0def385f4b88';
  if (!netlifyToken) return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };

  var qs = event.queryStringParameters || {};
  var store = (qs.store || 'monthly').toLowerCase();
  var blobKey = store === 'daily' ? 'daily-tickets' : 'monthly-tickets';

  try {
    var raw = event.body || '[]';
    var parsed; try { parsed = JSON.parse(raw); } catch(e) { parsed = []; }
    var items = Array.isArray(parsed) ? parsed : (parsed.tickets ? parsed.tickets : (parsed.value ? parsed.value : []));

    // Capture first item keys for debug
    var sampleKeys = items.length > 0 ? Object.keys(items[0]).slice(0, 15) : [];
    var firstId = items.length > 0 ? (items[0].ID || items[0].Id || items[0].id || 'none') : 'none';

    var tickets = items.map(mapItem).filter(function(t) { return t && t.id && t.id !== 'tk_' && t.id !== 'tk_undefined' && t.id !== 'tk_null'; });

    if (!tickets.length) {
      return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: false, store: blobKey, count: 0, itemsReceived: items.length, sampleKeys: sampleKeys, firstId: firstId, warning: 'All items filtered out' }) };
    }

    var payload = JSON.stringify({ tickets: tickets, count: tickets.length, cachedAt: new Date().toISOString(), source: store });
    var res = await httpsReq('PUT', 'https://api.netlify.com/api/v1/sites/' + siteId + '/blobs/' + blobKey, { 'Authorization': 'Bearer ' + netlifyToken, 'Content-Type': 'application/json' }, payload);

    if (res.status >= 300) return { statusCode: 502, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: 'Blob write failed: HTTP ' + res.status }) };

    return { statusCode: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ ok: true, store: blobKey, count: tickets.length, itemsReceived: items.length, sampleKeys: sampleKeys, firstId: firstId }) };
  } catch (e) {
    return { statusCode: 500, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' }), body: JSON.stringify({ error: e.message }) };
  }
};
