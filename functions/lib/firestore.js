// Firestore REST API murni pakai fetch() - TANPA npm package apapun.
// Auth pakai Service Account (JWT ditandatangani via Web Crypto, native di
// Cloudflare Workers/Pages Functions, jadi nggak perlu install apa-apa).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(input) {
  const b64 = typeof input === 'string' ? btoa(input) : btoa(String.fromCharCode(...new Uint8Array(input)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken = null; // { token, expiresAt } - reuse antar-request selama masih hidup di isolate yang sama

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Gagal ambil access token Google: ' + JSON.stringify(data));

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function docsUrl(env, path = '') {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}`;
}

// --- Konversi JS value <-> Firestore REST "Value" format ---

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: toFirestoreFields(val) } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return parseInt(value.integerValue, 10);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

// --- API tingkat tinggi yang dipakai oleh functions/api/*.js ---

async function getIssiTickers(env) {
  const token = await getAccessToken(env);
  const res = await fetch(docsUrl(env, '/config/issi_list'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return [];
  const data = await res.json();
  if (!data.fields) return [];
  return fromFirestoreValue(data.fields.tickers) || [];
}

async function setIssiTickers(env, tickers) {
  const token = await getAccessToken(env);
  const body = {
    fields: toFirestoreFields({ tickers, updated_at: new Date().toISOString() }),
  };
  const res = await fetch(docsUrl(env, '/config/issi_list'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gagal menyimpan daftar ISSI: ' + (await res.text()));
}

async function saveSignals(env, signals) {
  const token = await getAccessToken(env); // ambil token sekali, dipakai bareng semua request paralel
  const results = await Promise.all(
    signals.map(async (s) => {
      const payload = { ...s, created_at: new Date().toISOString() };
      const res = await fetch(docsUrl(env, '/signals'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFirestoreFields(payload) }),
      });
      if (!res.ok) throw new Error('Gagal menyimpan sinyal: ' + (await res.text()));
      const data = await res.json();
      const id = data.name.split('/').pop();
      return { id, ...payload };
    })
  );
  return results;
}

async function listSignals(env, max = 50) {
  const token = await getAccessToken(env);
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'signals' }],
      orderBy: [{ field: { fieldPath: 'signalTimestamp' }, direction: 'DESCENDING' }],
      limit: max,
    },
  };
  const res = await fetch(docsUrl(env, ':runQuery'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gagal mengambil daftar sinyal: ' + (await res.text()));
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields || {}) }));
}

export { getIssiTickers, setIssiTickers, saveSignals, listSignals };
