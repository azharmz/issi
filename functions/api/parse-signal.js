import { parseSignals } from '../lib/parser.js';
import { getIssiTickers, saveSignals } from '../lib/firestore.js';

const MAX_SIGNALS_PER_REQUEST = 30;

/**
 * POST /api/parse-signal
 * Header wajib: x-admin-key (harus cocok dengan env.ADMIN_KEY)
 * Body: { rawText: string }
 * Response: { saved: [...parsed signals dengan status halal & id firestore] }
 */
async function onRequestPost(context) {
  const providedKey = context.request.headers.get('x-admin-key');
  if (!context.env.ADMIN_KEY || providedKey !== context.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { rawText } = await context.request.json();
    if (!rawText || typeof rawText !== 'string') {
      return new Response(JSON.stringify({ error: 'rawText wajib diisi' }), { status: 400 });
    }

    const parsed = parseSignals(rawText);
    if (parsed.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Tidak ada sinyal valid terdeteksi. Cek format paste-annya.' }),
        { status: 422 }
      );
    }
    if (parsed.length > MAX_SIGNALS_PER_REQUEST) {
      return new Response(
        JSON.stringify({ error: `Maksimal ${MAX_SIGNALS_PER_REQUEST} sinyal per paste, terdeteksi ${parsed.length}.` }),
        { status: 413 }
      );
    }

    const issiTickers = await getIssiTickers(context.env);
    const issiSet = new Set(issiTickers.map((t) => t.toUpperCase()));

    const withHalalFlag = parsed.map((s) => ({
      ...s,
      isHalal: issiSet.has(s.ticker.toUpperCase()),
    }));

    const saved = await saveSignals(context.env, withHalalFlag);

    return new Response(JSON.stringify({ saved, issiListEmpty: issiTickers.length === 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal parsing/menyimpan sinyal' }), {
      status: 500,
    });
  }
}

export { onRequestPost };