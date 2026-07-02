// ── Scryfall rate-limited fetch ───────────────────────────────────────────
// All live Scryfall calls are routed through OUR server's /api/scryfall/*
// proxy (routes/scryfall-proxy.js). Direct browser→Scryfall requests have two
// fatal problems: Scryfall's 429 responses carry no CORS headers (the browser
// can't read them, so we can't back off), and its per-IP limit is shared by
// every open tab / every player behind the same NAT — client-side pacing
// can't coordinate that. The proxy holds one central queue and honors
// Retry-After properly. This client queue remains as a light local pacer so
// a single tab doesn't flood our own server.
function _sfProxyUrl(url) {
  const m = String(url).match(/^https:\/\/api\.scryfall\.com\/(.+)$/);
  return m ? `/api/scryfall/${m[1]}` : url;
}
const SF_MIN_INTERVAL = 60; // ms between request starts (server queue is the real limiter)
const _sfQueue = [];
let _sfPumping  = false;
let _sfNextSlot = 0;

function scryfallFetch(url, opts) {
  return new Promise((resolve, reject) => {
    _sfQueue.push({ url, opts, resolve, reject });
    _sfPump();
  });
}

async function _sfPump() {
  if (_sfPumping) return;
  _sfPumping = true;
  while (_sfQueue.length) {
    const wait = _sfNextSlot - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _sfNextSlot = Date.now() + SF_MIN_INTERVAL;
    const job = _sfQueue.shift();
    try {
      const url = _sfProxyUrl(job.url);
      let res = await fetch(url, job.opts);
      if (res.status === 429) {
        // Proxy already waited out one Retry-After; if we still see 429 the
        // block is longer — pause locally before one more attempt.
        const ra    = parseInt(res.headers.get('Retry-After'), 10);
        const delay = Number.isFinite(ra) ? Math.min(ra, 65) * 1000 : 5000;
        console.warn(`[scryfall] rate-limited — pausing Scryfall requests ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        _sfNextSlot = Date.now() + SF_MIN_INTERVAL;
        res = await fetch(url, job.opts);
      }
      job.resolve(res);
    } catch (e) { job.reject(e); }
  }
  _sfPumping = false;
}

// ── Local-first card lookups ──────────────────────────────────────────────
// The server keeps a daily copy of Scryfall's bulk data (see scryfall-db.js)
// and serves it at /api/cards/*. These helpers hit the local endpoints first
// and only fall back to live Scryfall for names the local DB doesn't know
// (brand-new cards) or when the bulk download hasn't finished yet (503).

// Returns an array of Scryfall-shaped card objects for `names` (any length).
async function fetchCardCollection(names) {
  if (!names.length) return [];
  let cards = [];
  let remaining = names;

  try {
    const res = await fetch('/api/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    });
    if (res.ok) {
      const json = await res.json();
      cards     = json.data || [];
      remaining = json.not_found || [];
    }
  } catch {}

  // Fall back to live Scryfall for anything the local DB couldn't resolve
  for (let i = 0; i < remaining.length; i += 75) {
    const batch = remaining.slice(i, i + 75);
    try {
      // For double-faced cards ("A // B"), use only the front-face name as
      // the identifier — Scryfall returns the full oracle name in card.name.
      const res = await scryfallFetch('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(n => ({ name: n.split(' // ')[0] })) }),
      });
      if (res.ok) cards.push(...((await res.json()).data || []));
    } catch {}
  }
  return cards;
}

// Card-name autocomplete: local DB first, live Scryfall as fallback.
async function cardAutocomplete(q, { commander = false } = {}) {
  try {
    const res = await fetch(`/api/cards/autocomplete?q=${encodeURIComponent(q)}${commander ? '&commander=1' : ''}`);
    if (res.ok) return (await res.json()).data || [];
  } catch {}
  try {
    const res = await scryfallFetch(
      `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}${commander ? '+t:legendary+t:creature' : ''}`);
    return (await res.json()).data || [];
  } catch { return []; }
}

// ── Scryfall image cache ──────────────────────────────────────────────────
// name → direct CDN URL (normal) or null
const scryfallCache    = new Map();
// name → art_crop URL or null
const scryfallArtCache = new Map();
// name → { cmc, colors[], ci[], power, toughness, type, rarity, eur } for sorting
const scryfallMetaCache = new Map();

async function ensureScryfallImages(names) {
  const missing = names.filter(n => !scryfallCache.has(n));
  if (!missing.length) return;

  const cards = await fetchCardCollection(missing);
  for (const card of cards) {
    const face = card.card_faces?.[0];
    scryfallCache.set(card.name,
      card.image_uris?.normal    || face?.image_uris?.normal    || null);
    scryfallArtCache.set(card.name,
      card.image_uris?.art_crop  || face?.image_uris?.art_crop  || null);
    scryfallMetaCache.set(card.name, {
      cmc:       card.cmc,
      colors:    card.colors        || face?.colors        || [],
      ci:        card.color_identity || [],
      power:     card.power      ?? face?.power,
      toughness: card.toughness  ?? face?.toughness,
      type:      card.type_line  || face?.type_line || '',
      rarity:    card.rarity     || '',
      eur:       card.prices?.eur ? parseFloat(card.prices.eur) : null,
    });
  }
  // Mark any still-missing names so we don't retry them (both caches, so
  // metadata-driven sorts/columns don't keep re-requesting unresolved cards)
  for (const name of missing) {
    if (!scryfallCache.has(name))     scryfallCache.set(name, null);
    if (!scryfallMetaCache.has(name)) scryfallMetaCache.set(name, {});
  }
}

function sfCardOwnership(cardName) {
  return state.collections
    .filter(c => c.status === 'loaded' && c.cards.has(cardName))
    .map(c => {
      const q = c.cards.get(cardName).qty;
      return `<span class="sf-badge" style="border-color:${c.color}">
        <span class="sf-dot" style="background:${c.color}"></span>
        ${esc(c.name)} ×${q}
      </span>`;
    }).join('');
}
