// netlify/functions/blob-write.js
// Receives ticketsArray from Power Automate and saves to Netlify Blobs
// Called by: POST /.netlify/functions/blob-write?x-app-token=ekedp-blob-2026
// Body: JSON array of ticket objects (built by Power Automate)

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
  }

  // Token check
  const appToken = (event.queryStringParameters || {})["x-app-token"];
  if (appToken !== "ekedp-blob-2026") {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: "Unauthorized" }) };
  }

  // Parse body
  let tickets;
  try {
    tickets = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: "Invalid JSON body" }) };
  }

  if (!Array.isArray(tickets)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: "Body must be a JSON array" }) };
  }

  // Write to Netlify Blobs
  try {
    const store = getStore("ekedp-mobile-tickets");

    const payload = {
      updatedAt: new Date().toISOString(),
      count: tickets.length,
      tickets,
    };

    await store.setJSON("allmonth", payload);

    // Lightweight meta key — frontend can poll this cheaply to check freshness
    await store.setJSON("allmonth-meta", {
      updatedAt: payload.updatedAt,
      count: tickets.length,
    });

    console.log(`[blob-write] Wrote ${tickets.length} tickets at ${payload.updatedAt}`);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, written: tickets.length, updatedAt: payload.updatedAt }),
    };
  } catch (e) {
    console.error("[blob-write] Error:", e.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
