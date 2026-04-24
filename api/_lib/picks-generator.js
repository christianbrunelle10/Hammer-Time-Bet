/**
 * HammerTimeBet — Pick Generation (shared)
 * ==========================================
 * Used by both /api/picks (live fallback) and /api/daily-cron (scheduled run).
 * Keeping one copy here guarantees identical picks regardless of which path generated them.
 */
'use strict';

const { fromESPNEvent, parsePickcenter } = require('./canonical');
const { computePick, validatePick, extractPlayers } = require('./pick-engine');

/* ── ESPN endpoints ─────────────────────────────────────────── */
const SB = {
  mlb:   'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba:   'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl:   'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ncaaf: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  ncaam: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
  nhl:   'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
};
const SM = {
  mlb:   id => `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${id}`,
  nba:   id => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,
  nfl:   id => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`,
  ncaaf: id => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`,
  ncaam: id => `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${id}`,
  nhl:   id => `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${id}`,
};

function _todayParam() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
}

function _todayISO() { return new Date().toISOString().slice(0, 10); }

async function _fetchGames(sport) {
  const url = SB[sport];
  if (!url) return [];
  const t0 = Date.now();
  try {
    const r = await fetch(`${url}?dates=${_todayParam()}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) {
      console.warn(`[picks-gen] ${sport} scoreboard HTTP ${r.status} (${Date.now() - t0}ms)`);
      return [];
    }
    const { events = [] } = await r.json();
    const games = events.map(ev => fromESPNEvent(ev, sport)).filter(Boolean);
    console.log(`[picks-gen] ${sport} scoreboard → ${games.length} games (${Date.now() - t0}ms)`);
    return games;
  } catch (e) {
    console.error(`[picks-gen] ${sport} scoreboard error: ${e?.message} (${Date.now() - t0}ms)`);
    return [];
  }
}

async function _fetchSummary(sport, game) {
  const fn = SM[sport];
  if (!fn) return { odds: null, players: {} };
  try {
    const r = await fetch(fn(game.id), { signal: AbortSignal.timeout(7000) });
    if (!r.ok) {
      console.warn(`[picks-gen] ${sport} summary ${game.id} HTTP ${r.status}`);
      return { odds: null, players: {} };
    }
    const data    = await r.json();
    const pc      = (data.pickcenter || [])[0];
    const odds    = pc ? parsePickcenter(pc) : null;
    const players = extractPlayers(data, sport, game);
    return { odds, players };
  } catch (e) {
    console.warn(`[picks-gen] ${sport} summary ${game.id} error: ${e?.message}`);
    return { odds: null, players: {} };
  }
}

/* ── Homepage curation: 7-signal scoring formula ────────────── */
function _scoreHomepick(pick, game) {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  let score   = 0;

  const SPORT_BASE = {
    nba:   (month >= 4 && month <= 6) ? 55 : 22,
    nhl:   (month >= 4 && month <= 6) ? 55 : 22,
    nfl:   (month >= 9 || month <= 1) ? 50 :  4,
    ncaaf: (month >= 9 && month <= 12) ? 42 :  3,
    ncaam: (month >= 11 || month <= 4) ? 36 :  3,
    mlb:   16,
    golf:   8,
  };
  score += SPORT_BASE[game.sport] || 10;

  const stateText = `${game.state || ''} ${game.gameTime || ''}`.toLowerCase();
  if (/playoff|postseason|series|round \d|game \d of|conference|semifinal|championship/i.test(stateText)) {
    score += 45;
  }

  if (game.sport === 'ncaam') {
    if (month === 3 && day >= 12) score += 30;
    else if (month === 4 && day <= 9) score += 25;
  }

  if (game.status === 'live')  score += 30;
  if (game.status === 'final') score -= 25;

  score += Math.round(Math.max(0, (pick.conf - 5.0) / 5.0) * 20);

  if      (pick.edge === 'dog')    score += 12;
  else if (pick.edge === 'value')  score += 10;
  else if (pick.edge === 'strong') score +=  7;
  if      (pick.units >= 2.0)      score +=  8;
  else if (pick.units >= 1.5)      score +=  5;
  else if (pick.units >= 1.0)      score +=  3;

  const oddsNum = parseInt(String(pick.odds || '-110').replace('+', ''), 10);
  if (!isNaN(oddsNum)) {
    if      (oddsNum >= -130) score += 12;
    else if (oddsNum >= -180) score +=  8;
    else if (oddsNum >= -250) score +=  4;
  }

  // Penalize picks with no real player/matchup data so generic cards don't reach the homepage
  if      (pick.dataQuality === 'low')    score -= 15;
  else if (pick.dataQuality === 'medium') score -=  5;
  // 'high' → no penalty

  return score;
}

function _curateHomepicks(pairs, max) {
  if (!pairs.length || max <= 0) return [];

  // Hard quality gate: if any medium/high picks exist, exclude low-quality picks entirely.
  // Low-quality picks (0 named players) only appear if that is ALL that is available.
  const qualityPairs = pairs.filter(p => (p.pick.dataQuality || 'low') !== 'low');
  const effectivePairs = qualityPairs.length > 0 ? qualityPairs : pairs;
  if (qualityPairs.length < pairs.length) {
    console.log(`[picks-gen] curate: excluded ${pairs.length - qualityPairs.length} low-quality picks from homepage pool (${effectivePairs.length} eligible)`);
  }

  if (effectivePairs.length <= max) return [...effectivePairs];

  const PER_SPORT_MAX = 2; // hard cap per sport on the homepage

  const sorted = [...effectivePairs].sort((a, b) => _scoreHomepick(b.pick, b.game) - _scoreHomepick(a.pick, a.game));

  const counts  = {};
  const selected = [];
  const held     = []; // eligible but over cap

  // Pass 1: one best pick per sport — guarantees every active sport is represented
  for (const pair of sorted) {
    const sp = pair.game.sport;
    if (!counts[sp]) {
      selected.push(pair);
      counts[sp] = 1;
    }
    if (selected.length >= max) break;
  }

  // Pass 2: fill remaining slots up to PER_SPORT_MAX per sport, best score first
  if (selected.length < max) {
    const selectedSet = new Set(selected);
    for (const pair of sorted) {
      if (selected.length >= max) break;
      if (selectedSet.has(pair)) continue;
      const sp = pair.game.sport;
      const n  = counts[sp] || 0;
      if (n < PER_SPORT_MAX) {
        selected.push(pair);
        counts[sp] = n + 1;
        selectedSet.add(pair);
      } else {
        held.push(pair);
      }
    }
  }

  // Pass 3: if still not full (all sports at max), allow overflow from held pool
  let i = 0;
  while (selected.length < max && i < held.length) selected.push(held[i++]);

  const resultDist = selected.reduce((m, p) => { m[p.game.sport] = (m[p.game.sport] || 0) + 1; return m; }, {});
  console.log(`[picks-gen] curate: selected ${selected.length}/${pairs.length} → ${JSON.stringify(resultDist)}`);

  return selected.slice(0, max);
}

/* ── Core generation ─────────────────────────────────────────── */

/**
 * Fetch games + summaries, generate top and dog picks for every sport.
 *
 * Returns { allTop, allDog } where each element is { pick, game }.
 * Per-sport topPickIds deduplication guarantees one pick per game:
 *   - top pick wins; that game is excluded from dog candidates.
 *
 * @param {string[]} sports  — validated sport keys
 * @param {string}   today   — YYYY-MM-DD (used as RNG seed date)
 * @returns {Promise<{ allTop: Array<{pick,game}>, allDog: Array<{pick,game}> }>}
 */
async function generateAllPicks(sports, today) {
  const t0       = Date.now();
  const allGames = (await Promise.all(sports.map(_fetchGames))).flat();
  console.log(`[picks-gen] ${sports.join(',')} → ${allGames.length} total games (${Date.now() - t0}ms fetched)`);

  const summaryResults = await Promise.allSettled(
    allGames.map(g => _fetchSummary(g.sport, g))
  );
  const summaryMap = {};
  let oddsMisses = 0;
  summaryResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      summaryMap[allGames[i].id] = r.value;
      if (!r.value.odds) oddsMisses++;
    } else {
      console.warn(`[picks-gen] summary rejected for ${allGames[i].id}: ${r.reason?.message}`);
    }
  });
  if (oddsMisses > 0) console.log(`[picks-gen] ${oddsMisses}/${allGames.length} games have no odds data`);

  /* Group by sport so topPickIds is scoped correctly per sport */
  const bySport = {};
  for (const g of allGames) (bySport[g.sport] = bySport[g.sport] || []).push(g);

  const allTop = [];
  const allDog = [];

  for (const games of Object.values(bySport)) {
    const topPickIds = new Set();

    for (const g of games) {
      const { odds = null, players = {} } = summaryMap[g.id] || {};
      const raw  = computePick(g, odds, players, today, 'top');
      const pick = raw ? validatePick(raw, g) : null;
      if (pick) { topPickIds.add(g.id); allTop.push({ pick, game: g }); }
    }

    for (const g of games) {
      if (topPickIds.has(g.id)) continue;
      if (g.status !== 'pre')   continue;
      const { odds = null, players = {} } = summaryMap[g.id] || {};
      const aML = parseInt((odds?.away?.ml || '0').replace('+', ''), 10);
      const hML = parseInt((odds?.home?.ml || '0').replace('+', ''), 10);
      if (aML <= 0 && hML <= 0) continue;
      const raw  = computePick(g, odds, players, today, 'dog');
      const pick = raw ? validatePick(raw, g) : null;
      if (pick) allDog.push({ pick, game: g });
    }
  }

  // Per-sport breakdown for diagnosing missing sports
  const sportSummary = {};
  for (const sport of sports) sportSummary[sport] = { games: (bySport[sport] || []).length, top: 0, dog: 0 };
  for (const { game } of allTop) if (sportSummary[game.sport]) sportSummary[game.sport].top++;
  for (const { game } of allDog) if (sportSummary[game.sport]) sportSummary[game.sport].dog++;
  for (const [sp, s] of Object.entries(sportSummary)) {
    const why = s.games === 0 ? ' (no games today)' : s.top === 0 ? ' (no qualifying picks — odds or EV filter)' : '';
    console.log(`[picks-gen] ${sp}: ${s.games} games → ${s.top} top + ${s.dog} dog picks${why}`);
  }
  console.log(`[picks-gen] done — ${allTop.length} top + ${allDog.length} dog picks (${Date.now() - t0}ms total)`);
  return { allTop, allDog };
}

module.exports = { generateAllPicks, _curateHomepicks, _todayISO };
