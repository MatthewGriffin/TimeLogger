/**
 * Rate limiters for the local API.
 *
 * The server binds to 127.0.0.1, so this is not protection against the
 * internet. It bounds what any *other* process on the machine - or a web page
 * that guesses the port - can do: credential-testing endpoints otherwise make
 * a convenient oracle for brute-forcing tokens, and the setup routes each
 * trigger an outbound call to a third party.
 */

import rateLimit from 'express-rate-limit';

const WINDOW_MS = 60 * 1000;

const options = {
  windowMs: WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Wait a moment and try again.',
  },
};

/**
 * General allowance for the API. Generous, because the UI legitimately polls
 * some endpoints while a sign-in is in progress.
 */
export const apiLimiter = rateLimit({ ...options, limit: 300 });

/**
 * Tighter allowance for setup and credential-testing routes, which are
 * user-driven and never called in a loop.
 */
export const setupLimiter = rateLimit({ ...options, limit: 60 });
