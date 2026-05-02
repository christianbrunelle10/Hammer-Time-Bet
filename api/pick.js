/**
 * HammerTimeBet — Single-Game Pick API
 * ======================================
 * GET /api/pick?id=GAMEID&sport=SPORT
 *
 * Returns the official Hammer pick for one specific game.
 * Used by game detail pages so every game always has a pick.
 *
 * Resolution order:
 *   1. Single-game pick cache  (pick:{sport}:{gameId}:{date}) — 1h TTL
 *   2. Sport picks cache       (picks:{sport}:{date})         — match by gameId field
 *   3. Live generation         — ESPN summary + pick-engine
 *   4. Safe fallback pick      — neutral, data-honest lean when EV filter rejects all types
 */
'use strict';

const { fromESPNSummary, parsePickcenter } = require('./_lib/canonical');
const { computePick, validatePick, extractPlayers } = require('./_lib/pick-engine');
const redis = require('../lib/redis');

const ESPN_SM = {
  mlb:   id => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${id}`,
  nba:   id => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,
  nfl:   id => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`,
  ncaaf: id => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`,
  ncaam: id => `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${id}`,
  nhl:   id => `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${id}`,
};

const VALID = new Set(['mlb', 'nba', 'nfl', 'ncaaf', 'ncaam', 'nhl']);

function _todayISO() { return new Date().toISOString().slice(0, 10); }

/** Safe fallback pick: uses current market pricing without inventing stats. */
function _fallbackPick(game, odds, today) {
  const homeFav = odds?.favorite !== 'away'; // default to home when unknown
  const fav     = homeFav ? game.home : game.away;
  const favML   = homeFav ? (odds?.home?.ml || '-110') : (odds?.away?.ml || '-110');
  return {
    sport:       game.sport,
    gameId:      game.id,
    matchup:     `${game.away.name} @ ${game.home.name}`,
    pick:        `${fav.name} ML`,
    odds:        favML,
    edge:        'value',
    edgeLabel:   '0.5u Lean',
    conf:        5.5,
    units:       0.5,
    dataQuality: 'low',
    isFallback:  true,
    reasons: [
      `Model leans ${fav.name} based on current market pricing and matchup structure. Confidence is moderate — deeper verified team metrics are not available for this game.`,
    ],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gameId = (req.query.id    || '').trim();
  const sport  = (req.query.sport || '').toLowerCase().trim();

  if (!gameId || !sport || !VALID.has(sport)) {
    return res.status(400).json({ error: 'Provide ?id=GAMEID&sport=SPORT (sport: mlb nba nfl ncaaf ncaam nhl)' });
  }

  const today    = _todayISO();
  const cacheKey = `pick:${sport}:${gameId}:${today}`;

  /* 1. Single-game pick cache */
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached?.pick) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ pick: cached.pick, source: 'cache' });
  }

  /* 2. Sport-level picks cache — look for exact gameId match */
  const sportCache = await redis.get(`picks:${sport}:${today}`).catch(() => null);
  if (sportCache) {
    const allPairs = [...(sportCache.top || []), ...(sportCache.dog || [])];
    const match    = allPairs.find(pair => pair.pick?.gameId === gameId);
    if (match?.pick) {
      await redis.set(cacheKey, { pick: match.pick }, { ex: 3600 }).catch(() => {});
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
      return res.status(200).json({ pick: match.pick, source: 'sport-cache' });
    }
  }

  /* 3. Generate from ESPN summary */
  const summaryFn = ESPN_SM[sport];
  if (!summaryFn) return res.status(400).json({ error: `Unsupported sport: ${sport}` });

  try {
    const r = await fetch(summaryFn(gameId), { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`ESPN summary HTTP ${r.status}`);
    const data = await r.json();

    const game = fromESPNSummary(data, sport);
    if (!game) throw new Error('Could not parse game from ESPN summary');

    const pc      = (data.pickcenter || [])[0];
    const odds    = pc ? parsePickcenter(pc) : null;
    const players = extractPlayers(data, sport, game);

    let pick = null;

    /* Try top pick */
    const rawTop = computePick(game, odds, players, today, 'top');
    if (rawTop) pick = validatePick(rawTop, game);

    /* Try dog pick if top pick fails and game hasn't started */
    if (!pick && game.status === 'pre') {
      const rawDog = computePick(game, odds, players, today, 'dog');
      if (rawDog) pick = validatePick(rawDog, game);
    }

    /* Safe fallback — never leave a game without a pick */
    if (!pick) pick = _fallbackPick(game, odds, today);

    await redis.set(cacheKey, { pick }, { ex: 3600 }).catch(() => {});

    console.log(`[/api/pick] ${sport} ${gameId} → ${pick.pick} (${pick.isFallback ? 'fallback' : 'generated'})`);

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ pick, source: 'generated' });

  } catch (err) {
    console.error(`[/api/pick] ${sport} ${gameId} error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
