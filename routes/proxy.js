'use strict';
const https   = require('https');
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function proxyGet(url, headers, res) {
  https.get(url, { headers }, apiRes => {
    console.log(`${apiRes.statusCode} ${url}`);
    res.status(apiRes.statusCode).setHeader('Content-Type', 'application/json');
    apiRes.pipe(res);
  }).on('error', err => {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).json({ error: err.message });
  });
}

router.get('/archidekt/collection/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { page = 1, pageSize = 100 } = req.query;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid collection ID' });
  proxyGet(`https://archidekt.com/api/collection/${id}/?page=${page}&pageSize=${pageSize}`,
    { 'User-Agent': 'MTGCollectionSearch/1.0' }, res);
});

router.get('/moxfield/collection/:slug/cards', requireAuth, (req, res) => {
  const { slug } = req.params;
  const { pageNumber = 1, pageSize = 100 } = req.query;
  if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid collection slug' });
  proxyGet(
    `https://api2.moxfield.com/v2/collection/${slug}/cards?pageNumber=${pageNumber}&pageSize=${pageSize}`,
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://moxfield.com/',
      'Origin': 'https://moxfield.com',
    },
    res
  );
});

router.get('/archidekt/deck/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid deck ID' });
  proxyGet(`https://archidekt.com/api/decks/${id}/`, { 'User-Agent': 'MTGCollectionSearch/1.0' }, res);
});

// Legacy redirect
router.get('/collection/:id', requireAuth, (req, res) =>
  res.redirect(`/api/archidekt/collection/${req.params.id}?${new URLSearchParams(req.query)}`));

module.exports = router;
