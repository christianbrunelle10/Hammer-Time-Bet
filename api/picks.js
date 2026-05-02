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
const TTL       = 86400; // 24 h — picks are stable for the full day
const TTL_EMPTY =  3600; // 1 h  — empty picks re-checked more frequently (odds may not be posted yet)

// Months when each sport is in active season and should have games
const ACTIVE_MONTHS = {
  nba:   [10,11,12,1,2,3,4,5,6],
  nhl:   [10,11,12,1,2,3,4,5,6],
  nfl:   [9,10,11,12,1,2],
  ncaaf: [8,9,10,11,12,1],
  ncaam: [11,12,1,2,3,4],
  mlb:   [3,4,5,6,7,8,9,10],
};

function _isActiveSeason(sport) {
  const m = parseInt(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-')[1], 10);
  return (ACTIVE_MONTHS[sport] || []).includes(m);
}

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
  // For homepage requests: an in-season sport with 0 cached top picks that was generated
  // more than 30 minutes ago is treated as stale-empty (odds weren't posted when it was
  // first cached). Force regeneration so NBA/NHL playoff games appear once lines go up.
  if (isHomepage) {
    sports.forEach((sport, i) => {
      const entry = cached[i];
      if (!entry || !_isActiveSeason(sport)) return;
      if ((entry.top || []).length > 0) return; // has picks — leave it alone
      const ageMs = entry.generatedAt ? Date.now() - new Date(entry.generatedAt).getTime() : Infinity;
      if (ageMs > 30 * 60 * 1000) {
        console.log(`[/api/picks] ${sport} in season, 0 picks cached ${Math.round(ageMs / 60000)}m ago — forcing refresh`);
        cached[i] = null; // treat as miss so we regenerate
      }
    });
  }

  let missSports = sports.filter((_, i) => !cached[i]);
  sports.forEach((s, i) => console.log(`[/api/picks] ${s} → ${cached[i] ? 'cache hit' : 'miss'}`));

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

    /* Write one key per sport.
       Sports with picks → 24h TTL (stable all day).
       Sports with no picks (odds not yet posted, no games, etc.) → 1h TTL so we
       re-check frequently. This prevents stale empty entries blocking NBA/NHL all day. */
    await Promise.all(
      missSports.map(sport => {
        const entry = bySport[sport] || { top: [], dog: [] };
        const ttl   = entry.top.length > 0 ? TTL : TTL_EMPTY;
        return redis.set(_key(sport, today), { ...entry, generatedAt }, { ex: ttl });
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

  if (isHomepage) {
    const poolDist = allTopPairs.reduce((m, p) => { m[p.game.sport] = (m[p.game.sport] || 0) + 1; return m; }, {});
    // Log any in-season sports that contributed 0 picks to the pool — helps diagnose missing sports
    for (const sport of sports) {
      if (_isActiveSeason(sport) && !poolDist[sport]) {
        console.log(`[/api/picks] WARNING: ${sport} is in season but has 0 picks in homepage pool`);
      }
    }
    console.log(`[/api/picks] homepage pool: ${JSON.stringify(poolDist)} (${allTopPairs.length} total top picks)`);
  }

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
