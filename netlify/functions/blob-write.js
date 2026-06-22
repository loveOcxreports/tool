// netlify/functions/blob-write.js
// Receives ticketsArray from Power Automate and saves to Netlify Blobs
// Saves under month key e.g. "2026-06" so frontend can read by month
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

  try {
    const store = getStore("ekedp-mobile-tickets");

    // Build month key from current WAT date e.g. "2026-06"
    const now = new Date();
    // WAT = UTC+1
    const watOffset = 60 * 60 * 1000;
    const watDate = new Date(now.getTime() + watOffset);
    const year = watDate.getUTCFullYear();
    const month = String(watDate.getUTCMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`; // e.g. "2026-06"

    const payload = {
      updatedAt: new Date().toISOString(),
      count: tickets.length,
      tickets,
    };

    // Save under month key — this is what the frontend reads
    await store.setJSON(monthKey, payload);

    // Also save meta for quick freshness check
    await store.setJSON(`${monthKey}-meta`, {
      updatedAt: payload.updatedAt,
      count: tickets.length,
    });

    console.log(`[blob-write] Wrote ${tickets.length} tickets under key "${monthKey}" at ${payload.updatedAt}`);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, written: tickets.length, key: monthKey, updatedAt: payload.updatedAt }),
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
