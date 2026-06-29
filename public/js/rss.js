// ── RSS Feed Panel ────────────────────────────────────────────────────────
let rssPanelOpen = false;

function toggleRssPanel() {
  rssPanelOpen = !rssPanelOpen;
  document.getElementById('rssPanel').classList.toggle('open', rssPanelOpen);
  document.getElementById('rssToggleBtn').classList.toggle('active', rssPanelOpen);
  document.getElementById('sidenavRssBtn')?.classList.toggle('rss-open', rssPanelOpen);
  if (rssPanelOpen) loadRss();
}

async function loadRss() {
  const el = document.getElementById('rssFeedList');
  el.innerHTML = '<div class="rss-status">Loading…</div>';
  try {
    const res = await fetch('/api/rss');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const feeds = await res.json();
    renderRss(feeds);
  } catch (e) {
    el.innerHTML = `<div class="rss-status rss-error">Failed to load: ${esc(e.message)}</div>`;
  }
}

function renderRss(feeds) {
  const el = document.getElementById('rssFeedList');
  if (!feeds.length) {
    el.innerHTML = `<div class="rss-status">No RSS feeds configured.<br>Add <code>RSS_FEEDS</code> to your docker-compose environment.</div>`;
    return;
  }

  // Flatten all items from all feeds, tag each with its feed, sort newest first
  const all = [];
  for (const feed of feeds) {
    if (feed.error) continue;
    for (const item of feed.items) {
      all.push({ ...item, feedTitle: feed.title, feedUrl: feed.url, _ts: new Date(item.date).getTime() || 0 });
    }
  }
  all.sort((a, b) => b._ts - a._ts);

  if (!all.length) {
    el.innerHTML = `<div class="rss-status">No items found.</div>`;
    return;
  }

  el.innerHTML = all.map(item => `
    <div class="rss-item">
      <div class="rss-item-meta">
        <span class="rss-feed-tag">${esc(item.feedTitle)}</span>
        ${item.date ? `<span class="rss-item-date">${rssRelativeDate(item.date)}</span>` : ''}
      </div>
      <a class="rss-item-title" href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.title)}</a>
      ${item.description ? `<div class="rss-item-desc">${esc(item.description)}</div>` : ''}
    </div>
  `).join('');
}

function rssRelativeDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const diff = Date.now() - d.getTime();
    if (diff < 60_000)       return 'just now';
    if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000)  return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
  } catch { return dateStr; }
}
