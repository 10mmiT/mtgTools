'use strict';
const https   = require('https');
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/async-handler');

const router   = express.Router();
const RSS_FEEDS = (process.env.RSS_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
const rssCache = new Map(); // url -> { data, fetchedAt }
const RSS_TTL  = 10 * 60 * 1000;
// The socket timeout below catches a feed that goes silent; this catches one
// that trickles. Each redirect hop gets its own.
const RSS_DEADLINE_MS = 30_000;

function fetchRssUrl(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 4) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: { 'User-Agent': 'MTGTools/1.0' },
      signal:  AbortSignal.timeout(RSS_DEADLINE_MS),
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchRssUrl(res.headers.location, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let buf = '';
      res.on('error', reject);
      res.setEncoding('utf8');
      res.on('data', c => {
        buf += c;
        if (buf.length > 2_000_000) {
          req.destroy();
          reject(new Error('Feed too large')); // destroy() alone never settles the promise
        }
      });
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function rssExtractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function rssStripHtml(s) {
  return s.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

// A feed's links end up as hrefs in the panel, so anything that is not a web
// page — javascript:, data:, a relative path — is dropped rather than linked.
function rssSafeLink(link) {
  try {
    const { protocol } = new URL(link);
    return protocol === 'http:' || protocol === 'https:' ? link : '';
  } catch { return ''; }
}

function parseRssFeed(xml, url) {
  const isAtom   = /<feed[\s>]/i.test(xml);
  const rawTitle = rssExtractTag(xml, 'title') || url;
  const title    = rssStripHtml(rawTitle);
  const itemTag  = isAtom ? 'entry' : 'item';
  const itemRe   = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, 'gi');
  const items    = [];
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 15) {
    const chunk  = m[1];
    const iTitle = rssStripHtml(rssExtractTag(chunk, 'title') || '(no title)');
    let   iLink  = '';
    if (isAtom) {
      iLink = (chunk.match(/<link[^>]+href="([^"]+)"/) || [])[1] || rssExtractTag(chunk, 'link');
    } else {
      iLink = rssExtractTag(chunk, 'link');
    }
    const iDate = rssExtractTag(chunk, isAtom ? 'updated' : 'pubDate') ||
                  rssExtractTag(chunk, 'published');
    const iDesc = rssStripHtml(
      rssExtractTag(chunk, isAtom ? 'summary' : 'description') ||
      rssExtractTag(chunk, 'content')
    ).slice(0, 220);
    items.push({ title: iTitle, link: rssSafeLink(iLink.trim()), date: iDate.trim(), description: iDesc });
  }
  return { title, url, items };
}

router.get('/rss', requireAuth, asyncHandler(async (req, res) => {
  if (!RSS_FEEDS.length) return res.json([]);
  const results = await Promise.all(RSS_FEEDS.map(async url => {
    const cached = rssCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < RSS_TTL) return cached.data;
    try {
      const xml  = await fetchRssUrl(url);
      const data = parseRssFeed(xml, url);
      rssCache.set(url, { data, fetchedAt: Date.now() });
      return data;
    } catch (e) {
      console.error(`[rss] ${url}: ${e.message}`);
      return { title: url, url, items: [], error: e.message };
    }
  }));
  res.json(results);
}));

module.exports = Object.assign(router, { parseRssFeed }); // parseRssFeed for tests
