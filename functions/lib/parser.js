// Parser untuk sinyal "Zeta IDX Signal" (bot Telegram) -> object terstruktur.
// Didesain toleran: field yang kadang hilang (Confidence Score, Bandarmology detail,
// label status RSI, dll) tidak boleh bikin parser gagal - fallback ke null.

const SIGNAL_DELIMITER = '🇮🇩 ZETA IDX STOCK SIGNAL 🇮🇩';

function toNumber(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^([+-]?[\d,.]+)\s*([KMkm])?$/);
  if (!m) {
    const n = parseFloat(String(str).replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
  }
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1_000;
  if (suffix === 'M') n *= 1_000_000;
  return n;
}

function matchOne(regex, text) {
  const m = text.match(regex);
  return m ? m : null;
}

/**
 * Konversi "DD/MM/YYYY" + "HH:MM" (asumsi WITA / UTC+8, sesuai jam device Telegram
 * desktop kamu) jadi ISO string UTC. Dipakai buat timestamp asli dari sinyal
 * (bukan jam parsing).
 */
function indoDateTimeToIso(dateStr, timeStr) {
  const [dd, mm, yyyy] = dateStr.split('/').map(Number);
  const [hh, min] = timeStr.split(':').map(Number);
  const utcMs = Date.UTC(yyyy, mm - 1, dd, hh - 8, min); // WITA -> UTC
  return new Date(utcMs).toISOString();
}

/**
 * Ambil daftar baris "top buyer/seller" broker setelah header tertentu,
 * berhenti begitu ketemu baris yang bukan format broker atau baris kosong/emoji lain.
 */
function parseBrokerLines(block, headerEmoji) {
  const lines = block.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(headerEmoji));
  if (startIdx === -1) return [];
  const result = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // Format A: "XX [TAG] (Nama Sekuritas): +N,NNN lot"
    // Format C (lebih lama): "XX (Nama Sekuritas): +N,NNN lot" - tanpa [TAG]
    const m = line.match(/^([A-Z]{2})\s*(?:\[([^\]]+)\])?\s*\(([^)]+)\):\s*\+?([\d,.]+[KMkm]?)\s*lot/);
    if (!m) break;
    result.push({
      code: m[1],
      tag: m[2] || null,
      broker: m[3],
      lot: toNumber(m[4]),
    });
  }
  return result;
}

function parseConfidence(block) {
  const lines = block.split('\n');
  const headerIdx = lines.findIndex((l) => l.includes('Confidence Score:'));
  if (headerIdx === -1) return null;

  const header = lines[headerIdx].match(/Confidence Score:\s*(\S+)\s*(\d+)\/10\s*\(([^)]+)\)/);
  if (!header) return null;
  const emoji = header[1];
  const score = toNumber(header[2]);
  const label = header[3].trim();

  // Baris alasan: "  +3 teks..." atau "  -1 teks..." tepat setelah baris header confidence
  const reasons = [];
  const reasonLineRe = /^\s*([+-]\d+)\s+(.+)$/;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') break;
    const m = lines[i].match(reasonLineRe);
    if (!m) break;
    reasons.push({ delta: parseInt(m[1], 10), reason: m[2].trim() });
  }

  return { emoji, score, label, reasons };
}

