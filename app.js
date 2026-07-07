const els = {
  btnOpenSignalModal: document.getElementById('btnOpenSignalModal'),
  signalModal: document.getElementById('signalModal'),
  btnCloseSignalModal: document.getElementById('btnCloseSignalModal'),
  rawInput: document.getElementById('rawInput'),
  btnParse: document.getElementById('btnParse'),
  parseResult: document.getElementById('parseResult'),

  btnRefresh: document.getElementById('btnRefresh'),
  signalsGrid: document.getElementById('signalsGrid'),
  signalCount: document.getElementById('signalCount'),
  emptyState: document.getElementById('emptyState'),
  filterHalal: document.getElementById('filterHalal'),

  btnManageIssi: document.getElementById('btnManageIssi'),
  issiModal: document.getElementById('issiModal'),
  btnCloseIssiModal: document.getElementById('btnCloseIssiModal'),
  issiInput: document.getElementById('issiInput'),
  btnSaveIssi: document.getElementById('btnSaveIssi'),
  issiStatus: document.getElementById('issiStatus'),
};

let currentSignals = [];
let currentFilter = 'halal'; // default tetap halal, tapi bisa diganti buat riset
let issiListEmpty = false;

const ADMIN_KEY_STORAGE = 'idx_issi_admin_key';

// --- Admin key: diminta sekali lewat prompt, disimpan di localStorage browser ini ---
function getAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
}
function ensureAdminKey() {
  let key = getAdminKey();
  if (!key) {
    key = window.prompt('Masukkan admin key (sekali saja, akan disimpan di browser ini):') || '';
    if (key) localStorage.setItem(ADMIN_KEY_STORAGE, key);
  }
  return key;
}

// --- Modal generik: buka/tutup + klik di luar + tombol Esc ---
function openModal(modalEl) {
  modalEl.hidden = false;
}
function closeModal(modalEl) {
  modalEl.hidden = true;
}
[els.signalModal, els.issiModal].forEach((modalEl) => {
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal(modalEl); // klik area gelap di luar kartu modal
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.signalModal.hidden) closeModal(els.signalModal);
  if (!els.issiModal.hidden) closeModal(els.issiModal);
});

// --- Rendering kartu sinyal ---

function formatRupiah(n) {
  if (n === null || n === undefined) return '-';
  return 'Rp' + n.toLocaleString('id-ID');
}

function pctClass(pct) {
  if (!pct) return '';
  return pct.trim().startsWith('-') ? 'pct-neg' : 'pct-pos';
}

function formatTimestamp(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Makassar',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WITA';
}

function bandarColor(bandarmology) {
  const label = bandarmology?.sinyalBandar?.label?.toUpperCase();
  if (label === 'BUY') return 'var(--accent-halal)';
  if (label === 'SELL') return 'var(--accent-red)';
  return 'var(--accent-neutral)';
}

