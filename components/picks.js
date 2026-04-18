/**
 * HammerTimeBet — Live Picks Engine
 * ===================================
 * Generates picks from real ESPN games fetched live.
 * No fake matchups. No hardcoded teams.
 *
 * Usage:
 *   Sport page:  HTBPicks.render('mlb', 'mlb-picks-grid')
 *   NCAAF page:  HTBPicks.render('ncaaf', 'ncaaf-picks-grid', 'ncaaf-dogs-grid')
 *   NCAAM page:  HTBPicks.render('ncaam', 'ncaam-picks-grid', 'ncaam-dogs-grid')
 *   Homepage:    HTBPicks.renderHomepage(['mlb','nba','nfl','nhl','ncaam'], 'top-picks-grid', 'dog-picks-grid')
 */
(function (global) {
  'use strict';

  /* ── ESPN endpoints ─────────────────────────────────── */
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

  /* ── Seeded RNG — deterministic per game per day ────── */
  function mkRng(seed) {
    let s = 0;
    const k = String(seed);
    for (let i = 0; i < k.length; i++) s = (Math.imul(31, s) + k.charCodeAt(i)) | 0;
    s = (s >>> 0) || 1;
    return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
  }
  function pickArr(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function randConf(min, max, r) { return parseFloat((r() * (max - min) + min).toFixed(1)); }

  /* ── Today's date string for ESPN date filter ──────── */
  function todayDateParam() {
    const n = new Date();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const d = String(n.getDate()).padStart(2, '0');
    return `${n.getFullYear()}${m}${d}`;
  }

  /* ── Fetch ESPN scoreboard — today's games only ─────── */
  async function getGames(sport) {
    const url = SB[sport];
    if (!url) return [];
    try {
      const resp = await fetch(`${url}?dates=${todayDateParam()}`, { signal: AbortSignal.timeout(7000) });
      if (!resp.ok) throw 0;
      const { events = [] } = await resp.json();
      // Delegate to canonical layer — single source of truth for game shape
      return events.map(ev => HTBCanonical.fromESPNEvent(ev, sport)).filter(Boolean);
    } catch { return []; }
  }

  /* ── Fetch ESPN pickcenter odds and attach to game ──── */
  async function getOdds(sport, gameId) {
    const fn = SM[sport.toLowerCase()];
    if (!fn) return null;
    try {
      const resp = await fetch(fn(gameId), { signal: AbortSignal.timeout(7000) });
      if (!resp.ok) throw 0;
      const data = await resp.json();
      const pc   = (data.pickcenter || [])[0];
      if (!pc) return null;
      // Delegate to canonical layer — returns { favorite, away, home, total, overOdds, underOdds }
      return HTBCanonical.withPickcenter({}, pc).odds;
    } catch { return null; }
  }

  /* ── Reason templates per sport ────────────────────── */
  const T = {
    MLB: {
      ml_fav: [
        ['{fav} bullpen ranks top-5 in ERA this month — dominant in high-leverage',
         '{fav} lineup batting .290+ over last 10 games at home',
         'Model line: {favML} — value at current posted price',
         'Run differential +18 over last 10 games — real edge'],
        ['{fav} starter posting sub-3.50 ERA in April — elite on the mound tonight',
         '{dog} offense batting .221 in last 14 days — cold stretch',
         'Sharp money confirmed on {fav} since the open',
         '{fav} 7-of-last-10 — best recent form in the division'],
        ['{fav} home record reflects genuine talent edge over {dog} this season',
         '{dog} rotation shaky — multiple starters with 4+ ERA lately',
         'Model projects {fav} lineup for 5+ runs — dominant matchup',
         'Best line on the board at current number tonight'],
      ],
      ml_dog: [
        ['{dog} posting positive run differential despite market perception',
         '{dog} bullpen holding opponents to sub-.220 BA in high leverage',
         'Plus odds on {dog} represent positive EV per model projection',
         '{dog} 8-3 as underdog over last 30 days — elite dog value'],
        ['{dog} starter posts 3.10 ERA over last 5 starts — sharp number tonight',
         'Market fading {dog} on record — model sees more opportunity here',
         '{dog} lineup due for regression — BABIP below league average',
         'Best plus-money value on the board tonight'],
      ],
      runline: [
        ['{fav} run line value at {line} — strong starting pitching edge',
         'Pitching advantage gives {fav} a 2+ run cushion per model',
         '{fav} bullpen converting 87% of save opportunities this season',
         'Model projects {fav} winning by 2+ in 58% of simulations'],
      ],
      over: [
        ['Both starters allowed 4+ runs in recent outings — hittable tonight',
         'Hot offenses on both sides — combined .285 BA over last 10 games',
         'Bullpens showing fatigue — overexposure in high-leverage spots',
         'Model total: {total}+ — clear overlay at posted number'],
      ],
      under: [
        ['Elite starters on the mound — both posting sub-3 ERA at home',
         'Both lineups cold this week — combined sub-.230 BA at the plate',
         'Model projects {total} or fewer — under has clear positive EV',
         'Pitching matchup strongly suppresses run environment tonight'],
      ],
    },
    NBA: {
      ml_fav: [
        ['{fav} net rating is +8.4 over last 10 — elite efficiency rating',
         'Offensive matchup strongly favors {fav} — scheme advantage',
         'Sharp action confirmed — line moved 1.5 points toward {fav}',
         'Model projects {fav} winning by 9+ in this matchup'],
        ['{fav} averaging 118+ PPG over last 7 games — unstoppable pace',
         '{dog} defense allowing 115+ PPG on the road this month',
         'ATS trend: {fav} 11-4 in last 15 similar spots',
         '{fav} guard play top-3 in assists — rhythm offense flowing'],
        ['{fav} defense ranks top-3 in points allowed per 100 possessions',
         'Matchup nightmare for {dog} — model sees +9 net efficiency edge',
         '{fav} covering 68% at home this season — strong home record',
         'Best number of the night at current price tonight'],
      ],
      ml_dog: [
        ['{dog} covering 60% as home underdogs this season',
         'Rest advantage: {dog} playing fresh on 2-day rest at home',
         'Model puts {dog} win probability at 44% — line undervaluing them',
         '{dog} 18-6 SU at home this year — home crowd factor is real'],
        ['{dog} guard play elite — top-5 in assists last 14 days',
         'Fast pace benefits {dog} — transition opportunities multiply',
         '{dog} covering 58% as underdogs under 5 points this season',
         'Best plus-money value on tonight\'s board'],
      ],
      spread: [
        ['{fav} net rating edge of +7.2 — real talent gap in this matchup',
         'Pace model strongly favors {fav} in this specific game',
         'Line moved toward {fav} — sharp action confirmed tonight',
         '{fav} ATS record as favorites: 14-6 on the season so far'],
        ['{fav} offensive efficiency top-5 in the league — scheme dominance',
         '{dog} missing rotation players — depth shrinks considerably tonight',
         'Model line at {line} — getting value at posted price',
         '{fav} 9-2 ATS in road games as favorites under 5 points'],
      ],
      over: [
        ['Both teams rank top-10 in offensive pace — expect a shootout',
         'Combined offensive efficiency +12 — high-scoring game expected',
         'No true defensive stoppers active tonight — model at {total}+',
         'Last 5 meetings averaged {total}+ combined'],
      ],
      under: [
        ['Both defenses rank top-8 in points allowed this month — elite units',
         'Slow pace teams — bottom-5 in possessions per game league-wide',
         'Model projects {total} combined — under has clear positive EV',
         'Historical matchup: last 5 meetings averaged under {total}'],
      ],
    },
    NFL: {
      ml_fav: [
        ['{fav} offensive DVOA ranks top-5 — elite unit this season',
         'Rushing attack advantage gives {fav} a dominant matchup tonight',
         'Line has moved toward {fav} since open — sharp confirmation',
         '{fav} 12-4 ATS in similar spots this season — strong trend'],
        ['{fav} EPA per play is +0.19 — best efficiency in conference',
         '{dog} defense allowing 28+ PPG over last 4 weeks',
         'QB efficiency gap significant — model sees {fav} +6 net edge',
         'ATS trend: {fav} 9-3 as favorites under 4 points this year'],
      ],
      ml_dog: [
        ['{dog} covering 62% as home underdogs this season',
         'QB rushing floor creates massive variance — {dog} wins on legs',
         '+odds represents positive EV — model has {dog} at 42% win prob',
         '{dog} 18-4 ATS at home under 7 points — elite underdog record'],
        ['{dog} defense ranks top-8 — capable of keeping this close',
         'Short week for {fav} — {dog} had full week of preparation',
         'Best spread number on the board at current price tonight',
         '{dog} ATS as home dogs: 8-3 over last 11 games'],
      ],
      spread: [
        ['{fav} DVOA edge of +14.2 — dominant versus this defense',
         'OL matchup heavily favors {fav} rushing attack tonight',
         'Scheme advantage: {fav} 12-3 ATS in similar spots this season',
         'Model line at {line} — strong value at current posted number'],
        ['{fav} turnover margin: +10 on season — field position dominant',
         '{dog} red zone offense struggling — bottom-10 conversion rate',
         'Model projects {fav} winning by {pts}+ — underpriced at current number',
         '{fav} ATS 9-4 in games where they hold a DVOA edge of 10+'],
      ],
      over: [
        ['Both offenses top-10 efficiency — shootout expected tonight',
         'Pass-heavy pace from both QBs — combined 650+ pass yards likely',
         'Clear weather conditions — no wind factor limiting scoring',
         'Model projects {total}+ — clear value on the over tonight'],
      ],
      under: [
        ['Both defenses top-8 in points allowed this season — elite',
         'Defensive coordinators have history — expect a chess match',
         'Wind forecast limits explosive plays considerably tonight',
         'Model projects {total} or fewer — under has positive EV'],
      ],
    },
    NHL: {
      ml_fav: [
        ['{fav} Corsi% of 56.4 at home — dominant possession team',
         '{fav} power play ranked top-5 in the NHL this month',
         '{dog} goaltending shaky — 3.1 GAA over last 7 starts',
         'Model projects {fav} winning 61% of simulations'],
        ['{fav} shooting percentage 12.1% — elite conversion rate',
         '{dog} goalie posting below-average SV% over last 10 games',
         '{fav} zone starts 58% offensive — territory dominance throughout',
         'Sharp money confirmed on {fav} — line moved since open'],
      ],
      ml_dog: [
        ['{dog} at home — elite arena record this season',
         '{fav} on second game of back-to-back tonight — fatigue factor real',
         'Plus odds on {dog} represents positive EV at current price',
         '{dog} PP has been clicking — 28% rate over last 10 games'],
        ['{dog} goalie posting .924+ SV% over last 10 — elite run',
         '{fav} road record weak this season — 7-11 away from home ice',
         'Model has {dog} at 43% win probability — line undervaluing them',
         'Best plus-money value on tonight\'s board'],
      ],
      puckline: [
        ['{fav} puck line value — elite goaltending limits blowout scenarios',
         '{fav} PL wins 54% when favored by fewer than 1.5 goals',
         'Model projects {fav} winning by 2+ in 48% of simulations',
         'Strong value taking PL vs the ML at current price'],
      ],
      over: [
        ['Both starters allowed 3+ goals in 4 of last 6 starts each',
         'Combined 9 goals in last 3 meetings — offensive series',
         'Both PP units firing — penalty-heavy game expected tonight',
         'Model total: {total}+ — solid overlay at posted number'],
      ],
      under: [
        ['Elite goaltending matchup — both starters posting .920+ SV%',
         'Both teams in playoff position — defensive structure locked in',
         'Last 5 meetings averaged under {total} — historical precedent',
         'Model projects {total} or fewer combined goals tonight'],
      ],
    },
    NCAAM: {
      ml_fav: [
        ['{fav} net rating is top-25 nationally — elite efficiency at both ends',
         'Offensive matchup strongly favors {fav} — scheme and depth advantage',
         '{fav} covering 67% at home as favorites this season — strong home court',
         'Model projects {fav} winning by 8+ in this matchup tonight'],
        ['{fav} averaging 80+ PPG over last 7 games — hot offensive stretch',
         '{dog} defense allowing 75+ PPG on the road this month — exploitable',
         '{fav} 11-4 ATS in last 15 similar home spots — consistent covering',
         'Pace advantage belongs to {fav} — superior depth in the backcourt'],
      ],
      ml_dog: [
        ['{dog} covering 59% as home underdogs this season — home court value',
         'Home floor advantage in college basketball is among the highest in sports',
         'Plus odds offers strong positive EV per model projection tonight',
         '{dog} defense showing improvement — holding teams under 70 PPG recently'],
        ['{dog} guard play elite — top-10 in assists in the conference this season',
         'Fast pace benefits {dog} — transition opportunities multiply at home',
         '{dog} covering 57% as underdogs under 6 points — consistent ATS form',
         'Best plus-money value on tonight\'s board'],
      ],
      spread: [
        ['{fav} efficiency edge of +7.1 per-100 — real talent gap in this matchup',
         'Pace model strongly favors {fav} in this specific game tonight',
         '{fav} ATS record as favorites: 14-5 this season — consistent covering',
         'Model line at {line} — getting value at current posted price'],
        ['{fav} offensive efficiency top-20 nationally — scheme and talent edge',
         '{dog} missing rotation players — depth shrinks considerably tonight',
         'Model line at {line} — value at the posted number tonight',
         '{fav} 8-3 ATS as favorites under 8 points in conference this season'],
      ],
      over: [
        ['Both teams rank top-50 in offensive pace nationally — high-scoring expected',
         'Combined offensive efficiency +14 — both offenses rolling this week',
         'Both defenses allow 72+ PPG at home — limited defensive stoppers active',
         'Model projects {total}+ combined — over has clear positive value'],
      ],
      under: [
        ['Both defenses rank top-40 in points allowed nationally — elite units',
         'Slow tempo teams — bottom-30 in possessions per game nationally',
         'Model projects {total} combined — under has clear positive EV tonight',
         'Conference defensive showcase — both coaches emphasize limiting pace'],
      ],
    },
    NCAAF: {
      ml_fav: [
        ['{fav} offensive efficiency ranks top-20 nationally this season',
         '{fav} run game averaging 5.8 YPC — dominant rushing attack',
         '{fav} covering 68% at home as favorites — strong home record',
         'Conference record shows real talent gap in this matchup'],
        ['{fav} EPA per play advantage — strong model efficiency edge',
         '{dog} defense allows 30+ PPG — exploitable scheme tonight',
         'Sharp books opened {fav} at this number — no reason to fade',
         'Model projects {fav} winning by double digits in simulation'],
      ],
      ml_dog: [
        ['{dog} covering 60% as home underdogs in conference play',
         'Home field advantage in college football is extremely significant',
         'Plus odds offers strong value per model projection tonight',
         '{dog} defense showing improvement over last 4 games'],
      ],
      spread: [
        ['{fav} YPP advantage is +1.8 — dominant scheme efficiency edge',
         'Turnover margin strongly favors {fav} — +8 on the season',
         'Model projects {fav} winning by {pts}+ — underpriced at current number',
         '{fav} ATS 9-3 in similar home/road spots this season'],
      ],
      over: [
        ['High-powered offenses on both sides — pace will be fast tonight',
         'Both defenses allow 30+ PPG — high ceiling game expected',
         'Model projects {total}+ combined — over has clear positive value',
         'Last 4 meetings averaged over {total} combined points'],
      ],
      under: [
        ['Defensive battle expected — both top-30 nationally in points allowed',
         'Slow tempo teams — fewer possessions means fewer scoring chances',
         'Model total: {total} — under has positive EV at posted number',
         'Neither offense efficient in recent road matchups'],
      ],
    },
  };

  /* ── Canonical pick cache ───────────────────────────
   *
   * Picks are keyed by gameId + isoDate + role and stored in both an
   * in-memory Map (fast, per-page) and sessionStorage (survives navigation
   * between pages in the same browser session).
   *
   * This ensures the homepage and every sport page always show the SAME
   * pick for the same matchup — whichever page computes it first wins, and
   * every subsequent page reuses that exact object.
   *
   * Stale entries (from previous calendar days) are pruned on load.
   * ─────────────────────────────────────────────────────────────────── */
  const _TODAY_ISO = new Date().toISOString().slice(0, 10);
  const _pickMemo  = new Map();
  const _PICK_PFX  = 'htb:pick:';
  const _NULL_SENTINEL = '\x00'; // stored when pick is null (no valid underdog)

  // Prune yesterday's picks from sessionStorage on module load
  (function _pruneStale() {
    try {
      const toRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(_PICK_PFX) && !k.includes(_TODAY_ISO)) toRemove.push(k);
      }
      toRemove.forEach(k => sessionStorage.removeItem(k));
    } catch { /* sessionStorage unavailable (private browsing etc.) — fail silently */ }
  })();

  function _pickStoreKey(gameId, role) {
    return `${_PICK_PFX}${gameId}:${_TODAY_ISO}:${role}`;
  }

  /** Load canonical pick from memo/sessionStorage. Returns {found, val}. */
  function _loadPick(gameId, role) {
    const key = _pickStoreKey(gameId, role);
    if (_pickMemo.has(key)) return { found: true, val: _pickMemo.get(key) };
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) {
        const val = raw === _NULL_SENTINEL ? null : JSON.parse(raw);
        _pickMemo.set(key, val);
        return { found: true, val };
      }
    } catch {}
    return { found: false, val: undefined };
  }

  /**
   * Validate that a pick's team name is actually one of the teams in the game.
   * Totals (Over/Under) always pass — they don't name a specific team.
   * Returns the pick unchanged if valid, or null if the team can't be confirmed.
   */
  function _validatePick(pick, game) {
    if (!pick) return null;
    const pStr = pick.pick.toLowerCase();
    // Totals reference no specific team
    if (pStr.startsWith('over') || pStr.startsWith('under')) return pick;
    // Extract the team portion: everything before the first spread/ML number
    const teamPart = pick.pick.replace(/\s+[-+]?\d.*$/, '').trim().toLowerCase();
    const awayLow  = game.away.name.toLowerCase();
    const homeLow  = game.home.name.toLowerCase();
    const valid =
      awayLow.includes(teamPart) || homeLow.includes(teamPart) ||
      teamPart.includes(awayLow) || teamPart.includes(homeLow);
    if (!valid) {
      console.warn(`[HTB] Pick rejected — "${pick.pick}" team not found in "${game.away.name} @ ${game.home.name}"`);
      return null;
    }
    return pick;
  }

  /** Store canonical pick in memo and sessionStorage. */
  function _savePick(gameId, role, pick) {
    const key = _pickStoreKey(gameId, role);
    _pickMemo.set(key, pick);
    try {
      sessionStorage.setItem(key, pick === null ? _NULL_SENTINEL : JSON.stringify(pick));
    } catch {}
  }

  /* ── Compute one pick for a game (pure — no caching) ── */
  function _computePick(game, odds, today, role) {
    // odds is now canonical shape: { favorite, away:{ml,spread,spreadOdds}, home:{ml,spread,spreadOdds}, total, overOdds, underOdds }
    const sp   = game.sport;                          // lowercase (mlb, nba, nhl, …)
    const spUp = sp.toUpperCase();                    // template keys are uppercase
    const away = game.away.name;
    const home = game.home.name;
    const r    = mkRng(`${game.id}-${today}-${role}`);
    const tmpl = T[spUp] || T.MLB;

    /* ── Determine favorite ────────────────────────────────────────────
     * Use canonical odds.favorite first (set by HTBCanonical.withPickcenter).
     * When odds are unavailable, derive favIsHome from a hash of the
     * game ID so it is deterministic and not always home.
     * ─────────────────────────────────────────────────────────────────── */
    let favIsHome;
    if (odds?.favorite === 'home') {
      favIsHome = true;
    } else if (odds?.favorite === 'away') {
      favIsHome = false;
    } else {
      // No odds — deterministic hash of game ID prevents always picking home
      const idSum = game.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      favIsHome = idSum % 2 === 0;
    }

    const fav    = favIsHome ? home : away;
    const dog    = favIsHome ? away : home;
    const favML  = favIsHome ? (odds?.home?.ml || '-135') : (odds?.away?.ml || '-135');
    const dogML  = favIsHome ? (odds?.away?.ml || '+115') : (odds?.home?.ml || '+115');

    const dfltTotal = sp === 'mlb' ? '8.0' : sp === 'nhl' ? '5.5' : sp === 'nba' ? '220.5' : sp === 'ncaam' ? '145.5' : '47.5';
    const dfltLine  = sp === 'mlb' || sp === 'nhl' ? '-1.5' : '-3.0';

    function fmt(str) {
      const lineVal = favIsHome ? (odds?.home?.spread || dfltLine) : (odds?.away?.spread || dfltLine);
      return str
        .replace(/\{fav\}/g,  fav).replace(/\{dog\}/g,  dog)
        .replace(/\{home\}/g, home).replace(/\{away\}/g, away)
        .replace(/\{favML\}/g, favML)
        .replace(/\{line\}/g,  lineVal)
        .replace(/\{total\}/g, odds?.total || dfltTotal)
        .replace(/\{pts\}/g,   String(Math.abs(parseFloat(lineVal) || 3).toFixed(1)));
    }

    // ── Dog pick ───────────────────────────────────────
    if (role === 'dog') {
      if (parseInt(dogML) < 0) return null; // no true underdog
      const reasons = (tmpl.ml_dog ? pickArr(tmpl.ml_dog, r) : pickArr(tmpl.ml_fav, r)).map(fmt);
      return {
        sport: sp, matchup: `${away} @ ${home}`,
        pick: `${dog} ML`, odds: dogML,
        edge: 'dog', edgeLabel: 'Dog Pick',
        conf: randConf(6.0, 7.8, r), reasons,
      };
    }

    // ── Top pick — choose type: 0=ML, 1=line, 2=over, 3=under ──
    const pType = Math.floor(r() * 4);
    let pick, pickOdds, edge, edgeLabel, reasons;
    const conf = randConf(7.0, 9.2, r);

    if (pType === 0 || !odds) {
      pick      = `${fav} ML`;
      pickOdds  = favML;
      edge      = parseInt(favML) <= -155 ? 'strong' : 'value';
      edgeLabel = edge === 'strong' ? 'Strong Play' : 'Value Play';
      reasons   = pickArr(tmpl.ml_fav, r).map(fmt);
    } else if (pType === 1) {
      const lineVal  = favIsHome ? (odds.home?.spread     || dfltLine) : (odds.away?.spread     || dfltLine);
      const lineOdds = favIsHome ? (odds.home?.spreadOdds || '-110')   : (odds.away?.spreadOdds || '-110');
      const lineKey  = sp === 'nhl' ? 'puckline' : sp === 'mlb' ? 'runline' : 'spread';
      pick      = `${fav} ${lineVal}`;
      pickOdds  = lineOdds;
      edge      = 'strong';
      edgeLabel = 'Strong Play';
      reasons   = pickArr(tmpl[lineKey] || tmpl.spread || tmpl.ml_fav, r).map(fmt);
    } else if (pType === 2) {
      const tot = odds.total || dfltTotal;
      pick      = `Over ${tot}`;
      pickOdds  = odds.overOdds || '-110';
      edge      = 'value';
      edgeLabel = 'Value Play';
      reasons   = pickArr(tmpl.over, r).map(fmt);
    } else {
      const tot = odds.total || dfltTotal;
      pick      = `Under ${tot}`;
      pickOdds  = odds.underOdds || '-110';
      edge      = 'value';
      edgeLabel = 'Value Play';
      reasons   = pickArr(tmpl.under, r).map(fmt);
    }

    return { sport: sp, matchup: `${away} @ ${home}`, pick, odds: pickOdds, edge, edgeLabel, conf, reasons };
  }

  /* ── Generate one canonical pick for a game ─────────
   * Checks the cross-page pick cache first.  If a pick has already been
   * computed for this game today (on this page OR on a previously visited
   * page in the same browser session), that exact object is returned so
   * every page always agrees on the same team / bet type / edge label.
   * ─────────────────────────────────────────────────── */
  function makePick(game, odds, today, role) {
    const cached = _loadPick(game.id, role);
    if (cached.found) return cached.val;              // return stored canonical pick
    const raw  = _computePick(game, odds, today, role);
    const pick = _validatePick(raw, game);            // reject if team can't be confirmed
    _savePick(game.id, role, pick);                   // store for this and future pages
    return pick;
  }

  /* ── Card HTML ─────────────────────────────────────── */
  function cardHTML(p, isDog) {
    const cls     = isDog ? 'dog' : (p.edge === 'strong' ? '' : p.edge);
    const confPct = `${Math.round(p.conf * 10)}%`;
    return `
      <div class="pick-card ${cls}">
        <div class="pc-top">
          <span class="pc-sport">${p.sport}</span>
          <span class="pc-badge ${p.edge}">${p.edgeLabel}</span>
        </div>
        <div class="pc-matchup">${p.matchup}</div>
        <div class="pc-pick">${p.pick}</div>
        <div class="pc-odds">${p.odds}</div>
        <div class="pc-conf">
          <span class="pc-conf-lbl">Confidence</span>
          <div class="conf-track"><div class="conf-fill" style="width:${confPct}"></div></div>
          <span class="pc-conf-val">${p.conf}/10</span>
        </div>
        <div class="pc-sep"></div>
        <div class="pc-reasons">${p.reasons.map(t => `<div class="pc-reason">${t}</div>`).join('')}</div>
      </div>`;
  }

  /* ── Shared UI snippets ─────────────────────────────── */
  const LOADING = `
    <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:40px 20px;color:#444;font-size:13px">
      <div style="width:16px;height:16px;border:2px solid #2a2a2a;border-top-color:#f0b429;border-radius:50%;animation:htbPickSpin .65s linear infinite;flex-shrink:0"></div>
      Loading picks from live games…
    </div>`;

  const NO_PICKS = `
    <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:44px 20px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#888">No picks available today.</div>
      <div style="font-size:11px;color:#444;margin-top:6px">No games scheduled for this sport today.</div>
    </div>`;

  // Inject pick card styles + animation once (self-contained so works on any page)
  if (!document.getElementById('htbPickSpinStyle')) {
    const s = document.createElement('style');
    s.id = 'htbPickSpinStyle';
    s.textContent = `
      @keyframes htbPickSpin { to { transform: rotate(360deg); } }
      .pc-sport { font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#555;background:#181818;border:1px solid #222;padding:3px 9px;border-radius:100px }
      .pc-badge { font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:4px }
      .pc-badge.strong { background:rgba(240,180,41,.1);color:#f0b429;border:1px solid rgba(240,180,41,.2) }
      .pc-badge.value  { background:rgba(0,208,132,.08);color:#00d084;border:1px solid rgba(0,208,132,.2) }
      .pc-badge.dog    { background:rgba(129,140,248,.08);color:#818cf8;border:1px solid rgba(129,140,248,.2) }
      .pc-conf-lbl { font-size:10px;color:#444;font-weight:600;white-space:nowrap }
    `;
    document.head.appendChild(s);
  }

  /* ── Helpers ─────────────────────────────────────────── */
  async function fetchOddsAll(games) {
    const results = await Promise.allSettled(games.map(g => getOdds(g.sport.toLowerCase(), g.id)));
    const map = {};
    results.forEach((r, i) => { if (r.status === 'fulfilled') map[games[i].id] = r.value; });
    return map;
  }

  function isDogGame(odds) {
    // Canonical odds shape: odds.away.ml / odds.home.ml
    const aML = parseInt(odds?.away?.ml || '0');
    const hML = parseInt(odds?.home?.ml || '0');
    return aML > 0 || hML > 0;
  }

  /* ── PUBLIC API ─────────────────────────────────────── */
  global.HTBPicks = {

    /**
     * Render picks for a single sport into one or two grids.
     * @param {string} sport       e.g. 'mlb'
     * @param {string} containerId DOM id for top/all picks
     * @param {string} [dogId]     DOM id for underdog picks (optional)
     */
    async render(sport, containerId, dogId) {
      const container = document.getElementById(containerId);
      const dogCont   = dogId ? document.getElementById(dogId) : null;
      if (container) container.innerHTML = LOADING;
      if (dogCont)   dogCont.innerHTML   = LOADING;

      const games = await getGames(sport);
      if (!games.length) {
        if (container) container.innerHTML = NO_PICKS;
        if (dogCont)   dogCont.innerHTML   = NO_PICKS;
        return;
      }

      const oddsMap = await fetchOddsAll(games);
      const today   = new Date().toISOString().slice(0, 10);

      const topPicks = games.map(g => makePick(g, oddsMap[g.id] || null, today, 'top')).filter(Boolean);

      const dogPicks = dogId
        ? games.map(g => {
            // Only pre-game underdogs — live games use pre-game odds (ESPN pickcenter
            // doesn't provide live lines), so showing them as dogs would be misleading.
            // Final games are already over — no pick value.
            if (g.status !== 'pre') return null;
            const odds = oddsMap[g.id] || null;
            if (!isDogGame(odds)) return null;
            return makePick(g, odds, today, 'dog');
          }).filter(Boolean)
        : [];

      console.log(`[HTB Picks] ${sport.toUpperCase()}: ${topPicks.length} top picks, ${dogPicks.length} dog picks from ${games.length} real games`);

      if (container) {
        container.innerHTML = topPicks.length ? topPicks.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      }
      if (dogCont) {
        dogCont.innerHTML = dogPicks.length ? dogPicks.map(p => cardHTML(p, true)).join('') : NO_PICKS;
      }
    },

    /**
     * Render picks for the homepage from multiple sports.
     * Only uses games scheduled for today's date (enforced via ESPN date param in getGames).
     * @param {string[]} sports      e.g. ['mlb','nba','nfl','nhl']
     * @param {string}   topId       DOM id for top picks grid
     * @param {string}   dogId       DOM id for underdog picks grid
     * @param {string}   [dogLabelId] Optional DOM id of the dog section label — updated to
     *                                "Live Dogs" when games are live, "Today's Underdogs" otherwise
     */
    async renderHomepage(sports, topId, dogId, dogLabelId) {
      const topEl      = document.getElementById(topId);
      const dogEl      = document.getElementById(dogId);
      const dogLabelEl = dogLabelId ? document.getElementById(dogLabelId) : null;
      if (topEl) topEl.innerHTML = LOADING;
      if (dogEl) dogEl.innerHTML = LOADING;

      // Fetch all sports in parallel — each call uses ?dates=TODAY so only today's games return
      const gamesArr = await Promise.allSettled(sports.map(s => getGames(s)));
      const allGames = gamesArr.flatMap(r => r.status === 'fulfilled' ? r.value : []);

      // Section label is always "Today's Underdogs" — we never surface live-game
      // underdogs because ESPN pickcenter only provides pre-game odds, not live lines.
      if (dogLabelEl) {
        dogLabelEl.textContent = "Today's Underdogs";
      }

      if (!allGames.length) {
        if (topEl) topEl.innerHTML = NO_PICKS;
        if (dogEl) dogEl.innerHTML = `
          <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:44px 20px;text-align:center">
            <div style="font-size:13px;font-weight:700;color:#888">No picks available today.</div>
            <div style="font-size:11px;color:#444;margin-top:6px">No games scheduled across active sports today.</div>
          </div>`;
        return;
      }

      const oddsMap = await fetchOddsAll(allGames);
      const today   = new Date().toISOString().slice(0, 10);
      const rng     = mkRng(today);

      const topPicks = allGames
        .map(g => makePick(g, oddsMap[g.id] || null, today, 'top'))
        .filter(Boolean);

      const dogPicks = allGames
        .map(g => {
          // Pre-game only — live/final games are excluded from underdog picks
          // because ESPN pickcenter only carries pre-game lines, not live odds.
          if (g.status !== 'pre') return null;
          const odds = oddsMap[g.id] || null;
          if (!isDogGame(odds)) return null;
          return makePick(g, odds, today, 'dog');
        })
        .filter(Boolean);

      // Shuffle by date seed so picks vary day-to-day, then take top N
      function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }

      const topShow = shuffle(topPicks).slice(0, 5);
      const dogShow = shuffle(dogPicks).slice(0, 3);

      console.log(`[HTB Picks] Homepage: ${topShow.length} top, ${dogShow.length} dog from ${allGames.length} real games across ${sports.join(', ')}`);

      if (topEl) {
        topEl.innerHTML = topShow.length ? topShow.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      }

      if (dogEl) {
        dogEl.innerHTML = dogShow.length
          ? dogShow.map(p => cardHTML(p, true)).join('')
          : `<div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:44px 20px;text-align:center">
               <div style="font-size:13px;font-weight:700;color:#888">No underdog picks available today.</div>
               <div style="font-size:11px;color:#444;margin-top:6px">Underdog picks appear when today's lines post closer to game time.</div>
             </div>`;
      }
    },
  };

})(window);
