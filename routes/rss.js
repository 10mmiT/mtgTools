'use strict';
const https   = require('https');
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router   = express.Router();
const RSS_FEEDS = (process.env.RSS_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
const rssCache = new Map(); // url -> { data, fetchedAt }
const RSS_TTL  = 10 * 60 * 1000;

function fetchRssUrl(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 4) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'MTGTools/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchRssUrl(res.headers.location, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; if (buf.length > 2_000_000) req.destroy(); });
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
    items.push({ title: iTitle, link: iLink.trim(), date: iDate.trim(), description: iDesc });
  }
  return { title, url, items };
}

router.get('/rss', requireAuth, async (req, res) => {
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
});

module.exports = router;
