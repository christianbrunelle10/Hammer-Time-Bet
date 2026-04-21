/**
 * HammerTimeBet — Live Games API
 * ================================
 * GET /api/live?sports=mlb,nba,nhl
 *
 * Returns canonical game objects with display-ready odds for the
 * live-games component. The frontend only needs to render the cards —
 * no ESPN fetching or odds parsing happens in the browser.
 *
 * Odds source priority:
 *   1. Odds API (via ODDS_API_KEY env var) — best odds data
 *   2. ESPN pickcenter (summary endpoint)   — free fallback
 *
 * Cache: 30s CDN edge cache so the component auto-refresh (every 30s)
 *        always gets fresh-enough data without hammering ESPN.
 */
'use strict';

const { fromESPNEvent, parsePickcenter } = require('./_lib/canonical');

/* ── ESPN endpoints ─────────────────────────────────────────── */
const ESPN_SB = {
  mlb:   'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba:   'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl:   'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ncaaf: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  ncaam: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  nhl:   'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
};
const ESPN_SM = {
  mlb:   id => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${id}`,
  nba:   id => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,
  nfl:   id => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`,
  ncaaf: id => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`,
  ncaam: id => `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${id}`,
  nhl:   id => `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${id}`,
};

/* Odds API sport keys */
const ODDS_SPORT_KEY = {
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nfl:   'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  nhl:   'icehockey_nhl',
};

function _todayParam() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
}

function _fmtML(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : String(n);
}

/** Convert canonical odds → display odds shape used by _gameCard(). */
function _toDisplayOdds(canonical) {
  if (!canonical) return null;
  if (!canonical.away?.ml && !canonical.away?.spread && !canonical.total) return null;
  const fmtLine = (spread, spreadOdds) =>
    spread ? `${spread} (${spreadOdds || '-110'})` : '—';
  return {
    ml: {
      away: canonical.away?.ml   || '—',
      home: canonical.home?.ml   || '—',
    },
    line: {
      away: fmtLine(canonical.away?.spread, canonical.away?.spreadOdds),
      home: fmtLine(canonical.home?.spread, canonical.home?.spreadOdds),
    },
    total: {
      val:   canonical.total     || '—',
      over:  canonical.overOdds  || '—',
      under: canonical.underOdds || '—',
    },
  };
}

async function _fetchScoreboard(sport) {
  const url = ESPN_SB[sport];
  if (!url) return [];
  try {
    const r = await fetch(`${url}?dates=${_todayParam()}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    const { events = [] } = await r.json();
    return events.map(ev => fromESPNEvent(ev, sport)).filter(Boolean);
  } catch { return []; }
}

async function _fetchESPNOdds(sport, games) {
  const fn = ESPN_SM[sport];
  if (!fn || !games.length) return {};
  const results = await Promise.allSettled(
    games.map(async game => {
      const r = await fetch(fn(game.id), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data    = await r.json();
      const pc      = (data.pickcenter || [])[0];
      const display = pc ? _toDisplayOdds(parsePickcenter(pc)) : null;
      return { id: game.id, odds: display };
    })
  );
  const map = {};
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.odds) map[r.value.id] = r.value.odds;
  });
  return map;
}

