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
        '{favPitcher} takes the mound — {favPitcherERA} ERA with swing-and-miss stuff {dog} has struggled to contain',
        '{fav} lineup has been producing with runners on base — clutch hitting in key spots all week',
        'Sharp money is on {fav} — line movement since the open reflects professional action on this side',
        '{dog} offense has been striking out at an elevated rate against this pitching style recently',
      ],
      [
        '{dogPitcher} has shown command issues in recent outings — inconsistency is a concern entering tonight',
        '{fav} lineup has legitimate power upside — home run threat against this rotation style tonight',
        '{fav} bullpen has been strong lately — quality late-inning coverage is a real edge in this matchup',
        'Situational spot strongly favors {fav} — rest and preparation advantage going into tonight',
      ],
      [
        '{favPitcher} facing a {dog} lineup that has been cold at the plate — timing is right for this pick',
        'Run differential edge favors {fav} in recent play — underlying performance reflects a real gap',
        'Sharp money confirmed — line has moved toward {fav} since this opened this morning',
        '{fav} has a strong track record with {favPitcher} on the hill — this combination wins at a high rate',
      ],
    ],
    ml_dog: [
      [
        '{dogPitcher} has been quietly effective lately — recent form outperforming what the market is pricing in',
        '{dog} plus-odds represent genuine positive EV — line is overreacting to recent results on both sides',
        '{fav} offense has shown cracks in recent games — regression from perception creates real value here',
        '{dog} has been a reliable underdog performer this season — plus-money has been profitable in this spot',
      ],
      [
        '{dogPitcher} faces a lineup that has been cold against this pitch style — strong matchup tonight',
        'Market is overvaluing {fav}\'s recent wins — {dog} is underpriced at the current number',
        '{dog} bullpen has been holding opponents in check during high-leverage spots this month',
        'Best plus-money spot on today\'s board — value confirmed on {dog} at the current price',
      ],
    ],
    runline: [
      [
        '{favPitcher} on the mound — when {fav} gets length from the starter, decisive wins follow',
        '{fav} offense generates extra-base hits at an above-average clip — multi-run inning upside is real',
        '{fav} bullpen has been elite in high-leverage spots recently — late leads are protected',
        '{dog} offense has been limited on the road — scoring output narrow against quality starting pitching',
      ],
      [
        '{fav} wins by decisive margins when {favPitcher} is dealing — run line value follows the performance',
        '{dogPitcher} walking batters at an elevated clip — free baserunners lead to crooked innings for {fav}',
        '{fav} lineup generates crooked numbers early — run line pays when the offense gets going in the first few frames',
        'Run line offers better price than the moneyline here — the value is clearly on the spread tonight',
      ],
      [
        '{fav} consistently wins big with {favPitcher} on the hill — run line coverage tracks his starts',
        '{dog} has been offensively limited recently — scoring ceiling is narrow against arms of this quality',
        '{fav} bullpen depth is the difference here — {dog} can\'t rally if the lead is protected late',
        'Run line presents the best number on today\'s board — take the spread over the straight moneyline',
      ],
    ],
    over: [
      [
        '{dogPitcher} ERA of {dogPitcherERA} has been inflated recently — both starters are hittable tonight',
        '{dog} lineup has real run-scoring upside — not rolling over quietly against {favPitcher}',
        'Both bullpens have been taxed this week — late-inning relief is not at full strength tonight',
        'The offenses both have upside in this matchup — lean to the over at the current posted total',
      ],
    ],
    under: [
      [
        '{favPitcher} in dominant form — {favPitcherERA} ERA with elite ground ball tendencies suppressing offense',
        '{dogPitcher} has been dialed in lately — {dogPitcherERA} ERA over recent starts limits run output',
        'Both offenses have been inconsistent at the plate lately — scoring pace is trending under in these matchups',
        'Under is the sharp side tonight — line value confirmed at the current posted total',
      ],
    ],
  },

  NBA: {
    ml_fav: [
      [
        '{favLeader} leading {fav} with elite efficiency — creating matchup problems {dog}\'s defense cannot solve',
        '{fav} has been one of the best two-way teams in the league recently — dominance on both ends sustained',
        'Offensive scheme advantage strongly favors {fav} — pace and spacing are exploitable against {dog} tonight',
        '{dog} road defense has been a real vulnerability this month — struggling to slow offenses like this one',
      ],
      [
        '{fav} has been dominant at home as a favorite — reliable winner in this spot throughout the season',
        '{dog} missing key rotation pieces — depth gap becomes critical in the fourth quarter tonight',
        'Sharp money confirmed on {fav} — line has moved in their direction since the open this morning',
        '{favLeader} in the best offensive form of the season — impossible to gameplan against right now',
      ],
      [
        '{fav} defense ranks among the elite in points allowed — capable two-way unit creating real problems',
        'Matchup edge: {dog}\'s primary ball-handler struggles against {fav}\'s switch-heavy scheme tonight',
        '{fav} home court performance has been exceptional this season — advantage is real and measurable',
        'Line has {fav} priced fairly or favorably — strong case for the win at the current number',
      ],
    ],
    ml_dog: [
      [
        '{dogLeader} capable of a standout performance — a proven scorer who can carry a team on the right night',
        '{dog} at home has been covering at a strong rate — real value at the plus-money price tonight',
        'Rest advantage: {dog} on extra rest at home vs {fav} on a shorter turnaround tonight',
        'Market is overpricing {fav} in this spot — {dog}\'s win probability is higher than the line implies',
      ],
      [
        '{dog} has been excellent at home this season — home court performance doesn\'t match the market price',
        'Fast pace benefits {dog} — transition opportunities multiply in this specific matchup style',
        '{dogLeader} the most dangerous offensive player in this game — can take over on any given possession',
        'Best plus-money value on tonight\'s board — positive EV confirmed on {dog} at current number',
      ],
    ],
    spread: [
      [
        '{fav} has a meaningful talent edge in this matchup — depth and execution advantage throughout 48 minutes',
        '{favLeader} creating at an elite rate — mismatches cascade through {dog}\'s entire lineup tonight',
        'Pace model strongly favors {fav} — possession advantage translates directly to scoring advantage',
        'Line has held steady on {fav} all week — sharp money has shown conviction at this price',
      ],
      [
        '{fav} offensive efficiency has been at an elite level recently — scheme dominance expected throughout',
        '{dog} missing rotation players — bench depth shrinks considerably against this caliber of opponent',
        '{fav} is the value side at this spread — getting a fair or better number on the stronger team',
        'Matchup advantage holds: {dog}\'s frontcourt cannot handle this {fav} offense tonight',
      ],
    ],
    over: [
      [
        '{favLeader} and {dogLeader} both capable of 30+ — individual battle will push this total up',
        'Both teams rank near the top in offensive pace — this game should play out as a high-tempo shootout',
        'Neither defense has been playing well against this opponent\'s style — scoring ceiling is elevated',
        'Both offenses are hot right now — the total is set too low given what these teams have been doing',
      ],
    ],
    under: [
      [
        'Both defenses have been excellent recently — elite defensive units clashing in this matchup tonight',
        'Slow pace expected — both teams have been operating at a deliberate tempo in similar matchups',
        'Coaching matchup favors a low-scoring halfcourt game — both staffs prioritize defense in big spots',
        'Under is the sharp play here — total is set high relative to the defensive quality on both sides',
      ],
    ],
  },

  NFL: {
    ml_fav: [
      [
        '{favQB} operating at peak efficiency — sharp decision-making and consistent production all month',
        '{fav} offensive line has been dominant in the run game — creating scheme advantages throughout',
        '{favRB} has been a weapon in the ground game lately — play-action opens up when the run is working',
        'Line movement toward {fav} since the open — professional money confirming this side tonight',
      ],
      [
        '{dogQB} struggling under pressure — taking sacks and forcing throws in key moments recently',
        '{fav} defense has been playing at a high level — capable of making {dog} one-dimensional tonight',
        '{fav} is the better team in this matchup — execution and depth advantage is real and significant',
        'Situational spot strongly favors {fav} — rest, preparation, and scheme all pointing the same direction',
      ],
    ],
    ml_dog: [
      [
        '{dogQB} at home has performed well as an underdog this season — dangerous at plus money tonight',
        '{dog} defense has been stout enough to keep this game competitive — not an easy night for {fav}',
        '{fav} on a short week here — {dog} had the full preparation window to game plan this matchup',
        'Plus odds represent real value — {dog} win probability meaningfully higher than the line implies',
      ],
      [
        '{dog} at home is a dangerous underdog — the home crowd factor in this stadium is not to be dismissed',
        '{dogRB} provides the ground game option that keeps {dog} competitive and controls the clock',
        '{fav} has struggled to cover in physical, low-margin games this season — this has that look',
        'Best underdog spot on today\'s board — value confirmed at the current plus-money number',
      ],
      [
        '{dogQB} has outperformed expectations against {fav} in recent meetings — familiarity narrows the gap',
        '{dog} third-down defense has been excellent — keeps drives short and games competitive late',
        'Situational edge: {dog} well-rested and fully prepared vs {fav}\'s condensed schedule this week',
        'Plus odds offer genuine positive EV in this specific matchup — take the number on {dog}',
      ],
    ],
    spread: [
      [
        '{fav} has a meaningful talent and scheme edge — execution advantage creates sustained field position control',
        '{favQB} vs {dog} pass defense — {dog} has been consistently vulnerable in the passing game this season',
        'OL advantage favors {fav} in the run game — {favRB} should operate with room behind a dominant line',
        'Model and market line are aligned — strong value confirmed at the currently posted number tonight',
      ],
      [
        '{fav} turnover margin has been positive all season — field position advantage is consistent and real',
        '{dog} red zone offense has been inefficient — settling for field goals when {fav} scores touchdowns',
        '{fav} depth and execution is the edge in this spot — better team winning by the margin is realistic',
        'Line is set correctly or favorably for {fav} — no reason to fade the better side at this price',
      ],
    ],
    over: [
      [
        '{favQB} and {dogQB} both in rhythm recently — combined passing attack should generate big numbers',
        'Both offenses have been scoring at a high clip — pace will be aggressive from the opening drive',
        'Neither secondary is at full strength — both QBs will be attacking favorable matchups all night',
        'Total is set in a range where the offenses have upside — the over is the right side at this number',
      ],
    ],
    under: [
      [
        'Both defenses have been outstanding recently — elite units on both sides of this matchup tonight',
        '{favQB} facing a secondary that has been playing at its best — difficult environment to operate in',
        'Weather or game-flow factors may slow the pace — conservative game management expected from both staffs',
        'Under is the smart play here — defensive quality on both sides exceeds what this total is priced at',
      ],
    ],
  },

  NHL: {
    ml_fav: [
      [
        '{favGoalie} in net for {fav} — posting elite numbers recently with consistent command of the crease',
        '{fav} generating sustained pressure at home — possession and zone time advantage all night long',
        '{fav} power play has been dangerous lately — the specialized unit creates scoring chances in bursts',
        '{dog} has had goaltending vulnerabilities recently — {fav} offense has the firepower to exploit them',
      ],
      [
        '{dogGoalie} has been showing signs of inconsistency — {fav} offense can expose that tonight',
        '{fav} zone control and shot volume at home is a real edge — territorial dominance through 60 minutes',
        'Sharp action confirmed on {fav} — line has tightened in their direction since the open this morning',
        '{favGoalie} has been sharp in this building — solid crease play makes {fav} hard to beat at home',
      ],
      [
        '{favGoalie} has been outstanding against this specific opponent — historically a strong matchup for {fav}',
        '{dog} on the second game of a back-to-back — fatigue is a real factor in the third period tonight',
        '{fav} home ice record has been excellent this season — consistently protected their building all year',
        '{fav} is priced correctly or undervalued here — line reflects a real edge going into tonight',
      ],
    ],
    ml_dog: [
      [
        '{dogGoalie} has been playing at a high level lately — in-form goaltending makes any team dangerous',
        '{dog} home ice record has been excellent — this building creates real problems for visiting teams',
        'Plus odds on {dog} represent genuine positive EV — market overreacting to recent {fav} results',
        '{dog} has the goaltending and team structure to pull off a home upset at this price tonight',
      ],
      [
        '{favGoalie} has shown vulnerability on the road this season — clear performance dropoff away from home',
        '{fav} road record is not as strong as their home record — consistent dropoff creating real value here',
        '{dog} power play has been clicking lately — dangerous special teams unit that can change this game',
        'Best plus-money value on tonight\'s board — {dog} is underpriced given their home form this season',
      ],
    ],
    puckline: [
      [
        '{favGoalie} dominant form allows {fav} to protect leads comfortably through 60 minutes of play',
        '{fav} has been winning by multi-goal margins at home — puck line is live when the offense is rolling',
        'PL at {line} offers significantly better price than the moneyline — value is on the spread tonight',
        '{fav} wins decisively when the goaltending is on — tonight it should be on with {favGoalie} starting',
      ],
      [
        '{fav} puck line track record as a home favorite has been strong — multi-goal wins at home this season',
        '{dogGoalie} has been allowing goals in bunches recently — puck line exposure is real at this price',
        '{fav} power play converting at a strong rate this month — special teams edge compounds the run line',
        'Puck line is the best value in this game — better number than the straight moneyline on {fav}',
      ],
    ],
    over: [
      [
        '{dogGoalie} has been giving up goals consistently lately — vulnerability in the crease creates over value',
        'Both power play units have been active and dangerous — penalty-heavy game is expected tonight',
        'These two teams have been playing high-scoring games in recent meetings — offensive history holds',
        'Total feels set low for the offensive talent in this matchup — lean over at the current posted number',
      ],
    ],
    under: [
      [
        '{favGoalie} and {dogGoalie} are both playing well — elite goaltending matchup sets up a tight game',
        'Both teams in a tight standings spot — defensive structure is locked in and disciplined tonight',
        'Historical matchup between these two has trended toward defensive battles — under fits the pattern',
        'Under is the sharper play tonight — goaltending quality on both sides exceeds what the total implies',
      ],
    ],
  },

  NCAAM: {
    ml_fav: [
      [
        '{favLeader} is the engine of this offense — creating matchup problems throughout {dog}\'s rotation',
        '{fav} efficiency has been elite at both ends — real depth and execution advantage in this matchup',
        '{dog} road defense has been exploitable on the perimeter — {fav} spacing and ball movement will find gaps',
        '{fav} at home as a favorite has been dominant — home court advantage is real and proven this season',
      ],
      [
        '{fav} has been on a hot offensive stretch lately — scoring consistently and getting the right looks',
        '{dogLeader} is their only consistent offensive option — {fav} can gameplan and contain one scorer',
        '{fav} depth advantage is significant here — rotation length creates fatigue in the second half',
        'Pace advantage belongs to {fav} — superior depth and conditioning are meaningful through 40 minutes',
      ],
    ],
    ml_dog: [
      [
        '{dogLeader} capable of a monster performance — a proven volume scorer who can carry this team tonight',
        '{dog} at home as an underdog has been covering well — home court value is significant in college',
        'Home floor advantage in college basketball is among the highest-variance factors in the sport',
        'Plus odds offer strong value here — {dog}\'s win probability is well above what the line implies',
      ],
      [
        '{dog} guard play has been sharp — creating easy looks inside and controlling the pace of the game',
        'Fast pace benefits {dog} in this matchup — transition opportunities multiply in their building tonight',
        '{dog} is a live underdog with the right personnel to stay in this game — the plus money has value',
        'Best plus-money value on today\'s board — take {dog} at the current number tonight',
      ],
    ],
    spread: [
      [
        '{fav} has a meaningful efficiency edge — real talent and depth gap in this specific matchup tonight',
        '{favLeader} is posting elite numbers and creating matchup problems {dog} has no answer for',
        'Line reflects a real advantage for {fav} — take the spread over the straight moneyline in this spot',
        'Both lines pointing the same direction — strong conviction on {fav} covering at this number',
      ],
      [
        '{fav} offensive efficiency has been at a high level nationally — scheme and talent advantage sustained',
        '{dog} missing rotation players — depth shrinks considerably against this caliber of opponent tonight',
        'Getting {fav} at this spread is genuine value — better team covering is the most likely outcome',
        '{fav} has been excellent as a favorite at home this season — covering rate reflects real quality',
      ],
    ],
    over: [
      [
        '{favLeader} and {dogLeader} are both capable of 25+ — individual battle between stars pushes the total',
        'Both teams have been playing at a fast tempo — expect a high-scoring, up-and-down contest tonight',
        'Neither defense has the personnel to slow down the other\'s best offensive players in this matchup',
        'Total is set in a range where the offenses have upside — the over has value at tonight\'s number',
      ],
    ],
    under: [
      [
        'Both defenses have been outstanding nationally — elite defensive units clashing in this game tonight',
        'Slow tempo expected — both teams play at a deliberate pace that limits possessions and scoring',
        'Coaching matchup will define the game — both staffs prioritize defensive stops above all else',
        'Under is the right play — defensive quality on both sides makes this total look too high tonight',
      ],
    ],
  },

  NCAAF: {
    ml_fav: [
      [
        '{favQB} has been operating efficiently — sharp decision-making and consistent production this season',
        '{fav} offensive efficiency has been at a high level nationally — real scheme and execution edge tonight',
        '{favRB} has been dominant in the ground game — play-action advantage opens up when the run is working',
        '{fav} at home as a favorite has been a reliable winner — covering at a strong rate this season',
      ],
      [
        '{dogQB} facing a {fav} defense that has been suffocating this season — significant pressure expected',
        '{dog} defense has been allowing big numbers — {fav} offense will find scoring opportunities all night',
        'Sharp books have been steady on {fav} all week — no meaningful movement suggesting {dog} value exists',
        '{fav} is the clearly better team in this matchup — execution and depth advantage is real and significant',
      ],
    ],
    ml_dog: [
      [
        '{dogQB} at home has been performing at a high level — dangerous with this crowd behind them tonight',
        '{dog} at home as an underdog in conference play — real value at the plus-money price tonight',
        'Home field advantage in college football is among the most powerful forces in American sports',
        'Plus odds offer strong value — {dog}\'s win probability is higher than the current number implies',
      ],
      [
        '{dog} third-down conversion rate has been strong in conference play — sustains drives and controls clock',
        '{dogQB} is comfortable in this environment and has been performing well — don\'t dismiss the home edge',
        '{fav} has failed to cover against physical conference opponents multiple times this season',
        '{dog}\'s win probability is meaningfully higher than the line implies — take the plus money tonight',
      ],
    ],
    spread: [
      [
        '{fav} has a clear scheme and execution edge — sustained field position control throughout the game',
        '{favQB} vs {dog} pass defense — {dog} has been consistently exploitable in the passing game this season',
        'Turnover margin has strongly favored {fav} this season — field position edge is consistent and real',
        'Market and model are aligned — strong value confirmed on {fav} at the currently posted spread',
      ],
      [
        '{fav} at home as a favorite has been covering consistently — market rewards their scheme and execution',
        '{favRB} in the ground game controls clock and limits {dog}\'s possessions — a foundational edge',
        '{dog} red zone defense has been vulnerable — {fav} converts scoring chances at a high rate',
        '{fav} at this spread is the right side — take the better team at a fair number tonight',
      ],
    ],
    over: [
      [
        '{favQB} and {dogQB} are both willing to throw — pass-heavy game style expected from the opening drive',
        'Both defenses have been allowing big numbers this season — high scoring ceiling in this specific matchup',
        'These two offenses have the personnel to go over this total — the number is achievable tonight',
        'Total feels reachable given the offensive talent and defensive vulnerabilities on both sides tonight',
      ],
    ],
    under: [
      [
        'Defensive battle expected — both units have been excellent and trending toward a low-scoring game',
        '{favQB} facing a secondary that has been playing shutdown ball — difficult passing environment tonight',
        'Slow tempo teams — fewer possessions means fewer scoring chances for both offenses in 60 minutes',
        'Under is the smart play here — defensive quality exceeds what this total is priced at tonight',
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

  // Correct possessive for names ending in 's' (e.g. "Yankees'" not "Yankees's")
  const _poss = name => name.endsWith('s') ? `${name}'` : `${name}'s`;

  function fmt(str) {
    const lineVal = favIsHome ? (odds?.home?.spread || dfltLine) : (odds?.away?.spread || dfltLine);
    return str
      .replace(/\{fav\}/g,  fav).replace(/\{dog\}/g,  dog)
      .replace(/\{home\}/g, home).replace(/\{away\}/g, away)
      .replace(/\{favML\}/g,         favML)
      .replace(/\{line\}/g,          lineVal)
      .replace(/\{total\}/g,         odds?.total || dfltTotal)
      .replace(/\{pts\}/g,           String(Math.abs(parseFloat(lineVal) || 3).toFixed(1)))
      .replace(/\{favPitcher\}/g,    favPitcher    || `${_poss(fav)} starter`)
      .replace(/\{dogPitcher\}/g,    dogPitcher    || `${_poss(dog)} starter`)
      .replace(/\{favPitcherERA\}/g, favPitcherERA || 'solid')
      .replace(/\{dogPitcherERA\}/g, dogPitcherERA || 'elevated')
      .replace(/\{favPitcherRec\}/g, favPitcherRec || '')
      .replace(/\{dogPitcherRec\}/g, dogPitcherRec || '')
      .replace(/\{favGoalie\}/g,     favGoalie     || `${_poss(fav)} goalie`)
      .replace(/\{dogGoalie\}/g,     dogGoalie     || `${_poss(dog)} goalie`)
      .replace(/\{favQB\}/g,         favQB         || `${_poss(fav)} QB`)
      .replace(/\{dogQB\}/g,         dogQB         || `${_poss(dog)} QB`)
      .replace(/\{favRB\}/g,         favRB         || `${_poss(fav)} backfield`)
      .replace(/\{dogRB\}/g,         dogRB         || `${_poss(dog)} backfield`)
      .replace(/\{favLeader\}/g,     favLeader     || `${_poss(fav)} scorer`)
      .replace(/\{dogLeader\}/g,     dogLeader     || `${_poss(dog)} scorer`);
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