function renderCard(signal) {
  const barColor = bandarColor(signal.bandarmology);
  const halalBadge = signal.isHalal
    ? '<span class="badge-halal">HALAL</span>'
    : '<span class="badge-nonhalal">NON-HALAL</span>';

  const confidenceText = signal.confidence
    ? `${signal.confidence.emoji} ${signal.confidence.score}/10 · ${signal.confidence.label}`
    : 'belum ada skor';

  const bandarText = signal.bandarmology?.status
    ? signal.bandarmology.status
    : signal.bandarmology?.sinyalBandar
    ? `${signal.bandarmology.sinyalBandar.emoji} ${signal.bandarmology.sinyalBandar.label} · net ${signal.bandarmology.smartMoneyNet || '-'} lot`
    : 'data bandarmology tidak tersedia';

  const detailId = `detail-${signal.id}`;

  const technicalRows = signal.technical
    ? Object.entries(signal.technical)
        .map(([key, val]) => {
          if (key === 'bb') return `<div><dt>BB</dt> Rp${val.lower?.toLocaleString('id-ID')} - Rp${val.upper?.toLocaleString('id-ID')}</div>`;
          if (key === 'atr') return `<div><dt>ATR</dt> Rp${val?.toLocaleString('id-ID')}</div>`;
          if (val && typeof val === 'object') {
            const parts = Object.entries(val)
              .filter(([k]) => !['emoji'].includes(k))
              .map(([k, v]) => `${k}: ${v ?? '-'}`)
              .join(' · ');
            return `<div><dt>${key.toUpperCase()}</dt> ${parts}</div>`;
          }
          return '';
        })
        .join('')
    : '<div>Tidak ada data teknikal</div>';

  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--bar-color', barColor);
  card.innerHTML = `
    <div class="card__head">
      <div class="card__ticker">
        <a href="https://stockbit.com/symbol/${signal.ticker}/chartbit" target="_blank" rel="noopener noreferrer" class="card__ticker-link">${signal.ticker}</a>
        ${halalBadge}
      </div>
      <div class="card__meta">
        <div class="card__confidence">${confidenceText}</div>
        <div class="card__timestamp">${formatTimestamp(signal.signalTimestamp)}</div>
      </div>
    </div>
    <div class="card__prices">
      <div class="price-block">
        <div class="price-block__label">Entry</div>
        <div class="price-block__value">${formatRupiah(signal.entryPrice)}</div>
      </div>
      <div class="price-block">
        <div class="price-block__label">TP1</div>
        <div class="price-block__value">${formatRupiah(signal.tp1?.price)}</div>
        <div class="price-block__pct ${pctClass(signal.tp1?.pct)}">${signal.tp1?.pct || '-'}</div>
      </div>
      <div class="price-block">
        <div class="price-block__label">SL Default</div>
        <div class="price-block__value">${formatRupiah(signal.stopLoss?.default?.price)}</div>
        <div class="price-block__pct ${pctClass(signal.stopLoss?.default?.pct)}">${signal.stopLoss?.default?.pct || '-'}</div>
      </div>
    </div>
    <div class="card__bandar">
      <span>${bandarText}</span>
      <button class="card__toggle" data-target="${detailId}">Detail</button>
    </div>
    <dl class="card__detail" id="${detailId}" hidden>
      ${technicalRows}
      ${signal.pattern ? `<div><dt>Chart</dt> ${signal.pattern.chart || '-'}</div><div><dt>Candle</dt> ${signal.pattern.candle || '-'}</div>` : ''}
      ${signal.confidence?.reasons?.length ? `<div><dt>Alasan Skor</dt> ${signal.confidence.reasons.map((r) => `${r.delta > 0 ? '+' : ''}${r.delta} ${r.reason}`).join(', ')}</div>` : ''}
      ${signal.analystOpinion ? `<div><dt>Analisis</dt> ${signal.analystOpinion}</div>` : ''}
      ${signal.news?.length ? `<div><dt>Berita</dt> ${signal.news.join(' · ')}</div>` : ''}
    </dl>
  `;
  card.querySelector('.card__toggle').addEventListener('click', (e) => {
    const target = document.getElementById(e.target.dataset.target);
    target.hidden = !target.hidden;
    e.target.textContent = target.hidden ? 'Detail' : 'Tutup';
  });
  return card;
}

// Default tampilan: halal saja (fokus workflow harian). Tapi tetap bisa switch
// ke "Non-halal" atau "Semua" untuk keperluan riset/analisis dataset - semua
// sinyal (halal maupun non-halal) selalu tersimpan di Firestore ("never throw
// away data"), filter ini cuma soal apa yang ditampilkan di grid.
function renderSignals() {
  const filtered = currentSignals.filter((s) => {
    if (currentFilter === 'halal') return s.isHalal;
    if (currentFilter === 'non-halal') return !s.isHalal;
    return true; // 'all'
  });

  els.signalsGrid.innerHTML = '';
  filtered.forEach((s) => els.signalsGrid.appendChild(renderCard(s)));

  let countText = `${filtered.length} sinyal`;
  if (issiListEmpty && currentSignals.length > 0) {
    countText += ' — ⚠️ daftar ISSI belum diisi, semua status default NON-HALAL';
  }
  els.signalCount.textContent = countText;
  els.emptyState.hidden = filtered.length > 0;
}

