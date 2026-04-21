/**
 * HammerTimeBet — Manual Picks Refresh
 * ======================================
 * POST /api/refresh
 * POST /api/refresh?sport=nba
 * POST /api/refresh?sport=nba,mlb
 * POST /api/refresh?sport=all   (default — clears all 6 sports)
 *
 * Clears today's Redis pick keys for the specified sport(s) and
 * immediately regenerates them from ESPN. Use this after a line
 * moves significantly or to force fresh picks mid-day.
 *
 * Auth: set REFRESH_SECRET in Vercel env vars (falls back to CRON_SECRET).
 * Pass via header: Authorization: Bearer <secret>
 * Or query param:  ?secret=<secret>
 */
'use strict';

const { generateAllPicks, _todayISO } = require('./_lib/picks-generator');
const redis = require('../lib/redis');

const SPORTS = ['mlb', 'nba', 'nfl', 'ncaaf', 'ncaam', 'nhl'];
const TTL    = 86400;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret   = process.env.REFRESH_SECRET || process.env.CRON_SECRET;
  const provided = (req.headers.authorization || '').replace('Bearer ', '') || req.query.secret || '';
  if (secret && provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const sportParam = (req.query.sport || 'all').toLowerCase().trim();
  const targets    = sportParam === 'all'
    ? SPORTS
    : sportParam.split(',').map(s => s.trim()).filter(s => SPORTS.includes(s));

  if (!targets.length) {
    return res.status(400).json({ error: `Invalid sport. Valid: ${SPORTS.join(', ')}` });
  }

  const today = _todayISO();
  const t0    = Date.now();

  await Promise.all(targets.map(s => redis.del(`picks:${s}:${today}`)));
  console.log(`[/api/refresh] Cleared ${targets.join(',')} for ${today}`);

  const { allTop, allDog } = await generateAllPicks(targets, today);

  const bySport = {};
  for (const pair of allTop) {
    const sp = pair.game.sport;
    (bySport[sp] = bySport[sp] || { top: [], dog: [] }).top.push(pair);
  }
  for (const pair of allDog) {
    const sp = pair.game.sport;
    (bySport[sp] = bySport[sp] || { top: [], dog: [] }).dog.push(pair);
  }

  const generatedAt = new Date().toISOString();
  await Promise.all(targets.map(s => {
    const entry = bySport[s] || { top: [], dog: [] };
    return redis.set(`picks:${s}:${today}`, { ...entry, generatedAt }, { ex: TTL });
  }));

  const summary = {};
  targets.forEach(s => {
    const e = bySport[s] || { top: [], dog: [] };
    summary[s] = { top: e.top.length, dog: e.dog.length };
  });

  const elapsed = Date.now() - t0;
  console.log(`[/api/refresh] Done in ${elapsed}ms — ${today}`, summary);

  return res.status(200).json({ date: today, refreshed: targets, picks: summary, generatedAt, elapsedMs: elapsed });
};
