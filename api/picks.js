/**
 * HammerTimeBet — Picks API
 * ==========================
 * GET /api/picks?sport=nba
 *   Returns top + dog picks for one sport (sport page).
 *
 * GET /api/picks?sports=nba,nhl,mlb
 *   Returns curated top (max 5) + dog (max 3) picks across sports (homepage).
 *
 * Pick source priority:
 *   1. Redis — key picks:{sport}:{YYYY-MM-DD}, one key per sport per day.
 *      Checked for ALL requested sports before any ESPN call is made.
 *      Only sports missing from Redis trigger generation.
 *   2. Live ESPN compute — for any sport not yet in Redis.
 *      Result is written back to Redis before responding.
 *
 * This guarantees that every page (homepage, sport page, game page) reading
 * picks for the same sport on the same day gets the exact same data — no
 * regeneration, no drift between pages.
 *
 * Cache: 5 min CDN edge, serve stale up to 24 h during revalidation.
 */
'use strict';

const { generateAllPicks, _curateHomepicks, _todayISO } = require('./_lib/picks-generator');
const redis = require('../lib/redis');

const VALID = new Set(['mlb', 'nba', 'nfl', 'ncaaf', 'ncaam', 'nhl']);
const TTL   = 86400; // 24 h — picks are stable for the full day

/** Redis key for a single sport's picks. */
function _key(sport, date) {
  return `picks:${sport}:${date}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const rawSport   = (req.query.sport  || '').toLowerCase().trim();
  const rawSports  = (req.query.sports || '').toLowerCase().trim();
  const isHomepage = !!rawSports;

  const sports = (rawSports || rawSport)
    .split(',')
    .map(s => s.trim())
    .filter(s => VALID.has(s));

  if (!sports.length) {
    return res.status(400).json({ error: 'Provide ?sport=nba or ?sports=nba,nhl,mlb' });
  }

  const today = _todayISO();

  /* ── 1. Read all requested sports from Redis in parallel ─────── */
  const cached = await Promise.all(
    sports.map(sport => redis.get(_key(sport, today)))
  );

  /* ── 2. Find any sports not yet in Redis ────────────────────── */
  const missSports = sports.filter((_, i) => !cached[i]);

  /* ── 3. Generate + cache any missing sports ──────────────────── */
  if (missSports.length) {
    console.log(`[/api/picks] Redis miss — generating for: ${missSports.join(',')}`);

    const { allTop, allDog } = await generateAllPicks(missSports, today);

    /* Group generated pairs by sport */
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

    /* Write one key per sport. Sports with no games today get an
       empty entry so we don't hit ESPN again for the same sport. */
    await Promise.all(
      missSports.map(sport => {
        const entry = bySport[sport] || { top: [], dog: [] };
        return redis.set(_key(sport, today), { ...entry, generatedAt }, { ex: TTL });
      })
    );

    /* Backfill the cached array so step 4 can treat all sports uniformly */
    sports.forEach((sport, i) => {
      if (!cached[i]) {
        const entry = bySport[sport] || { top: [], dog: [] };
        cached[i] = { ...entry, generatedAt };
      }
    });
  }

  /* ── 4. Merge + (optionally) curate ─────────────────────────── */
  const allTopPairs = cached.flatMap(c => c?.top || []);
  const allDogPairs = cached.flatMap(c => c?.dog || []);

  const topOut = isHomepage
    ? _curateHomepicks(allTopPairs, 5).map(p => p.pick)
    : allTopPairs.map(p => p.pick);

  const dogOut = isHomepage
    ? _curateHomepicks(allDogPairs, 3).map(p => p.pick)
    : allDogPairs.map(p => p.pick);

  /* fetchedAt = original generation time when fully cached, current time on miss */
  const fetchedAt = missSports.length
    ? new Date().toISOString()
    : (cached[0]?.generatedAt || new Date().toISOString());

  console.log(
    `[/api/picks] ${today} ${sports.join(',')} → ${topOut.length} top, ${dogOut.length} dog` +
    (missSports.length ? ` (generated: ${missSports.join(',')})` : ' (all from Redis)')
  );

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  return res.status(200).json({ top: topOut, dog: dogOut, fetchedAt });
};
