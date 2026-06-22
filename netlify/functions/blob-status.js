// netlify/functions/blob-status.js
// Returns ticket data from Netlify Blobs — called by the frontend Sync screen
// Accepts GET or POST
// Auth: x-app-token header OR query param = ekedp-blob-2026

const https = require('https');

function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

exports.handler = async function (event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // Auth — accept token from header or query param
  const qs = event.queryStringParameters || {};
  const headers = event.headers || {};
  const token = headers['x-app-token'] || headers['X-App-Token'] || qs['x-app-token'] || qs['token'] || '';
  if (token !== 'ekedp-blob-2026') {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  const netlifyToken = process.env.NETLIFY_API_TOKEN || '';
  if (!netlifyToken) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set' }) };
  }

  // Build month key e.g. "2026-06" in WAT (UTC+1)
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  try {
    // Fetch blob metadata from Netlify REST API
    const metaRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.netlify.com',
        path: `/api/v1/blobs/${siteId}/ekedp-mobile-tickets/${monthKey}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${netlifyToken}` }
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });

    if (metaRes.status === 404) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ cached: false, message: `No tickets in blob for ${monthKey} — run a PA pull first` })
      };
    }

    if (metaRes.status !== 200) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: `Netlify API error: ${metaRes.status}` })
      };
    }

    // Parse and return
    let data;
    try { data = JSON.parse(metaRes.body); } catch (e) { data = null; }

    if (!data) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not parse blob data' }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        cached: true,
        success: true,
        count: data.count || (Array.isArray(data.tickets) ? data.tickets.length : 0),
        updatedAt: data.updatedAt || 'unknown',
        month: monthKey,
        tickets: data.tickets || []
      })
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Status check failed: ' + e.message }) };
  }
};
