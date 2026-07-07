// Parser untuk pesan "IHSG Regime Prediction" - prediksi arah pasar harian.
// Beda sama sekali dari sinyal saham; ini konteks makro yang jadi dasar warning
// "Pasar Sedang Lemah" dkk yang muncul di sinyal WATCHLIST.

const REGIME_DELIMITER_RE = /🌍 IHSG Regime Prediction — (\d{1,2} \w{3} \d{4})/g;

const MONTH_ID = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, agu: 8, sep: 9, okt: 10, nov: 11, des: 12,
};

function toNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

function dateIdToIso(dateStr) {
  const m = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return null;
  const [, dd, monStr, yyyy] = m;
  const mm = MONTH_ID[monStr.toLowerCase()];
  if (!mm) return null;
  // Pesan regime dikirim pagi hari (biasanya ~09:30 WIB) - simpan sebagai tanggal
  // saja (00:00 UTC) karena yang penting representasi harinya, bukan jam presisnya.
  return new Date(Date.UTC(Number(yyyy), mm - 1, Number(dd))).toISOString();
}

/**
 * Parse baris-baris list bergaya "  🔴 EIDO (IDX ETF): -0.59% (32%)" atau
 * "  🟢 S&P 500: +1.18%" (tanpa bobot). Berhenti di baris kosong/header berikutnya.
 */
function parseIndexLines(block, headerText, stopHeaders) {
  const lines = block.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(headerText));
  if (startIdx === -1) return [];
  const result = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break;
    if (stopHeaders.some((h) => line.includes(h))) break;
    const m = line.match(/^[^\wA-Za-z]*\s*([\w&./() -]+?):\s*([+-][\d.]+)%(?:\s*\((\d+)%\))?/);
    if (!m) break;
    result.push({
      name: m[1].trim(),
      pct: toNumber(m[2]),
      weightPct: m[3] ? toNumber(m[3]) : null,
    });
  }
  return result;
}

function parseTickerList(block, headerText) {
  const lines = block.split('\n');
  const line = lines.find((l) => l.includes(headerText));
  if (!line) return [];
  const afterHeader = line.slice(line.indexOf(headerText) + headerText.length);
  return afterHeader.split(',').map((t) => t.trim()).filter(Boolean);
}

function parseOneRegime(block, dateStr) {
  const prediksi = block.match(/Prediksi:\s*(\w+)\s*\(Score:\s*([+-][\d.]+)\)\s*(\S+)/);

  const suspended = parseTickerList(block, 'SUSPENDED:');
  const uma = parseTickerList(block, 'UMA (Unusual Market Activity):');
  const summary = block.match(/💬\s*(.+)/);

  return {
    date: dateIdToIso(dateStr),
    prediction: prediksi ? prediksi[1] : null,
    score: prediksi ? toNumber(prediksi[2]) : null,
    strengthEmoji: prediksi ? prediksi[3] : null,
    indexScoring: parseIndexLines(block, 'Indeks Scoring', ['Wall Street', 'Komoditas']),
    wallStreet: parseIndexLines(block, 'Wall Street', ['Komoditas', 'Peringatan']),
    komoditas: parseIndexLines(block, 'Komoditas', ['Peringatan', '💬']),
    suspended,
    uma,
    summary: summary ? summary[1].trim() : null,
    rawText: block.trim(),
  };
}

/**
 * Entry point: terima teks mentah (bisa berisi beberapa pesan regime sekaligus),
 * kembalikan array of parsed regime objects.
 */
function parseMarketRegime(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const matches = [...rawText.matchAll(REGIME_DELIMITER_RE)];
  const results = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const blockStart = m.index + m[0].length;
    const blockEnd = i + 1 < matches.length ? matches[i + 1].index : rawText.length;
    const block = rawText.slice(blockStart, blockEnd);
    results.push(parseOneRegime(block, m[1]));
  }
  return results;
}

export { parseMarketRegime, parseOneRegime };