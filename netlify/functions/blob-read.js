// netlify/functions/blob-read.js
// Uses Netlify Blobs REST API directly — no npm package needed
// GET /.netlify/functions/blob-read?x-app-token=ekedp-blob-2026
// Optional: ?meta=true for lightweight freshness check

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, error: "Method not allowed" }) };

  const params = event.queryStringParameters || {};
  if (params["x-app-token"] !== "ekedp-blob-2026") return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: "Unauthorized" }) };

  // Build month key e.g. "2026-06" in WAT (UTC+1)
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;

  if (!siteId || !token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: "Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN env vars" }) };
  }

  const key = params["meta"] === "true" ? `${monthKey}-meta` : monthKey;

  try {
    const res = await fetch(
      `https://api.netlify.com/api/v1/blobs/${siteId}/ekedp-mobile-tickets/${key}`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );

    if (res.status === 404) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ success: false, error: `No tickets in blob for ${monthKey} — run a PA pull first` }) };
    }

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: `Netlify API error: ${res.status} ${errText}` }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, ...data }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
