/**
 * HammerTimeBet — Live Odds Proxy
 * ================================
 * Deployed to Vercel. Called by the frontend as:
 *   GET /api/odds?sport=mlb
 *
 * Env vars (set in Vercel dashboard → Settings → Environment Variables):
 *   ODDS_API_KEY   — your key from https://the-odds-api.com  (required)
 *   ODDS_BOOKMAKER — bookmaker slug to pull from              (optional, default: draftkings)
 *
 * The API key never reaches the browser. The response contains
 * only cleaned odds data — no bookmaker names, no branding.
 */

'use strict';

const SPORT_KEY = {
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nfl:   'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  nhl:   'icehockey_nhl',
};

function fmtOdds(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * Transform raw Odds API payload → clean internal format.
 * Returns an array of odds objects the frontend understands.
 */
function transform(raw) {
  return raw.map(game => {
    const book    = game.bookmakers?.[0];
    const markets = {};
    (book?.markets || []).forEach(m => { markets[m.key] = m.outcomes; });

    const h2h     = markets.h2h     || [];
    const spreads = markets.spreads  || [];
    const totals  = markets.totals   || [];

    const away = game.away_team;
    const home = game.home_team;

    const awayML  = h2h.find(o => o.name === away);
    const homeML  = h2h.find(o => o.name === home);
    const awaySpd = spreads.find(o => o.name === away);
    const homeSpd = spreads.find(o => o.name === home);
    const over    = totals.find(o => o.name === 'Over');
    const under   = totals.find(o => o.name === 'Under');

    const spd = (pt, price) => {
      if (pt === undefined || pt === null) return null;
      const ptStr = pt >= 0 ? `+${pt}` : String(pt);
      return price !== undefined ? `${ptStr} (${fmtOdds(price)})` : ptStr;
    };

    return {
      awayTeam: away,
      homeTeam: home,
      commence: game.commence_time,
      ml: {
        away: fmtOdds(awayML?.price),
        home: fmtOdds(homeML?.price),
      },
      line: {
        away: spd(awaySpd?.point, awaySpd?.price),
        home: spd(homeSpd?.point, homeSpd?.price),
      },
      total: {
        val:   over?.point != null ? String(over.point) : null,
        over:  fmtOdds(over?.price),
        under: fmtOdds(under?.price),
      },
    };
  });
}

module.exports = async function handler(req, res) {
  // CORS — allow hammertimebet.com and any GitHub Pages origin during dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sport    = (req.query.sport || '').toLowerCase();
  const sportKey = SPORT_KEY[sport];

  if (!sportKey) {
    return res.status(400).json({ error: `Unknown sport: "${sport}". Valid: ${Object.keys(SPORT_KEY).join(', ')}` });
  }

  const apiKey    = process.env.ODDS_API_KEY;
  const bookmaker = process.env.ODDS_BOOKMAKER || 'draftkings';

  if (!apiKey) {
    console.error('ODDS_API_KEY env var is not set');
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
      console.error(`Odds API error ${upstream.status}:`, body);
      return res.status(502).json({ error: `Odds API returned ${upstream.status}` });
    }

    const raw  = await upstream.json();
    const odds = transform(raw);

    // Light cache: CDN can serve stale for up to 20s while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=30');
    return res.status(200).json({ odds, updatedAt: new Date().toISOString() });

  } catch (err) {
    console.error('Odds fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to reach odds provider' });
  }
};
