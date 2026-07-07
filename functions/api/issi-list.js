import { getIssiTickers, setIssiTickers } from '../lib/firestore.js';

/**
 * GET /api/issi-list -> { tickers: [...] }
 * POST /api/issi-list  Body: { tickers: ["BBCA","TLKM",...] } -> replace seluruh list
 */
async function onRequestGet(context) {
  try {
    const tickers = await getIssiTickers(context.env);
    return new Response(JSON.stringify({ tickers }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

async function onRequestPost(context) {
  const providedKey = context.request.headers.get('x-admin-key');
  if (!context.env.ADMIN_KEY || providedKey !== context.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { tickers } = await context.request.json();
    if (!Array.isArray(tickers)) {
      return new Response(JSON.stringify({ error: 'tickers harus berupa array' }), { status: 400 });
    }
    const cleaned = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
    await setIssiTickers(context.env, cleaned);
    return new Response(JSON.stringify({ tickers: cleaned }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export { onRequestGet, onRequestPost };