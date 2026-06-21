// netlify/functions/blob-read.js
// Reads monthly tickets cached by the PA flow via Netlify Blob REST API.
// PA writes: PUT https://api.netlify.com/api/v1/sites/{siteId}/blobs/monthly-tickets
// This function reads the same blob and returns it to the app.
//
// Required env vars in Netlify site settings:
//   EK_BLOB_TOKEN      — your custom app secret (checked in x-app-token header)
//   NETLIFY_API_TOKEN  — the Netlify personal access token (same one used in PA)
//   NETLIFY_SITE_ID    — your Netlify site ID (optional, falls back to built-in)

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'x-app-token, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // ── App token check ───────────────────────────────────────────
  const token =
    (event.headers && (event.headers['x-app-token'] || event.headers['X-App-Token'])) ||
    (event.queryStringParameters && event.queryStringParameters.token) ||
    '';
  const expected = process.env.EK_BLOB_TOKEN || '';
  if (!expected || token !== expected) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized — check your token' }),
    };
  }

  // ── Read from same Netlify Blob the PA flow writes to ─────────
  const siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  const netlifyToken = process.env.NETLIFY_API_TOKEN || '';

  if (!netlifyToken) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set in Netlify env vars' }),
    };
  }

  let blobRes;
  try {
    blobRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/blobs/monthly-tickets`,
      { headers: { 'Authorization': `Bearer ${netlifyToken}` } }
    );
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Blob fetch failed: ' + e.message }),
    };
  }

  if (blobRes.status === 404) {
    return {
      statusCode: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first to populate the blob.' }),
    };
  }

  if (!blobRes.ok) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Netlify Blob error: HTTP ' + blobRes.status }),
    };
  }

  const data = await blobRes.json();

  // PA writes a raw array; normalise to {tickets, cachedAt} for the app
  const normalized = Array.isArray(data)
    ? { tickets: data, cachedAt: new Date().toISOString(), count: data.length }
    : data;

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  };
};
