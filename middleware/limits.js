'use strict';
/**
 * The application's rate limiters, in one place.
 *
 * `authLimiter` moved here from routes/auth.js when the playmat upload route
 * needed one too. They are two limiters and not one shared budget on purpose:
 * a burst of uploads must not be able to lock anybody out of signing in, and
 * the two have nothing in common but the window they count over.
 *
 * Both maxima are overridable by environment variable so the test suite can
 * exercise the limit without either tripping it by accident.
 */
const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const COMMON    = { windowMs: WINDOW_MS, standardHeaders: true, legacyHeaders: false };

const authLimiter = rateLimit({
  ...COMMON,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  message: { error: 'Too many requests, please try again later' },
});

// A playmat is set once and then left alone for months, so the ceiling is
// about what a person could plausibly do while choosing one, not about
// throughput. Each attempt costs the server a read of up to 5 MB.
const uploadLimiter = rateLimit({
  ...COMMON,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 20,
  message: { error: 'Too many playmat uploads, please try again later' },
});

module.exports = { authLimiter, uploadLimiter };