async function loadSignals() {
  const res = await fetch('/api/signals');
  const data = await res.json();
  currentSignals = data.signals || [];
  renderSignals();
}

// --- Hasil parse ditampilkan transien di dalam modal (termasuk yang non-halal) ---
function renderParseResult(savedSignals) {
  els.parseResult.innerHTML = savedSignals
    .map((s) => {
      const badge = s.isHalal
        ? '<span class="badge-halal">HALAL</span>'
        : '<span class="badge-nonhalal">NON-HALAL</span>';
      return `<div class="parse-result__item"><span class="parse-result__ticker">${s.ticker}</span>${badge}</div>`;
    })
    .join('');
}

// --- Event: buka/tutup modal Tempel Sinyal ---
els.btnOpenSignalModal.addEventListener('click', () => {
  els.parseResult.innerHTML = '';
  openModal(els.signalModal);
});
els.btnCloseSignalModal.addEventListener('click', () => closeModal(els.signalModal));

els.btnParse.addEventListener('click', async () => {
  const rawText = els.rawInput.value.trim();
  if (!rawText) return;
  const adminKey = ensureAdminKey();
  if (!adminKey) return;
  els.btnParse.disabled = true;
  els.parseResult.innerHTML = '<span class="modal__status">Memproses...</span>';
  try {
    const res = await fetch('/api/parse-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ rawText }),
    });
    const data = await res.json();
    if (res.status === 401) {
      localStorage.removeItem(ADMIN_KEY_STORAGE);
      throw new Error('Admin key salah, coba lagi (akan diminta ulang).');
    }
    if (!res.ok) throw new Error(data.error || 'Gagal parsing');
    issiListEmpty = !!data.issiListEmpty;
    renderParseResult(data.saved);
    els.rawInput.value = '';
    await loadSignals();
  } catch (err) {
    els.parseResult.innerHTML = `<span class="modal__status">Error: ${err.message}</span>`;
  } finally {
    els.btnParse.disabled = false;
  }
});

els.btnRefresh.addEventListener('click', loadSignals);

els.filterHalal.addEventListener('click', (e) => {
  if (!e.target.dataset.filter) return;
  currentFilter = e.target.dataset.filter;
  [...els.filterHalal.children].forEach((c) => c.classList.remove('filter-chip--active'));
  e.target.classList.add('filter-chip--active');
  renderSignals();
});

// --- Event: buka/tutup modal Kelola ISSI ---
els.btnManageIssi.addEventListener('click', async () => {
  openModal(els.issiModal);
  const res = await fetch('/api/issi-list');
  const data = await res.json();
  els.issiInput.value = (data.tickers || []).join('\n');
});
els.btnCloseIssiModal.addEventListener('click', () => closeModal(els.issiModal));

els.btnSaveIssi.addEventListener('click', async () => {
  const adminKey = ensureAdminKey();
  if (!adminKey) return;
  const tickers = els.issiInput.value.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
  els.issiStatus.textContent = 'Menyimpan...';
  try {
    const res = await fetch('/api/issi-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ tickers }),
    });
    const data = await res.json();
    if (res.status === 401) {
      localStorage.removeItem(ADMIN_KEY_STORAGE);
      throw new Error('Admin key salah, coba lagi (akan diminta ulang).');
    }
    if (!res.ok) throw new Error(data.error);
    issiListEmpty = data.tickers.length === 0;
    els.issiStatus.textContent = `Tersimpan: ${data.tickers.length} ticker.`;
    await loadSignals();
  } catch (err) {
    els.issiStatus.textContent = `Error: ${err.message}`;
  }
});

loadSignals();
