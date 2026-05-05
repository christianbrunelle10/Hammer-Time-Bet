/**
 * HammerTimeBet — Game-specific odds proxy
 * =========================================
 * GET /api/game-odds?sport=nhl&homeTeam=Oilers&awayTeam=Panthers
 *
 * Fetches odds for ONE game matched by team name.
 * Returns a normalized object ready for the frontend to render.
 *
 * Env vars:
 *   ODDS_API_KEY   — from https://the-odds-api.com  (required)
 *   ODDS_BOOKMAKER — bookmaker slug                  (optional, default: draftkings)
 */
'use strict';

const SPORT_KEY = {
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nfl:   'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  ncaam: 'basketball_ncaab',
  nhl:   'icehockey_nhl',
};

function fmtOdds(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : String(n);
}

function fmtSpread(pt, price) {
  if (pt === undefined || pt === null) return null;
  const ptStr = pt >= 0 ? `+${pt}` : String(pt);
  return price !== undefined ? `${ptStr} (${fmtOdds(price)})` : ptStr;
}

/** Team-name substring match — handles "Warriors" ↔ "Golden State Warriors". */
function matchGame(homeTeam, awayTeam, games) {
  const hl = homeTeam.toLowerCase();
  const al = awayTeam.toLowerCase();
  return games.find(g => {
    const ghl = (g.home_team || '').toLowerCase();
    const gal = (g.away_team || '').toLowerCase();
    return (ghl.endsWith(hl) || hl.endsWith(ghl)) &&
           (gal.endsWith(al) || al.endsWith(gal));
  }) || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sport    = (req.query.sport    || '').toLowerCase();
  const homeTeam = (req.query.homeTeam || '').trim();
  const awayTeam = (req.query.awayTeam || '').trim();
  const sportKey = SPORT_KEY[sport];

  if (!sportKey) {
    return res.status(400).json({ error: `Unknown sport "${sport}". Valid: ${Object.keys(SPORT_KEY).join(', ')}` });
  }
  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: 'homeTeam and awayTeam query params are required' });
  }

  const apiKey    = process.env.ODDS_API_KEY;
  const bookmaker = process.env.ODDS_BOOKMAKER || 'draftkings';

  if (!apiKey) {
    console.error('[game-odds] ODDS_API_KEY not set');
    return res.status(500).json({ error: 'Odds service not configured' });
  }

  const url = [
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`,
    `?apiKey=${apiKey}`,
    `&regions=us`,
    `&markets=h2h,spreads,totals`,
    `&oddsFormat=american`,
    `&bookmakers=${bookmaker}`,
  ].join('');

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(6000) });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      console.error(`[game-odds] Odds API ${upstream.status}:`, body);
      return res.status(502).json({ error: `Odds API returned ${upstream.status}` });
    }

    const raw  = await upstream.json();
    const game = matchGame(homeTeam, awayTeam, raw);

    if (!game) {
      return res.status(404).json({ error: 'No odds found for this matchup' });
    }

    const book    = game.bookmakers?.[0];
    const markets = {};
    (book?.markets || []).forEach(m => { markets[m.key] = m.outcomes; });

    const h2h     = markets.h2h     || [];
    const spreads = markets.spreads  || [];
    const totals  = markets.totals   || [];

    const awayML  = h2h.find(o => o.name === game.away_team);
    const homeML  = h2h.find(o => o.name === game.home_team);
    const awaySpd = spreads.find(o => o.name === game.away_team);
    const homeSpd = spreads.find(o => o.name === game.home_team);
    const over    = totals.find(o => o.name === 'Over');
    const under   = totals.find(o => o.name === 'Under');

    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=30');
    return res.status(200).json({
      homeTeam:      game.home_team,
      awayTeam:      game.away_team,
      moneylineHome: fmtOdds(homeML?.price),
      moneylineAway: fmtOdds(awayML?.price),
      spreadHome:    fmtSpread(homeSpd?.point, homeSpd?.price),
      spreadAway:    fmtSpread(awaySpd?.point, awaySpd?.price),
      totalOver:     over?.point  != null ? `O ${over.point}`  : null,
      totalUnder:    under?.point != null ? `U ${under.point}` : null,
      overOdds:      fmtOdds(over?.price),
      underOdds:     fmtOdds(under?.price),
      bookmaker:     book?.title || bookmaker,
      lastUpdated:   game.last_update || null,
    });

  } catch (err) {
    console.error('[game-odds] fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to reach odds provider' });
  }
};
