// ── Scryfall image cache ──────────────────────────────────────────────────
// name → direct CDN URL (normal) or null
const scryfallCache    = new Map();
// name → art_crop URL or null
const scryfallArtCache = new Map();

async function ensureScryfallImages(names) {
  const missing = names.filter(n => !scryfallCache.has(n));
  if (!missing.length) return;

  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: batch.map(name => ({ name })) }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const card of (data.data || [])) {
          const face = card.card_faces?.[0];
          scryfallCache.set(card.name,
            card.image_uris?.normal    || face?.image_uris?.normal    || null);
          scryfallArtCache.set(card.name,
            card.image_uris?.art_crop  || face?.image_uris?.art_crop  || null);
        }
      }
    } catch {}
    // Mark any still-missing names so we don't retry them
    for (const name of batch) {
      if (!scryfallCache.has(name)) scryfallCache.set(name, null);
    }
    // Brief pause between batches to stay within Scryfall rate limits
    if (i + 75 < missing.length) await new Promise(r => setTimeout(r, 100));
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
