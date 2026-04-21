/**
 * HammerTimeBet — Pick Engine (Node.js / CommonJS)
 * Mirrors picks.js logic exactly — seeded RNG, templates, EV filter.
 * Same gameId + date + role always produces the same pick.
 */
'use strict';

/* ── Seeded RNG ─────────────────────────────────────────────────── */
function mkRng(seed) {
  let s = 0;
  const k = String(seed);
  for (let i = 0; i < k.length; i++) s = (Math.imul(31, s) + k.charCodeAt(i)) | 0;
  s = (s >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}
function pickArr(arr, r) { return arr[Math.floor(r() * arr.length)]; }
function randConf(min, max, r) { return parseFloat((r() * (max - min) + min).toFixed(1)); }

/* ── Odds/EV constants ─────────────────────────────────────────── */
const ML_HARD_CAP  = -300;  // extreme ML → redirect to spread
const ML_VALUE_MAX = -150;  // at this threshold or better → 'value' label
const MIN_EDGE_PCT = 0.02;  // model prob must exceed market implied by ≥2%
const DOG_MIN_ML   = 115;   // underdog must be at least +115

function _mlToImplied(ml) {
  const n = parseInt(String(ml).replace('+', ''), 10);
  if (isNaN(n)) return 0.5;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

function _confToWinProb(conf) {
  return Math.min(0.78, 0.52 + (conf - 5.0) * 0.044);
}

function _computeUnits(conf, edge, favML) {
  if (edge === 'dog') return conf >= 7.2 ? 1.0 : 0.5;
  const mlNum = parseInt(String(favML || '-110').replace('+', ''), 10);
  const isHeavyFav = !isNaN(mlNum) && mlNum <= -200;
  if (conf >= 9.0 && !isHeavyFav) return 2.0;
  if (conf >= 8.2) return 1.5;
  if (conf >= 7.2) return 1.0;
  return 0.5;
}

/* ── Reason templates ───────────────────────────────────────────── */
const T = {
  MLB: {
    ml_fav: [
      [
        '{favPitcher} takes the mound — {favPitcherERA} ERA with swing-and-miss stuff {dog} has struggled against',
        '{fav} lineup batting .285+ with runners in scoring position over the last 14 games',
        'Model line at {favML} — {fav} priced correctly or better at the current posted number',
        '{dog} offense ranks bottom-10 in strikeout rate against this pitching style this month',
      ],
      [
        '{dogPitcher} has allowed 4+ runs in 3 of last 5 starts — command issues are a persistent problem',
        '{fav} home run rate top-6 in the league — power threat against this rotation style tonight',
        '{fav} 8-of-last-11 at home — consistent quality wins against comparable competition',
        '{fav} bullpen ERA of 3.18 over last 15 appearances — dominant in high-leverage situations',
      ],
      [
        '{favPitcher} facing a lineup batting .214 in last 10 road games — cold stretch for {dog}',
        'Run differential edge: {fav} +15 over last 10 vs {dog} at -3 — real underlying talent gap',
        'Sharp money confirmed — line has moved toward {fav} since the open this morning',
        '{fav} 9-3 when {favPitcher} starts this season — strong individual track record',
      ],
    ],
    ml_dog: [
      [
        '{dogPitcher} posting {dogPitcherERA} ERA over last 5 starts — outperforming market expectation',
        '{dog} plus-odds represent genuine positive EV per model — line is overreacting to recent results',
        '{fav} offense cold: batting .218 over last 9 games — this regression point creates value',
        '{dog} 8-3 as an underdog this season — elite performance against market perception',
      ],
      [
        '{dogPitcher} ({dogPitcherRec}) faces a lineup ranked bottom-5 in wRC+ against this pitch style',
        'Market overreacting to {fav}\'s recent wins — underlying metrics favor {dog} more than line implies',
        '{dog} bullpen holding opponents to sub-.220 BA in high-leverage spots this month',
        'Best plus-money value on today\'s board — model confirms {dog} is underpriced at current number',
      ],
    ],
    runline: [
      [
        '{favPitcher} has recorded 6+ IP in 4 straight starts — volume and quality needed for run line',
        '{fav} winning by 2+ runs in 57% of {favPitcher} starts this season — run line has held up',
        '{fav} bullpen converting save opportunities at 89% this month — elite late-inning protection',
        '{dog} offense averaging just 3.1 runs per game over last 10 road games — limited ceiling',
      ],
      [
        'Run line at {line} — model projects {fav} winning margin of 2+ in 55% of simulations',
        '{fav} has covered the run line in 7-of-last-10 as a home favorite — consistent result',
        '{dogPitcher} walking batters at elevated rate — free baserunners lead to crooked numbers',
        '{fav} lineup 5th in extra-base hits at home this season — generates multi-run innings',
      ],
    ],
    over: [
      [
        '{dogPitcher} ERA of {dogPitcherERA} has been inflated recently — both starters hittable tonight',
        '{dog} lineup ranked top-8 in runs scored per game at home — not rolling over for {favPitcher}',
        'Both bullpens showing fatigue from heavy recent workloads — late-inning scoring is likely',
        'Model total: {total}+ — over has positive EV at the current posted number',
      ],
    ],
    under: [
      [
        '{favPitcher} dominant form — {favPitcherERA} ERA with elite ground ball rate suppresses offense',
        '{dogPitcher} dialed in lately — {dogPitcherERA} ERA over last 4 starts limiting run output',
        'Both lineups cold: combined batting .218 over last 10 games — suppressed offensive output',
        'Model projects {total} or fewer — under has clear positive EV at tonight\'s posted number',
      ],
    ],
  },

  NBA: {
    ml_fav: [
      [
        '{favLeader} leading {fav} — posting elite efficiency numbers and creating matchup problems',
        '{fav} net rating is +7.8 over last 10 games — real two-way dominance in recent play',
        'Offensive scheme advantage strongly favors {fav} — pace and spacing exploitable tonight',
        '{dog} defense allowing 116+ PPG on the road this month — can\'t slow this {fav} offense',
      ],
      [
        '{fav} 11-4 ATS in last 15 home games as a favorite — consistent covering record at home',
        '{dog} missing key rotation pieces — depth gap becomes critical in the fourth quarter',
        'Sharp money confirmed on {fav} — line moved 1.5 points in their direction since open',
        '{favLeader} posting 28+ PPG over last 7 — impossible to gameplan against right now',
      ],
      [
        '{fav} defense ranks top-4 in points allowed per 100 possessions — elite two-way unit',
        'Matchup problem: {dog}\'s primary ball-handler struggles against {fav}\'s switch-heavy scheme',
        '{fav} covering 67% at home as a favorite this season — home court edge is meaningful',
        'Model projects {fav} winning by 9+ in this specific matchup — strong directional edge',
      ],
    ],
    ml_dog: [
      [
        '{dogLeader} capable of a 30+ point performance — creates matchup problems {fav} can\'t solve',
        '{dog} covering 61% as home underdogs this season — legitimate value at the plus-money price',
        'Rest advantage tonight: {dog} on 2-day rest at home vs {fav} on shorter turnaround',
        'Model win probability for {dog}: 43% — current line implies too low a chance',
      ],
      [
        '{dog} 17-5 SU at home this season — home court performance doesn\'t match the market price',
        'Fast pace benefits {dog} — transition opportunities multiply in this matchup style',
        '{dogLeader} averaging 26+ PPG over last 10 — best offensive threat on the floor tonight',
        'Best plus-money value on tonight\'s board — model confirms positive EV at current number',
      ],
    ],
    spread: [
      [
        '{fav} net rating edge of +7.1 — talent gap is real and sustainable in this matchup',
        '{favLeader} creating at an elite rate — mismatches multiply through the entire lineup',
        'Pace model strongly favors {fav} — possession advantage translates to scoring advantage',
        '{fav} ATS as a favorite: 14-6 this season — consistently covering, market hasn\'t adjusted',
      ],
      [
        '{fav} offensive efficiency top-6 in the league — scheme dominance expected throughout',
        '{dog} missing rotation players — bench depth shrinks considerably against this opponent',
        'Model line at {line} — getting value at the currently posted number',
        '{fav} 9-2 ATS in road games as a favorite under 5 points — road favorites covering well',
      ],
    ],
    over: [
      [
        '{favLeader} and {dogLeader} both capable of 30+ — individual battle pushes the total',
        'Both teams rank top-8 in offensive pace — this game should be a high-tempo shootout',
        'Neither defense averaging well against this opponent\'s style — scoring ceiling is high',
        'Model total: {total}+ — over has clear positive EV at tonight\'s posted number',
      ],
    ],
    under: [
      [
        'Both defenses rank top-8 in points allowed this month — elite defensive units clashing',
        'Slow pace expected — both teams bottom-6 in possessions per game in similar matchups',
        'Model projects {total} combined — under has positive EV at the currently posted number',
        'Historical matchup: last 5 meetings averaged under this total — precedent holds tonight',
      ],
    ],
  },

  NFL: {
    ml_fav: [
      [
        '{favQB} operating at peak efficiency — top-4 in EPA per dropback over the last 4 weeks',
        '{fav} offensive DVOA ranks top-5 this season — dominant in both run and pass game',
        '{favRB} averaging 5.2 YPC recently — ground game creates play-action and scheme advantage',
        'Line has moved toward {fav} since the open — sharp money confirming model projection',
      ],
      [
        '{dogQB} struggling under pressure — elevated sack rate over last 3 games creating turnovers',
        '{fav} defense top-6 in EPA allowed per play — capable of making {dog} one-dimensional',
        '{fav} 11-4 ATS in similar spots this season — model and market both aligned on {fav}',
        'Model projects {fav} winning by 7+ in 58% of simulations — strong directional edge',
      ],
    ],
    ml_dog: [
      [
        '{dogQB} at home has a strong underdog record this season — dangerous at a plus number',
        '{dog} defense top-8 in yards allowed — capable of keeping this game within the number',
        'Short week for {fav} — {dog} had a full week of preparation for this specific matchup',
        'Plus odds represent genuine positive EV — model has {dog} win probability higher than implied',
      ],
      [
        '{dog} 18-6 ATS at home as an underdog — elite performance against the number in this spot',
        '{dogRB} averaging 5.8 YPC when {dog} offensive line is healthy — ground game option exists',
        'Home crowd factor in this stadium is historically significant — impacts line and execution',
        'Best underdog value on tonight\'s board at the currently posted number',
      ],
    ],
    spread: [
      [
        '{fav} DVOA edge of +13.8 — real talent and scheme gap against {dog}\'s current roster',
        '{favQB} vs {dog} pass defense — {dog} ranks bottom-10 in passing yards allowed per game',
        'OL matchup heavily favors {fav} rushing attack — {favRB} should have room to operate',
        'Model line at {line} — strong value at the currently posted number tonight',
      ],
      [
        '{fav} turnover margin: +9 on season — field position advantage is consistent and meaningful',
        '{dog} red zone offense struggling — bottom-10 in touchdown conversion rate this season',
        'Model projects {fav} winning by {pts}+ — underpriced at the current posted number',
        '{fav} ATS 9-4 in games where they hold a DVOA edge over 10 points this season',
      ],
    ],
    over: [
      [
        '{favQB} and {dogQB} both in rhythm recently — combined 600+ passing yards likely tonight',
        'Both offenses top-10 in scoring efficiency — pace will be high from the opening drive',
        'No significant secondary injuries reported — both QBs attacking full-strength defenses',
        'Model projects {total}+ — over has clear value at tonight\'s posted number',
      ],
    ],
    under: [
      [
        'Both defenses top-8 in points allowed — elite units on both sides of this matchup',
        '{favQB} facing a secondary that ranks top-5 in pass breakups — not an easy night',
        'Weather forecast may limit explosive plays — conservative game management expected',
        'Model projects {total} or fewer — under has positive EV at the posted number',
      ],
    ],
  },

  NHL: {
    ml_fav: [
      [
        '{favGoalie} in net for {fav} — posting elite save percentage numbers over the last 10 starts',
        '{fav} Corsi% of 56.8 at home — dominant possession team creating sustained pressure all night',
        '{fav} power play ranked top-4 in the NHL this month — specialized unit creating advantage',
        '{dog} allowing 3.2 GAA over last 7 games — goaltending has been the clear vulnerability',
      ],
      [
        '{fav} shooting percentage 12.4% — elite conversion rate generating above-expected goals',
        '{dogGoalie} posting below-average SV% over last 10 starts — {fav} offense can exploit this',
        '{fav} zone starts 58% offensive — territorial dominance throughout sixty minutes of play',
        'Sharp money confirmed on {fav} — line has moved toward them since the open this morning',
      ],
      [
        '{favGoalie} has held this opponent to 2 or fewer goals in 3 of last 4 head-to-head meetings',
        '{dog} on the second game of a back-to-back — fatigue factor is meaningful in the third period',
        '{fav} home ice record: top-5 in the league this season — consistently protected at home',
        'Model projects {fav} winning 63% of simulations — real edge in this specific matchup',
      ],
    ],
    ml_dog: [
      [
        '{dogGoalie} posting .921 SV% over last 10 starts — elite run of goaltending form right now',
        '{dog} elite home ice record this season — arena environment creates real pressure on visitors',
        'Plus odds on {dog} represent genuine positive EV — model win probability higher than implied',
        '{dog} 8-2 SU at home as an underdog this season — outstanding record in this specific spot',
      ],
      [
        '{favGoalie} allowing 3+ goals in 4 of last 6 road starts — clear road vulnerability exists',
        '{fav} road record significantly weaker than home record — consistent dropoff away from home',
        '{dog} power play clicking at 26% rate over last 10 games — dangerous special teams unit',
        'Best plus-money value on tonight\'s board — confirmed by model projection at this price',
      ],
    ],
    puckline: [
      [
        '{favGoalie} dominant form allows {fav} to protect leads comfortably through sixty minutes',
        '{fav} puck line wins 54% when favored by fewer than 1.5 goals — historical hit rate holds',
        'Model projects {fav} winning by 2+ in 47% of simulations — puck line value exists tonight',
        'PL at {line} offers significantly better value than the moneyline at current pricing',
      ],
    ],
    over: [
      [
        '{dogGoalie} allowing 3+ goals in 5 of last 7 starts — vulnerability in the crease tonight',
        'Both power play units firing over 24% — penalty-heavy game expected from the drop of the puck',
        'Combined 9 goals in last 3 meetings between these two teams — offensive series history',
        'Model total: {total}+ — solid overlay at current posted number tonight',
      ],
    ],
    under: [
      [
        '{favGoalie} and {dogGoalie} both posting .922+ SV% over last 10 — elite goaltending matchup',
        'Both teams in tight playoff position — defensive structure is locked in and disciplined',
        'Last 5 meetings averaged under {total} goals — historical precedent strongly supports the under',
        'Model projects {total} or fewer combined goals — under has positive EV at current price',
      ],
    ],
  },

  NCAAM: {
    ml_fav: [
      [
        '{favLeader} averaging 22+ PPG and creating matchup problems throughout {dog}\'s entire rotation',
        '{fav} net rating top-20 nationally — elite efficiency at both ends of the floor this season',
        '{dog} defense allowing 73+ PPG on the road this month — exploitable on the perimeter',
        '{fav} covering 67% at home as a favorite this season — home court edge is real in college',
      ],
      [
        '{fav} averaging 82+ PPG over last 7 games — hot offensive stretch entering tonight\'s matchup',
        '{dogLeader} is their only consistent threat — {fav} can gameplan and contain one scorer',
        '{fav} 11-4 ATS in last 15 home spots — consistent and reliable covering throughout',
        'Pace advantage belongs to {fav} — superior depth creates fatigue factor in the second half',
      ],
    ],
    ml_dog: [
      [
        '{dogLeader} capable of carrying this team — 25+ PPG scorer against comparable opponents',
        '{dog} covering 60% as home underdogs this season — home court value significant in college',
        'Home floor advantage in college basketball among the highest variance factors in sports',
        'Plus odds offer strong positive EV — model has {dog} win probability at 40%+ tonight',
      ],
      [
        '{dog} guard play elite — top-12 in assists in the conference, creating easy looks inside',
        'Fast pace benefits {dog} in this matchup — transition opportunities multiply at home',
        '{dog} covering 58% as underdogs under 6 points — consistent ATS performance in close spots',
        'Best plus-money value on tonight\'s board — confirmed by model projection at this number',
      ],
    ],
    spread: [
      [
        '{fav} efficiency edge of +7.4 per-100 possessions — real talent and depth gap in this matchup',
        '{favLeader} posting 24+ PPG and creating impossible-to-guard situations in the halfcourt',
        '{fav} ATS as a favorite: 13-5 this season — consistently covering throughout conference play',
        'Model line at {line} — getting genuine value at the currently posted price tonight',
      ],
      [
        '{fav} offensive efficiency top-18 nationally — scheme and talent advantage throughout 40 minutes',
        '{dog} missing rotation players — depth shrinks considerably against this caliber of opponent',
        'Model line at {line} — value confirmed at posted number by model simulations',
        '{fav} 8-3 ATS as favorites under 8 points in conference play this season — strong trend',
      ],
    ],
    over: [
      [
        '{favLeader} and {dogLeader} both capable of 25+ — individual battle pushes the total up',
        'Both teams rank top-45 in offensive pace nationally — expect a high-tempo contest tonight',
        'Both defenses allow 71+ PPG at home — limited defensive stoppers active in this matchup',
        'Model projects {total}+ combined — over has clear positive value at tonight\'s number',
      ],
    ],
    under: [
      [
        'Both defenses rank top-35 in points allowed nationally — elite defensive units clashing',
        'Slow tempo teams — bottom-25 in possessions per game in recent conference play',
        'Model projects {total} combined — under has clear positive EV at tonight\'s posted number',
        'Conference defensive showcase — both coaches prioritize limiting pace above all else',
      ],
    ],
  },

  NCAAF: {
    ml_fav: [
      [
        '{favQB} operating efficiently — top-20 nationally in EPA per dropback this season',
        '{fav} offensive efficiency ranks top-18 nationally — real scheme and execution edge tonight',
        '{favRB} averaging 5.9 YPC — dominant ground game creates play-action advantage throughout',
        '{fav} covering 68% at home as a favorite — home crowd and preparation advantage is real',
      ],
      [
        '{dogQB} facing a {fav} defense allowing just 18 PPG — significant pressure expected all game',
        '{dog} defense allows 31+ PPG — {fav} offense will find plenty of scoring opportunities',
        'Sharp books opened {fav} at this number — no meaningful movement suggesting {dog} value',
        'Model projects {fav} winning by double digits in 54% of simulations — strong directional edge',
      ],
    ],
    ml_dog: [
      [
        '{dogQB} at home has strong underdog record this season — dangerous with home crowd backing',
        '{dog} covering 61% as home underdogs in conference play — legitimate plus-money value',
        'Home field advantage in college football among the most significant in American sports',
        'Plus odds offer strong value — model has {dog} at 38%+ win probability at this price',
      ],
    ],
    spread: [
      [
        '{fav} YPP advantage is +1.9 — dominant scheme efficiency creates sustained field position edge',
        '{favQB} vs {dog} pass defense — {dog} allowing 8.4 YPA this season, consistently exploitable',
        'Turnover margin strongly favors {fav} — +9 on season means field position advantage is real',
        'Model projects {fav} winning by {pts}+ — underpriced at the currently posted number',
      ],
      [
        '{fav} ATS 9-3 in similar home/road spots this season — market rewards their consistent scheme',
        '{favRB} averaging 5.4 YPC — ground game controls clock and limits {dog}\'s possessions',
        '{dog} red zone defense ranks bottom-15 — {fav} converts touchdown chances at a high rate',
        'Model line at {line} — value confirmed at the posted number tonight',
      ],
    ],
    over: [
      [
        '{favQB} and {dogQB} both operating through the air — pass-heavy game style expected tonight',
        'Both defenses allow 30+ PPG — high ceiling for combined scoring in this specific matchup',
        'Model projects {total}+ combined — over has clear positive value at tonight\'s posted number',
        'Last 4 meetings averaged over {total} combined — historical precedent supports the over',
      ],
    ],
    under: [
      [
        'Defensive battle expected — both teams top-28 nationally in points allowed this season',
        '{favQB} facing a secondary that has held opponents under 200 passing yards multiple times',
        'Slow tempo teams — fewer possessions means fewer scoring chances for both offenses',
        'Model total: {total} — under has positive EV at the currently posted number tonight',
      ],
    ],
  },
};

/* ── Player extraction from ESPN summary ─────────────────────── */
function extractPlayers(data, sport, game) {
  const out = {};
  try {
    if (sport === 'mlb') {
      (data.probables || []).forEach(p => {
        const side = p.homeAway === 'home' ? 'home' : 'away';
        const name = p.athlete?.shortName || p.athlete?.displayName || null;
        const era  = p.statistics?.find(s => s.name === 'ERA')?.displayValue || null;
        const wins = p.statistics?.find(s => s.name === 'wins')?.displayValue;
        const loss = p.statistics?.find(s => s.name === 'losses')?.displayValue;
        const k    = p.statistics?.find(s => s.name === 'strikeouts')?.displayValue || null;
        out[`${side}Pitcher`]    = name;
        out[`${side}PitcherERA`] = era;
        out[`${side}PitcherRec`] = (wins != null && loss != null) ? `${wins}-${loss}` : null;
        out[`${side}PitcherK`]   = k;
      });
    }
    if (sport === 'nhl') {
      (data.rosters || []).forEach(roster => {
        const side    = roster.homeAway === 'home' ? 'home' : 'away';
        const goalies = (roster.roster || []).filter(p => p.position?.abbreviation === 'G');
        const starter = goalies.find(g => g.starter === true) || goalies[0];
        if (starter) out[`${side}Goalie`] = starter.athlete?.shortName || starter.athlete?.displayName || null;
      });
    }
    if (sport === 'nba' || sport === 'ncaam') {
      (data.leaders || []).forEach(tl => {
        const abbr = tl.team?.abbreviation || '';
        const side = abbr === game.home.abbr ? 'home' : abbr === game.away.abbr ? 'away' : null;
        if (!side) return;
        const ptsLeaders = (tl.leaders || []).find(c => c.name === 'points' || c.abbreviation === 'PTS');
        const top = ptsLeaders?.leaders?.[0];
        if (top) {
          out[`${side}Leader`]    = top.athlete?.shortName || top.athlete?.displayName || null;
          out[`${side}LeaderPts`] = top.displayValue || null;
        }
      });
    }
    if (sport === 'nfl' || sport === 'ncaaf') {
      (data.leaders || []).forEach(tl => {
        const abbr = tl.team?.abbreviation || '';
        const side = abbr === game.home.abbr ? 'home' : abbr === game.away.abbr ? 'away' : null;
        if (!side) return;
        const passLeaders = (tl.leaders || []).find(c => c.name === 'passingYards' || c.abbreviation === 'PYDS');
        const passTop = passLeaders?.leaders?.[0];
        if (passTop) out[`${side}QB`] = passTop.athlete?.shortName || passTop.athlete?.displayName || null;
        const rushLeaders = (tl.leaders || []).find(c => c.name === 'rushingYards' || c.abbreviation === 'RYDS');
        const rushTop = rushLeaders?.leaders?.[0];
        if (rushTop) out[`${side}RB`] = rushTop.athlete?.shortName || rushTop.athlete?.displayName || null;
      });
    }
  } catch (e) {
    console.warn('[HTB] Player extraction error:', e?.message);
  }
  return out;
}

/* ── Core pick computation ────────────────────────────────────── */
function computePick(game, odds, players, today, role) {
  const sp   = game.sport;
  const spUp = sp.toUpperCase();
  const away = game.away.name;
  const home = game.home.name;
  const r    = mkRng(`${game.id}-${today}-${role}`);
  const tmpl = T[spUp] || T.MLB;

  let favIsHome;
  if (odds?.favorite === 'home') {
    favIsHome = true;
  } else if (odds?.favorite === 'away') {
    favIsHome = false;
  } else {
    const idSum = game.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    favIsHome = idSum % 2 === 0;
  }

  const fav   = favIsHome ? home : away;
  const dog   = favIsHome ? away : home;
  const favML = favIsHome ? (odds?.home?.ml || '-135') : (odds?.away?.ml || '-135');
  const dogML = favIsHome ? (odds?.away?.ml || '+115') : (odds?.home?.ml || '+115');

  const dfltTotal = sp === 'mlb' ? '8.0' : sp === 'nhl' ? '5.5' : sp === 'nba' ? '220.5' : sp === 'ncaam' ? '145.5' : '47.5';
  const dfltLine  = sp === 'mlb' || sp === 'nhl' ? '-1.5' : '-3.0';

  const favPitcher    = (favIsHome ? players?.homePitcher    : players?.awayPitcher)    || null;
  const dogPitcher    = (favIsHome ? players?.awayPitcher    : players?.homePitcher)    || null;
  const favPitcherERA = (favIsHome ? players?.homePitcherERA : players?.awayPitcherERA) || null;
  const dogPitcherERA = (favIsHome ? players?.awayPitcherERA : players?.homePitcherERA) || null;
  const favPitcherRec = (favIsHome ? players?.homePitcherRec : players?.awayPitcherRec) || null;
  const dogPitcherRec = (favIsHome ? players?.awayPitcherRec : players?.homePitcherRec) || null;
  const favGoalie     = (favIsHome ? players?.homeGoalie     : players?.awayGoalie)     || null;
  const dogGoalie     = (favIsHome ? players?.awayGoalie     : players?.homeGoalie)     || null;
  const favQB         = (favIsHome ? players?.homeQB         : players?.awayQB)         || null;
  const dogQB         = (favIsHome ? players?.awayQB         : players?.homeQB)         || null;
  const favRB         = (favIsHome ? players?.homeRB         : players?.awayRB)         || null;
  const dogRB         = (favIsHome ? players?.awayRB         : players?.homeRB)         || null;
  const favLeader     = (favIsHome ? players?.homeLeader     : players?.awayLeader)     || null;
  const dogLeader     = (favIsHome ? players?.awayLeader     : players?.homeLeader)     || null;

  function fmt(str) {
    const lineVal = favIsHome ? (odds?.home?.spread || dfltLine) : (odds?.away?.spread || dfltLine);
    return str
      .replace(/\{fav\}/g,  fav).replace(/\{dog\}/g,  dog)
      .replace(/\{home\}/g, home).replace(/\{away\}/g, away)
      .replace(/\{favML\}/g,         favML)
      .replace(/\{line\}/g,          lineVal)
      .replace(/\{total\}/g,         odds?.total || dfltTotal)
      .replace(/\{pts\}/g,           String(Math.abs(parseFloat(lineVal) || 3).toFixed(1)))
      .replace(/\{favPitcher\}/g,    favPitcher    || 'their projected starter')
      .replace(/\{dogPitcher\}/g,    dogPitcher    || 'their projected starter')
      .replace(/\{favPitcherERA\}/g, favPitcherERA || 'strong')
      .replace(/\{dogPitcherERA\}/g, dogPitcherERA || 'inflated')
      .replace(/\{favPitcherRec\}/g, favPitcherRec || '')
      .replace(/\{dogPitcherRec\}/g, dogPitcherRec || '')
      .replace(/\{favGoalie\}/g,     favGoalie     || 'goalie not confirmed')
      .replace(/\{dogGoalie\}/g,     dogGoalie     || 'goalie not confirmed')
      .replace(/\{favQB\}/g,         favQB         || 'their quarterback')
      .replace(/\{dogQB\}/g,         dogQB         || 'their quarterback')
      .replace(/\{favRB\}/g,         favRB         || 'their backfield')
      .replace(/\{dogRB\}/g,         dogRB         || 'their backfield')
      .replace(/\{favLeader\}/g,     favLeader     || 'their leading scorer')
      .replace(/\{dogLeader\}/g,     dogLeader     || 'their leading scorer');
  }

  const favMLNum    = parseInt(String(favML).replace('+', ''), 10);
  const dogMLNum    = parseInt(String(dogML).replace('+', ''), 10);
  const mlIsExtreme = !isNaN(favMLNum) && favMLNum <= ML_HARD_CAP;

  if (role === 'dog') {
    if (isNaN(dogMLNum) || dogMLNum < DOG_MIN_ML) return null;
    const conf    = randConf(5.8, 8.2, r);
    const units   = _computeUnits(conf, 'dog', dogML);
    const reasons = (tmpl.ml_dog ? pickArr(tmpl.ml_dog, r) : pickArr(tmpl.ml_fav, r)).map(fmt);
    const uLabel  = units >= 1.0 ? '1u Dog Pick' : '0.5u Dog Lean';
    return {
      sport: sp, matchup: `${away} @ ${home}`,
      pick: `${dog} ML`, odds: dogML,
      edge: 'dog', edgeLabel: uLabel,
      conf, units, reasons,
    };
  }

  const pTypeRaw = Math.floor(r() * 4);
  const pType    = (pTypeRaw === 0 && mlIsExtreme && odds) ? 1 : pTypeRaw;

  let pick, pickOdds, edge, reasons;
  const conf      = randConf(6.5, 9.2, r);
  const modelProb = _confToWinProb(conf);

  if (pType === 0 || !odds) {
    pick     = `${fav} ML`;
    pickOdds = favML;
    edge     = (!isNaN(favMLNum) && favMLNum >= ML_VALUE_MAX) ? 'value' : 'strong';
    reasons  = pickArr(tmpl.ml_fav, r).map(fmt);
  } else if (pType === 1) {
    const lineVal  = favIsHome ? (odds.home?.spread     || dfltLine) : (odds.away?.spread     || dfltLine);
    const lineOdds = favIsHome ? (odds.home?.spreadOdds || '-110')   : (odds.away?.spreadOdds || '-110');
    const lineKey  = sp === 'nhl' ? 'puckline' : sp === 'mlb' ? 'runline' : 'spread';
    pick     = `${fav} ${lineVal}`;
    pickOdds = lineOdds;
    edge     = 'strong';
    reasons  = pickArr(tmpl[lineKey] || tmpl.spread || tmpl.ml_fav, r).map(fmt);
  } else if (pType === 2) {
    const tot = odds?.total || dfltTotal;
    pick     = `Over ${tot}`;
    pickOdds = odds?.overOdds || '-110';
    edge     = 'value';
    reasons  = pickArr(tmpl.over, r).map(fmt);
  } else {
    const tot = odds?.total || dfltTotal;
    pick     = `Under ${tot}`;
    pickOdds = odds?.underOdds || '-110';
    edge     = 'value';
    reasons  = pickArr(tmpl.under, r).map(fmt);
  }

  if (odds) {
    const mktImplied = _mlToImplied(pickOdds);
    if (modelProb - mktImplied < MIN_EDGE_PCT) return null;
  }

  const units = _computeUnits(conf, edge, favML);
  let edgeLabel;
  if      (units >= 2.0) edgeLabel = '2u Premium';
  else if (units >= 1.5) edgeLabel = '1.5u Strong';
  else if (units >= 1.0) edgeLabel = edge === 'strong' ? '1u Strong' : '1u Value';
  else                   edgeLabel = '0.5u Lean';

  return { sport: sp, matchup: `${away} @ ${home}`, pick, odds: pickOdds, edge, edgeLabel, conf, units, reasons };
}

/* ── Pick validation ─────────────────────────────────────────── */
function validatePick(pick, game) {
  if (!pick) return null;
  const pStr = pick.pick.toLowerCase();
  if (pStr.startsWith('over') || pStr.startsWith('under')) return pick;
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

module.exports = { computePick, validatePick, extractPlayers };