function parseTechnical(block) {
  const technical = {};

  const macd = block.match(/-\s*MACD:\s*([\d.-]+)\s*\(Sig:\s*([\d.-]+)\)\s*(\S+)?\s*(\w+)?/);
  if (macd) {
    technical.macd = { value: toNumber(macd[1]), signal: toNumber(macd[2]), emoji: macd[3] || null, status: macd[4] || null };
  }

  const rsi = block.match(/-\s*RSI\s*\(14\):\s*([\d.]+)\s*(\S+)?\s*(\w+)?/);
  if (rsi) {
    technical.rsi = { value: toNumber(rsi[1]), emoji: rsi[2] || null, status: rsi[3] || null };
  }

  const ema = block.match(/-\s*EMA 20\/50:\s*Rp([\d,]+)\s*\/\s*Rp([\d,]+)\s*(\S+)?\s*(\w+)?/);
  if (ema) {
    technical.ema = { ema20: toNumber(ema[1]), ema50: toNumber(ema[2]), emoji: ema[3] || null, status: ema[4] || null };
  }

  const vwap = block.match(/-\s*VWAP:\s*Rp([\d,]+)\s*(\S+)?\s*(\w+)?/);
  if (vwap) {
    technical.vwap = { value: toNumber(vwap[1]), emoji: vwap[2] || null, status: vwap[3] || null };
  }

  const adx = block.match(/-\s*ADX:\s*([\d.]+)\s*(\S+)?\s*(\w+)?/);
  if (adx) {
    technical.adx = { value: toNumber(adx[1]), emoji: adx[2] || null, status: adx[3] || null };
  }

  const bb = block.match(/-\s*BB:\s*\[Rp([\d,]+)\s*-\s*Rp([\d,]+)\]/);
  if (bb) {
    technical.bb = { lower: toNumber(bb[1]), upper: toNumber(bb[2]) };
  }

  const atr = block.match(/^-\s*ATR:\s*Rp([\d,]+)/m);
  if (atr) {
    technical.atr = toNumber(atr[1]);
  }

  return Object.keys(technical).length ? technical : null;
}

function parsePattern(block) {
  const section = block.match(/👁️ Pattern:\s*\n([\s\S]*?)(?=\n\n|🏦|$)/);
  if (!section) return null;
  const chart = section[1].match(/-\s*Chart:\s*(.+)/);
  const candle = section[1].match(/-\s*Candle:\s*(.+)/);
  return {
    chart: chart ? chart[1].trim() : null,
    candle: candle ? candle[1].trim() : null,
  };
}

function parseBandarmology(block) {
  const section = block.match(/🏦 Bandarmology(?:\s*\([^)]*\))?:\s*(.*)/);
  if (!section) return null;

  const firstLine = section[1].trim();
  // Kalau baris pertama langsung berisi teks (bukan kosong), berarti format status singkat
  // contoh: "Data sedang maintenance"
  if (firstLine && !firstLine.startsWith('Sinyal Bandar')) {
    return { status: firstLine, sinyalBandar: null, smartMoneyNet: null, topBuyer: [], topSeller: [] };
  }

  const sinyal = block.match(/Sinyal Bandar:\s*(\S+)\s*(\w+)/);
  const smartMoney = block.match(/Smart Money Net:\s*([+-]?[\d,.]+[KMkm]?)\s*lot/);

  return {
    status: null,
    sinyalBandar: sinyal ? { emoji: sinyal[1], label: sinyal[2] } : null,
    smartMoneyNet: smartMoney ? smartMoney[1] : null,
    topBuyer: parseBrokerLines(block, '🟢 Top Buyer'),
    topSeller: parseBrokerLines(block, '🔴 Top Seller'),
  };
}

function parseBetaVolatilitas(block) {
  const m = block.match(/Beta:\s*([\d.]+)\s*\(([^)]+)\)\s*\|\s*Volatilitas:\s*(\d+)%/);
  if (!m) return null;
  return { beta: toNumber(m[1]), betaLabel: m[2].trim(), volatilitasPct: toNumber(m[3]) };
}

function parseAnalystOpinion(block) {
  const m = block.match(/💡 Analyst Opinion:\s*\n([\s\S]*?)(?=\n\n📰|\n📰|$)/);
  return m ? m[1].trim() : null;
}

