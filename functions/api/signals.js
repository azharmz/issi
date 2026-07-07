import { listSignals } from '../lib/firestore.js';

/**
 * GET /api/signals
 * Response: { signals: [...] } - 50 sinyal terbaru, urut dari yang paling baru
 */
async function onRequestGet(context) {
  try {
    const signals = await listSignals(context.env, 50);
    return new Response(JSON.stringify({ signals }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal mengambil daftar sinyal' }), {
      status: 500,
    });
  }
}

export { onRequestGet };