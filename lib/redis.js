'use strict';

/**
 * Upstash Redis client — plain fetch, no npm dependencies.
 *
 * Env vars (set in Vercel dashboard):
 *   UPSTASH_REDIS_REST_URL   — https://<name>.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN — your REST token
 *
 * Usage:
 *   const redis = require('../lib/redis');
 *   await redis.set('key', 'value', { ex: 86400 });
 *   const val = await redis.get('key');
 */

const URL   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function _cmd(...args) {
  if (!URL || !TOKEN) {
    console.warn('[redis] credentials missing — skipping:', args[0], String(args[1] ?? '').slice(0, 60));
    return null;
  }
  const res = await fetch(URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(args),
    signal:  AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Upstash ${res.status} [${args[0]} ${String(args[1] ?? '').slice(0, 50)}]: ${body}`);
  }
  const { result } = await res.json();
  return result;
}

const redis = {
  /** GET key → parsed JSON value, or null on miss. */
  async get(key) {
    const raw = await _cmd('GET', key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },

  /**
   * SET key value
   * @param {string} key
   * @param {any}    value        — objects are JSON-stringified automatically
   * @param {{ ex?: number }}     — optional TTL in seconds
   */
  async set(key, value, { ex } = {}) {
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    const args   = ['SET', key, stored];
    if (ex) args.push('EX', String(ex));
    return _cmd(...args);
  },

  /** DEL key → number of keys deleted. */
  async del(key) {
    return _cmd('DEL', key);
  },

  /** EXISTS key → 1 if present, 0 if not. */
  async exists(key) {
    return _cmd('EXISTS', key);
  },
};

module.exports = redis;