function parseNews(block) {
  const m = block.match(/📰 Berita Terkait:\s*\n([\s\S]*?)(?=\n🤖|$)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^•\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse satu block sinyal (sudah dipotong per-delimiter) jadi object terstruktur.
 */
function parseOneSignal(block, signalTimestamp) {
  const ticker = matchOne(/Saham:\s*(\S+)/, block);
  const signalLine = matchOne(/Signal:\s*(.+)/, block);
  if (!ticker || !signalLine) return null; // field wajib, kalau tidak ada berarti bukan block valid

  // "Signal: WATCHLIST" (format A, tanpa emoji) ATAU "Signal: 🟢 BUY" / "Signal: 👀 WATCHLIST"
  // (format B/C, ada emoji sebelum kata). Ambil token alfabet terakhir di baris itu.
  const signalWords = signalLine[1].match(/[A-Za-z_]+/g);
  const signalType = signalWords ? signalWords[signalWords.length - 1] : signalLine[1].trim();

  const entry = matchOne(/Entry Price:\s*Rp([\d,]+)/, block);

  // TP: format A punya "TP1: Rp.. (+X%)"; format B/C cuma "Take Profit: Rp.." tanpa %.
  let tp1 = matchOne(/TP1:\s*Rp([\d,]+)\s*\(([+-][\d.]+%)\)/, block);
  if (!tp1) {
    const tpFallback = matchOne(/Take Profit:\s*Rp([\d,]+)/, block);
    if (tpFallback) tp1 = [tpFallback[0], tpFallback[1], null];
  }

  // SL: format A punya 3-tier (Default/Moderat/Konservatif); format B/C cuma 1 angka "Stop Loss: Rp..".
  let slDefault = matchOne(/Default \(ATR\):\s*Rp([\d,]+)\s*\(([+-][\d.]+%)\)/, block);
  if (!slDefault) {
    const slFallback = matchOne(/Stop Loss:\s*Rp([\d,]+)/, block);
    if (slFallback) slDefault = [slFallback[0], slFallback[1], null];
  }
  const slModerat = matchOne(/Moderat \(-5%\):\s*Rp([\d,]+)/, block);
  const slKonservatif = matchOne(/Konservatif \(-3%\):\s*Rp([\d,]+)/, block);

  return {
    ticker: ticker[1],
    signalType,
    signalTimestamp, // dari header "[DD/MM/YYYY HH:MM]" kalau ada, kalau tidak fallback ke jam parsing
    confidence: parseConfidence(block),
    entryPrice: toNumber(entry?.[1]),
    tp1: tp1 ? { price: toNumber(tp1[1]), pct: tp1[2] } : null,
    stopLoss: {
      default: slDefault ? { price: toNumber(slDefault[1]), pct: slDefault[2] } : null,
      moderat: slModerat ? toNumber(slModerat[1]) : null,
      konservatif: slKonservatif ? toNumber(slKonservatif[1]) : null,
    },
    technical: parseTechnical(block),
    pattern: parsePattern(block),
    bandarmology: parseBandarmology(block),
    betaVolatilitas: parseBetaVolatilitas(block),
    analystOpinion: parseAnalystOpinion(block),
    news: parseNews(block),
    rawText: block.trim(),
  };
}

/**
 * Entry point: terima seluruh teks paste-an Telegram (bisa berisi banyak sinyal),
 * kembalikan array of parsed signal objects.
 *
 * Timestamp per-sinyal: kalau ada header "[DD/MM/YYYY HH:MM] Zeta IDX Signal:"
 * (format Telegram Desktop), dipakai sebagai signalTimestamp. Kalau nggak ada
 * (format Telegram Mobile, biasanya nggak nyertain jam per-pesan), fallback ke
 * jam saat parsing dilakukan ("jam posting").
 */
function parseSignals(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const now = new Date().toISOString();
  const headerRe = /(?:\[(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})\]\s*)?(?:Zeta IDX Signal:\s*)?🇮🇩 ZETA IDX STOCK SIGNAL 🇮🇩/g;

  const matches = [...rawText.matchAll(headerRe)];
  const results = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const blockStart = m.index + m[0].length;
    const blockEnd = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const block = rawText.slice(blockStart, blockEnd);

    const [, dateStr, timeStr] = m;
    const signalTimestamp = dateStr && timeStr ? indoDateTimeToIso(dateStr, timeStr) : now;

    const parsed = parseOneSignal(block, signalTimestamp);
    if (parsed) results.push(parsed);
  }
  return results;
}

export { parseSignals, parseOneSignal, SIGNAL_DELIMITER };