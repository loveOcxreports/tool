// netlify/functions/blob-read.js
// Reads monthly tickets cached by the PA flow via Netlify Blob REST API.
// Netlify Blob API returns a signed S3 redirect URL — we follow it to get data.

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

  const siteId = process.env.NETLIFY_SITE_ID || '295cb737-81ef-436d-91e5-0def385f4b88';
  const netlifyToken = process.env.NETLIFY_API_TOKEN || '';

  if (!netlifyToken) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NETLIFY_API_TOKEN not set in Netlify env vars' }),
    };
  }

  try {
    // Step 1: Ask Netlify Blob API for the blob — returns {url: "signed-S3-url"}
    const metaRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/blobs/monthly-tickets`,
      { headers: { 'Authorization': `Bearer ${netlifyToken}` } }
    );

    if (metaRes.status === 404) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No cached data yet — run the PA pull flow first.' }),
      };
    }
    if (!metaRes.ok) {
      return {
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Netlify API error: HTTP ' + metaRes.status }),
      };
    }

    const meta = await metaRes.json();

    // Step 2: Follow the signed S3 URL to get the actual blob data
    let data;
    if (meta && meta.url) {
      const s3Res = await fetch(meta.url);
      if (!s3Res.ok) {
        return {
          statusCode: 502,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'S3 fetch error: HTTP ' + s3Res.status }),
        };
      }
      data = await s3Res.json();
    } else {
      // Already the data (some Netlify versions return directly)
      data = meta;
    }

    // Normalise: PA writes a raw array; wrap into {tickets, cachedAt}
    const normalized = Array.isArray(data)
      ? { tickets: data, cachedAt: new Date().toISOString(), count: data.length }
      : data;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Function error: ' + e.message }),
    };
  }
};
