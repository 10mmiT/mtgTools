'use strict';
/**
 * Express 4 does not await a route handler. A throw inside an async one is a
 * rejected promise nobody holds, and Node ends the process over it — one bad
 * request body was enough to take the whole server down. Wrapped, the
 * rejection is handed to next() and reaches the JSON error handler at the end
 * of server.js as an ordinary 500.
 */
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
