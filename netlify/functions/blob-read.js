// netlify/functions/blob-read.js
// Returns the full ticket array saved by blob-write
// Called by: GET /.netlify/functions/blob-read?x-app-token=ekedp-blob-2026
// Optional: ?meta=true  →  returns only { updatedAt, count } for freshness check

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  // Token check
  const params = event.queryStringParameters || {};
  if (params["x-app-token"] !== "ekedp-blob-2026") {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: "Unauthorized" }) };
  }

  try {
    const store = getStore("ekedp-mobile-tickets");

    // ?meta=true → return lightweight metadata only (for polling)
    if (params["meta"] === "true") {
      const meta = await store.get("allmonth-meta", { type: "json" });
      if (!meta) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ success: false, error: "No data yet" }) };
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, ...meta }) };
    }

    // Full data
    const data = await store.get("allmonth", { type: "json" });
    if (!data) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ success: false, error: "No data yet. Run the Power Automate flow first." }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, updatedAt: data.updatedAt, count: data.count, tickets: data.tickets }),
    };
  } catch (e) {
    console.error("[blob-read] Error:", e.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
