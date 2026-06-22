// netlify/functions/blob-write.js
// Uses Netlify Blobs REST API directly — no npm package needed
// POST /.netlify/functions/blob-write?x-app-token=ekedp-blob-2026
// Body: JSON array of ticket objects

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, error: "Method not allowed" }) };

  const appToken = (event.queryStringParameters || {})["x-app-token"];
  if (appToken !== "ekedp-blob-2026") return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: "Unauthorized" }) };

  let tickets;
  try {
    tickets = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: "Invalid JSON body" }) };
  }

  if (!Array.isArray(tickets)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: "Body must be a JSON array" }) };

  // Build month key e.g. "2026-06" in WAT (UTC+1)
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_API_TOKEN;

  if (!siteId || !token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: "Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN env vars" }) };
  }

  const payload = { updatedAt: new Date().toISOString(), count: tickets.length, tickets };

  try {
    // Write main blob under month key
    const res = await fetch(
      `https://api.netlify.com/api/v1/blobs/${siteId}/ekedp-mobile-tickets/${monthKey}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: `Netlify API error: ${res.status} ${errText}` }) };
    }

    // Write meta blob
    await fetch(
      `https://api.netlify.com/api/v1/blobs/${siteId}/ekedp-mobile-tickets/${monthKey}-meta`,
      {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt: payload.updatedAt, count: tickets.length }),
      }
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, written: tickets.length, key: monthKey, updatedAt: payload.updatedAt }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
