/**
 * HammerTimeBet — Games API
 * ==========================
 * GET /api/games?sport=nba
 *
 * Returns canonical game objects for a sport (no odds, no picks).
 * Used by game detail pages and any component needing raw game data.
 *
 * Cache: 60s CDN edge cache.
 */
'use strict';

const { fromESPNEvent } = require('./_lib/canonical');

const ESPN_SB = {
  mlb:   'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba:   'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl:   'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ncaaf: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  ncaam: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  nhl:   'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
};

function _todayParam() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const VALID = new Set(['mlb', 'nba', 'nfl', 'ncaaf', 'ncaam', 'nhl']);
  const sport = (req.query.sport || '').toLowerCase().trim();

  if (!VALID.has(sport)) {
    return res.status(400).json({ error: `Unknown sport "${sport}". Valid: ${[...VALID].join(', ')}` });
  }

  const url = ESPN_SB[sport];
  try {
    const r = await fetch(`${url}?dates=${_todayParam()}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const { events = [] } = await r.json();
    const games = events.map(ev => fromESPNEvent(ev, sport)).filter(Boolean);
    console.log(`[/api/games] ${sport} → ${games.length} games`);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ games, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[/api/games] fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to fetch games from ESPN' });
  }
};