async function _fetchOddsAPI(sport) {
  const apiKey  = process.env.ODDS_API_KEY;
  const sportKey = ODDS_SPORT_KEY[sport];
  if (!apiKey || !sportKey) return [];
  try {
    const bookmaker = process.env.ODDS_BOOKMAKER || 'draftkings';
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=${bookmaker}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

/** Match Odds API game to a canonical game by team name. */
function _matchOddsAPIGame(canonicalGame, oddsGames) {
  const al = canonicalGame.away.name.toLowerCase();
  const hl = canonicalGame.home.name.toLowerCase();
  return oddsGames.find(og => {
    const oal = (og.away_team || '').toLowerCase();
    const ohl = (og.home_team || '').toLowerCase();
    return oal.endsWith(al) || al.endsWith(oal) || ohl.endsWith(hl) || hl.endsWith(ohl);
  }) || null;
}

/** Convert Odds API game object → display odds shape. */
function _oddsAPIToDisplay(og) {
  const book    = og.bookmakers?.[0];
  const markets = {};
  (book?.markets || []).forEach(m => { markets[m.key] = m.outcomes; });
  const h2h     = markets.h2h    || [];
  const spreads = markets.spreads || [];
  const totals  = markets.totals  || [];
  const away    = og.away_team;
  const home    = og.home_team;
  const awayML  = h2h.find(o => o.name === away);
  const homeML  = h2h.find(o => o.name === home);
  const awaySpd = spreads.find(o => o.name === away);
  const homeSpd = spreads.find(o => o.name === home);
  const over    = totals.find(o => o.name === 'Over');
  const fmtPt   = (pt, price) => {
    if (pt === undefined || pt === null) return '—';
    const ptStr = pt >= 0 ? `+${pt}` : String(pt);
    return price !== undefined ? `${ptStr} (${_fmtML(price) || '-110'})` : ptStr;
  };
  return {
    ml:    { away: _fmtML(awayML?.price) || '—', home: _fmtML(homeML?.price) || '—' },
    line:  { away: fmtPt(awaySpd?.point, awaySpd?.price), home: fmtPt(homeSpd?.point, homeSpd?.price) },
    total: { val: over?.point != null ? String(over.point) : '—', over: _fmtML(over?.price) || '—', under: '—' },
  };
}

/* ── Handler ─────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const VALID = new Set(['mlb', 'nba', 'nfl', 'ncaaf', 'ncaam', 'nhl']);
  const sports = (req.query.sports || req.query.sport || '')
    .toLowerCase().split(',')
    .map(s => s.trim())
    .filter(s => VALID.has(s));

  if (!sports.length) {
    return res.status(400).json({ error: 'Provide ?sports=nba,nhl or ?sport=mlb' });
  }

  /* Fetch scoreboards + Odds API data for all sports in parallel */
  const [gamesBySport, oddsAPIdataBySport] = await Promise.all([
    Promise.all(sports.map(s => _fetchScoreboard(s).then(g => ({ sport: s, games: g })))),
    Promise.all(sports.map(s => _fetchOddsAPI(s).then(d => ({ sport: s, data: d })))),
  ]);

  const oddsAPImap = {};
  oddsAPIdataBySport.forEach(({ sport, data }) => { oddsAPImap[sport] = data; });

  /* For sports without Odds API data, fall back to ESPN pickcenter */
  const espnOddsNeeded = sports.filter(s => !(oddsAPImap[s]?.length));
  const allGames = gamesBySport.flatMap(r => r.games);
  const gamesBySportMap = {};
  gamesBySport.forEach(r => { gamesBySportMap[r.sport] = r.games; });

  const espnOddsResults = await Promise.all(
    espnOddsNeeded.map(s => _fetchESPNOdds(s, gamesBySportMap[s] || []).then(m => ({ sport: s, map: m })))
  );
  const espnOddsMap = {};
  espnOddsResults.forEach(({ map }) => Object.assign(espnOddsMap, map));

  /* Assemble final game objects with display odds */
  const games = allGames.map(game => {
    const oddsAPIdata = oddsAPImap[game.sport] || [];
    let displayOdds = null;

    if (oddsAPIdata.length) {
      const match = _matchOddsAPIGame(game, oddsAPIdata);
      if (match) displayOdds = _oddsAPIToDisplay(match);
    }

    if (!displayOdds) {
      displayOdds = espnOddsMap[game.id] || null;
    }

    return {
      id:       game.id,
      sport:    game.sport,
      away:     game.away,
      home:     game.home,
      status:   game.status,
      state:    game.state,
      gameTime: game.gameTime,
      odds:     displayOdds,
    };
  });

  console.log(`[/api/live] ${sports.join(',')} → ${games.length} games`);

  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json({ games, fetchedAt: new Date().toISOString() });
};
