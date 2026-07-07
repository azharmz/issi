// Parser untuk pesan KONFIRMASI dari Zeta IDX Signal (beda dari sinyal WATCHLIST awal).
// 3 jenis yang teramati sejauh ini:
//   - ongoing      : "📈 PROFIT TERUS NAIK! 📈"      -> posisi masih terbuka
//   - tp_hit        : "🏆 SIGNAL CONFIRMED — PROFIT! 🏆" -> kena TP tapi tracking lanjut
//   - closed        : "🔒 PROFIT TERKUNCI! 🔒"          -> posisi ditutup final
// Field "Call Watchlist" (timestamp sinyal asli) & "Durasi" baru muncul belakangan -
// dibuat optional supaya pesan lama (tanpa field ini) tetap ke-parse.

const CONFIRMATION_MARKERS = [
  { type: 'ongoing', marker: '📈 PROFIT TERUS NAIK! 📈' },
  { type: 'tp_hit', marker: '🏆 SIGNAL CONFIRMED — PROFIT! 🏆' },
  { type: 'closed', marker: '🔒 PROFIT TERKUNCI! 🔒' },
];

const MONTH_ID = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, agu: 8, sep: 9, okt: 10, nov: 11, des: 12,
};

function toNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse "7 Jul 2026, 13:14 WIB" -> ISO UTC string.
 * Label "WIB" ini ditulis eksplisit oleh bot (server-side label), BUKAN jam
 * lokal device penampil - jadi selalu WIB (UTC+7) apapun timezone user.
 */
function parseCallWatchlistTimestamp(str) {
  const m = str.match(/(\d{1,2})\s+(\w{3})\s+(\d{4}),\s*(\d{2}):(\d{2})\s*WIB/i);
  if (!m) return null;
  const [, dd, monStr, yyyy, hh, min] = m;
  const mm = MONTH_ID[monStr.toLowerCase()];
  if (!mm) return null;
  const utcMs = Date.UTC(Number(yyyy), mm - 1, Number(dd), Number(hh) - 7, Number(min));
  return new Date(utcMs).toISOString();
}

function parseOneConfirmation(block, type) {
  const symbol = block.match(/Symbol:\s*(\S+)/);
  if (!symbol) return null;

  const status = block.match(/Status:\s*(.+)/);
  const callWatchlistRaw = block.match(/Call Watchlist:\s*(.+)/);
  const durasi = block.match(/Durasi:\s*([^(]+)/);
  const peak = block.match(/Peak Tertinggi:\s*Rp([\d,]+)\s*\(([+-][\d.]+%)\)/);

  const base = {
    ticker: symbol[1],
    confirmationType: type,
    status: status ? status[1].trim() : null,
    callWatchlistTimestamp: callWatchlistRaw ? parseCallWatchlistTimestamp(callWatchlistRaw[1]) : null,
    durasi: durasi ? durasi[1].trim() : null,
    peak: peak ? { price: toNumber(peak[1]), pct: peak[2] } : null,
    rawText: block.trim(),
  };

  if (type === 'ongoing') {
    const entry = block.match(/Entry:\s*Rp([\d,]+)/);
    const profitSekarang = block.match(/Profit Sekarang:\s*([+-][\d.]+%)/);
    return { ...base, entryPrice: toNumber(entry?.[1]), exitPrice: null, profitPct: profitSekarang?.[1] || null };
  }

  if (type === 'tp_hit') {
    const entryTp = block.match(/Entry:\s*Rp([\d,]+)\s*→\s*TP1:\s*Rp([\d,]+)\s*\(([+-][\d.]+%)\)/);
    const profitTerkunci = block.match(/Profit Terkunci:\s*([+-][\d.]+%)/);
    return {
      ...base,
      entryPrice: toNumber(entryTp?.[1]),
      exitPrice: toNumber(entryTp?.[2]), // TP1 price, posisi masih tracking (belum benar2 exit)
      profitPct: entryTp?.[3] || profitTerkunci?.[1] || null,
    };
  }

  // type === 'closed'
  const entryExit = block.match(/Entry:\s*Rp([\d,]+)\s*→\s*Exit:\s*Rp([\d,]+)/);
  const profitTerkunci = block.match(/Profit Terkunci:\s*([+-][\d.]+%)/);
  return {
    ...base,
    entryPrice: toNumber(entryExit?.[1]),
    exitPrice: toNumber(entryExit?.[2]),
    profitPct: profitTerkunci?.[1] || null,
  };
}

/**
 * Entry point: terima teks mentah (bisa berisi campuran ke-3 jenis konfirmasi
 * sekaligus), kembalikan array of parsed confirmation objects.
 */
function parseConfirmations(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const markerPattern = CONFIRMATION_MARKERS.map((m) => m.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const headerRe = new RegExp(`(?:\\[(\\d{2}/\\d{2}/\\d{4}) (\\d{2}:\\d{2})\\]\\s*)?(?:Zeta IDX Signal:\\s*)?(${markerPattern})`, 'g');

  const matches = [...rawText.matchAll(headerRe)];
  const results = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const blockStart = m.index + m[0].length;
    const blockEnd = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const block = rawText.slice(blockStart, blockEnd);
    const matchedMarker = m[3];
    const type = CONFIRMATION_MARKERS.find((cm) => cm.marker === matchedMarker)?.type;
    if (!type) continue;

    const parsed = parseOneConfirmation(block, type);
    if (parsed) results.push(parsed);
  }
  return results;
}

export { parseConfirmations, parseOneConfirmation, CONFIRMATION_MARKERS };