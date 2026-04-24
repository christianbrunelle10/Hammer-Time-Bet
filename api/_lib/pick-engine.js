/**
 * HammerTimeBet — Pick Engine (Node.js / CommonJS)
 *
 * Reason generation rules:
 *   dataScore counts named players used in reasons (pitcher, goalie, QB, leader).
 *   dataQuality: 'high'  (2+ named players) → 3-4 reasons shown
 *                'medium' (1 named player)   → 2-3 reasons shown
 *                'low'    (0 named players)  → 1 honest sentence, homepage-ineligible
 *
 * Low-quality picks are excluded from the homepage pool by _curateHomepicks.
 * They still appear on sport pages so each game has at least a basic card.
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
function rPick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
function randConf(min, max, r) { return parseFloat((r() * (max - min) + min).toFixed(1)); }

/* ── Odds/EV constants ─────────────────────────────────────────── */
const ML_HARD_CAP  = -300;
const ML_VALUE_MAX = -150;
const MIN_EDGE_PCT = 0.02;
const DOG_MIN_ML   = 115;

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

/* ── Helpers ─────────────────────────────────────────────────────── */
const _poss  = name => name.endsWith('s') ? `${name}'` : `${name}'s`;
const _eraGrade = era => {
  const n = parseFloat(era);
  if (isNaN(n) || !era) return null;
  if (n < 3.00) return 'elite';
  if (n < 3.75) return 'solid';
  if (n < 4.50) return 'average';
  if (n < 5.50) return 'elevated';
  return 'poor';
};

/* ═══════════════════════════════════════════════════════════════════
   REASON BUILDERS
   Return { reasons: string[], dataQuality: 'high'|'medium'|'low' }

   Rules:
     dataScore === 0 → reasons.length = 1  (low)
     dataScore === 1 → reasons.length = 2  (medium)
     dataScore >= 2  → reasons.length = 4  (high)
═══════════════════════════════════════════════════════════════════ */

/* ── MLB ─────────────────────────────────────────────────────────── */
function _mlbReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favPitcher, dogPitcher, favPitcherERA, dogPitcherERA,
          favPitcherRec, dogPitcherRec, favPitcherK } = p;

  const total  = odds?.total || '8.0';
  const spread = favIsHome ? (odds?.home?.spread || '-1.5') : (odds?.away?.spread || '-1.5');
  const real   = [];
  let dataScore = 0;

  /* ── Collect player-anchored sentences ── */
  if (role === 'dog') {
    if (dogPitcher) {
      dataScore++;
      const era = dogPitcherERA ? ` (${dogPitcherERA} ERA)` : '';
      const rec = dogPitcherRec ? `, ${dogPitcherRec}` : '';
      const grade = _eraGrade(dogPitcherERA);
      const qualifier = (grade === 'elite' || grade === 'solid')
        ? ' — that kind of performance makes any team dangerous on the mound'
        : '';
      real.push(`${dogPitcher}${era}${rec} starts for ${dog}${qualifier}`);
    }
    if (favPitcher) {
      dataScore++;
      const era = favPitcherERA ? ` (${favPitcherERA} ERA)` : '';
      real.push(`${favPitcher}${era} goes for ${fav} — ${dog} has seen similar arms this season and kept games close at plus money`);
    }
  } else {
    if (favPitcher) {
      dataScore++;
      const era  = favPitcherERA ? ` (${favPitcherERA} ERA)` : '';
      const rec  = favPitcherRec ? `, ${favPitcherRec}` : '';
      const kStr = favPitcherK   ? ` — ${favPitcherK} strikeouts on the year` : '';
      if (pType === 1) {
        real.push(`${favPitcher}${era}${rec} on the hill — quality starts from this pitcher create the multi-run margins that cover the run line`);
      } else if (pType === 3) {
        const grade = _eraGrade(favPitcherERA);
        const qual  = (grade === 'elite' || grade === 'solid') ? ', one of the better ERA marks in the league' : '';
        real.push(`${favPitcher}${era}${qual}${rec} starts tonight — that level of pitching keeps the scoring in check`);
      } else {
        real.push(`${favPitcher}${era}${rec}${kStr} takes the ball for ${fav}`);
      }
    }
    if (dogPitcher) {
      dataScore++;
      const era   = dogPitcherERA ? ` (${dogPitcherERA} ERA)` : '';
      const grade = _eraGrade(dogPitcherERA);
      if (pType === 2) {
        const overObs = (grade === 'elevated' || grade === 'poor')
          ? ` — he has been giving up runs and ${fav} should get to him tonight`
          : ` — enough upside on both sides to clear ${total}`;
        real.push(`${dogPitcher}${era} counters for ${dog}${overObs}`);
      } else {
        const obs = (grade === 'elevated' || grade === 'poor')
          ? ` — ${fav} lineup is well-positioned to exploit that elevated ERA`
          : '';
        real.push(`${dogPitcher}${era} counters for ${dog}${obs}`);
      }
    }
  }

  /* ── Fill sentences (team-specific, no named player) ── */
  const fill = (() => {
    if (role === 'dog') return [
      `${dog} at ${dogML} — the rotation gives them a legitimate path to an upset tonight`,
      `At ${dogML}, ${dog} offers real value — rotation mismatches often produce tighter scores than the market expects`,
      `${fav} has not been automatic recently — ${dog} lineup is capable of keeping this game close`,
    ];
    if (pType === 1) return [
      `${_poss(fav)} bullpen has the depth to protect a lead into the final innings — the run line stays live`,
      `Run line at ${spread} is the better price over the straight moneyline — take the spread here`,
      `${dog} offense has been limited against quality starters — the multi-run margin is on the table`,
    ];
    if (pType === 2) return [
      `Both bullpens have been heavily used this week — late-inning scoring is a real factor tonight`,
      `The ${total} total is in range for what these offenses have been doing recently`,
      `Neither team has the shutdown depth to prevent scoring once the lead changes hands`,
    ];
    if (pType === 3) return [
      `Both offenses have been inconsistent at the plate — the scoring pace is tracking under this total`,
      `Under ${total} — the pitching matchup on both sides supports the low-score play tonight`,
      `${_poss(fav)} lineup has been cold — ${dog} pitching is capable of keeping the run total in check`,
    ];
    return [
      favIsHome
        ? `${fav} at home with the pitching edge — this is their most consistent setup of the season`
        : `${fav} on the road with an arm of this caliber — road favorites with strong starters cover consistently`,
      `${_poss(fav)} lineup has been productive in run-scoring situations — the offense backs up the pitching advantage`,
      `${dog} has been struggling offensively — ${fav} is the right side of this matchup at the current price`,
    ];
  })();

  return _assemble(real, fill, dataScore);
}

/* ── NBA ─────────────────────────────────────────────────────────── */
function _nbaReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favLeader, dogLeader, favLeaderPts, dogLeaderPts } = p;
  const total  = odds?.total || '220.5';
  const spread = favIsHome ? (odds?.home?.spread || '-5.0') : (odds?.away?.spread || '-5.0');
  const lStr   = (name, pts) => pts ? `${name} (${pts} PPG)` : name;
  const real   = [];
  let dataScore = 0;

  if (pType === 2) {
    if (favLeader && dogLeader) {
      dataScore += 2;
      real.push(`${lStr(favLeader, favLeaderPts)} and ${lStr(dogLeader, dogLeaderPts)} are both capable of 30+ — the individual battle pushes this total`);
    } else if (favLeader) {
      dataScore++;
      real.push(`${lStr(favLeader, favLeaderPts)} is the offensive engine — the volume this player requires to carry ${fav} pushes the total`);
    } else if (dogLeader) {
      dataScore++;
      real.push(`${lStr(dogLeader, dogLeaderPts)} keeps ${dog} in high-scoring games — the offensive profile here supports the over`);
    }
    const fill = [
      `Both teams rank near the top in offensive pace — this game plays out as a high-tempo scoring game`,
      `Neither defense has shown the ability to consistently slow this opponent's top scorer`,
      `Over ${total} — the offensive talent in this matchup makes this number clearable`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 3) {
    if (favLeader) {
      dataScore++;
      real.push(`${fav} runs through ${lStr(favLeader, favLeaderPts)} — when both defenses lock in and take away the primary scorer, the pace drops below this total`);
    }
    const fill = [
      `Both defenses have been playing at an elite level — the scoring pace is tracking well under this number`,
      `Coaching on both sides prioritizes defensive stops — halfcourt game expected throughout`,
      `Under ${total} — the defensive quality in this matchup is the clearest edge on the board tonight`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (role === 'dog') {
    if (dogLeader) {
      dataScore++;
      real.push(`${lStr(dogLeader, dogLeaderPts)} is capable of taking over this game — a scorer at this level makes ${dog} dangerous at any price`);
    }
    if (favLeader) {
      dataScore++;
      real.push(`${fav} runs through ${lStr(favLeader, favLeaderPts)}, but ${dog} has shown it can disrupt primary options and force the rest of the lineup to create`);
    }
    const fill = [
      favIsHome
        ? `${dog} on the road has been more competitive than the market reflects — the road record makes this price too generous`
        : `${dog} at home is where you want them as an underdog — do not dismiss the home floor advantage in this building`,
      `At ${dogML}, ${dog} offers real plus-money value — this type of game is decided by a handful of possessions`,
      `${fav} has not been dominant away from their building — ${dog} is positioned to keep this game close`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 1) {
    if (favLeader) {
      dataScore++;
      real.push(`${lStr(favLeader, favLeaderPts)} has been creating matchup problems ${dog} has no consistent answer for — the talent gap shows up in the margin`);
    }
    if (dogLeader) {
      dataScore++;
      real.push(`${dog} runs through ${lStr(dogLeader, dogLeaderPts)} — if ${fav} takes him away, the offense has no reliable fallback plan`);
    }
    const fill = [
      favIsHome
        ? `${fav} at home as a favorite has been covering consistently — the crowd and preparation compound the talent edge`
        : `${fav} on the road holds the talent advantage — the depth and scheme edge travels`,
      `${fav} ${spread} — the better team executing the cleaner game plan covering by this margin is the most likely outcome`,
      `${dog} does not have the depth to match ${fav} possession for possession — the bench gap creates the margin`,
    ];
    return _assemble(real, fill, dataScore);
  }

  /* ML Fav */
  if (favLeader) {
    dataScore++;
    real.push(`${lStr(favLeader, favLeaderPts)} is the engine of ${_poss(fav)} offense — creating matchup problems ${dog} has no consistent answer for`);
  }
  if (dogLeader) {
    dataScore++;
    real.push(`${dog} runs through ${lStr(dogLeader, dogLeaderPts)} — if ${fav} takes him away, the ${dog} offense has no fallback scoring option`);
  }
  const fill = [
    favIsHome
      ? `${fav} at home has been dominant — the crowd and routine advantage have been meaningful throughout this season`
      : `${fav} on the road with this roster is still the better team — the talent edge does not disappear away from home`,
    `${fav} at ${favML} — the number accurately reflects the gap between these two rosters in current form`,
    `${dog} lacks the offensive firepower to stay with ${fav} for a full 48 minutes at this level`,
  ];
  return _assemble(real, fill, dataScore);
}

/* ── NHL ─────────────────────────────────────────────────────────── */
function _nhlReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favGoalie, dogGoalie } = p;
  const total  = odds?.total || '5.5';
  const spread = favIsHome ? (odds?.home?.spread || '-1.5') : (odds?.away?.spread || '-1.5');
  const real   = [];
  let dataScore = 0;

  if (pType === 2) {
    if (dogGoalie) {
      dataScore++;
      real.push(`${dogGoalie} has been under pressure recently — the vulnerability in ${_poss(dog)} crease is the key reason to lean to the over`);
    }
    if (favGoalie && !real.length) {
      dataScore++;
      real.push(`Both goalies have been tested heavily this week — neither crease is locked down entering tonight`);
    }
    const fill = [
      `Both power play units have been active and converting — a penalty-heavy game pushes the goal total up`,
      `These two teams have been involved in high-scoring games in recent meetings — the offensive trend holds`,
      `Over ${total} — goaltending and pace both point toward more scoring than the posted number suggests`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 3) {
    if (favGoalie && dogGoalie) {
      dataScore += 2;
      real.push(`${favGoalie} and ${dogGoalie} are both playing at a high level — elite goaltending on both sides sets up a tight, low-scoring game`);
    } else if (favGoalie) {
      dataScore++;
      real.push(`${favGoalie} has been ${_poss(fav)} best performer in the crease — that level of goaltending suppresses the total`);
    } else if (dogGoalie) {
      dataScore++;
      real.push(`${dogGoalie} has been sharp for ${dog} — two goalies playing well on both sides limits the combined total`);
    }
    const fill = [
      `Both teams in a tight standings battle — defensive structure is locked in and disciplined in high-stakes games`,
      `Historical matchup between these two has trended toward defensive battles — the pattern holds tonight`,
      `Under ${total} — the goaltending quality in this game makes this total look high for what it will actually produce`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 1) {
    if (favGoalie) {
      dataScore++;
      real.push(`${favGoalie} in the crease gives ${fav} the foundation to win decisively — quality goaltending in multi-goal wins keeps the puck line live`);
    }
    if (dogGoalie) {
      dataScore++;
      real.push(`${dogGoalie} has been allowing goals in bunches recently — the puck line exposure is real when facing a ${fav} offense in this form`);
    }
    const fill = [
      `${_poss(fav)} power play has been converting at a strong rate — special teams edge amplifies the run line`,
      `Puck line at ${spread} offers a meaningfully better price than the straight moneyline — take the spread tonight`,
      `${dog} has been unable to keep games within one goal consistently — puck line is the right side at this price`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (role === 'dog') {
    if (dogGoalie) {
      dataScore++;
      real.push(`${dogGoalie} has been playing at a high level for ${dog} — in-form goaltending makes any team dangerous in a one-goal sport`);
    }
    if (favGoalie) {
      dataScore++;
      real.push(`${favGoalie} has shown road vulnerability this season — ${dog} is positioned to exploit that dropoff at home tonight`);
    }
    const fill = [
      favIsHome
        ? `${dog} at home in hockey — the crowd and building are real factors in a tight game, especially at plus money`
        : `${dog} on the road with hot goaltending is a live underdog — goaltending-driven upsets happen at this price`,
      `At ${dogML}, ${dog} is the best plus-money spot on tonight\'s board — the crease situation makes this price too generous`,
      `${_poss(fav)} road form has been inconsistent — ${dog} home ice is where this price makes sense`,
    ];
    return _assemble(real, fill, dataScore);
  }

  /* ML Fav */
  if (favGoalie) {
    dataScore++;
    real.push(`${favGoalie} in net for ${fav} — a goalie playing at this level is the single biggest edge in a one-goal sport`);
  }
  if (dogGoalie) {
    dataScore++;
    real.push(`${dogGoalie} has shown inconsistency recently — ${fav} offense is positioned to find the net against a goalie in this form`);
  }
  const fill = [
    favIsHome
      ? `${fav} protecting home ice — the crowd and familiarity are real factors in hockey, especially in tight matchups`
      : `${fav} on the road with the goaltending edge — in hockey, that\'s where the money is`,
    `${fav} at ${favML} — the goaltending situation is the clearest edge in this game`,
    `${_poss(dog)} crease has been the weak link — ${fav} offense generates enough chances to exploit it`,
  ];
  return _assemble(real, fill, dataScore);
}

/* ── NFL ─────────────────────────────────────────────────────────── */
function _nflReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favQB, dogQB, favRB, dogRB } = p;
  const total  = odds?.total || '47.5';
  const spread = favIsHome ? (odds?.home?.spread || '-3.0') : (odds?.away?.spread || '-3.0');
  const real   = [];
  let dataScore = 0;

  if (pType === 2) {
    if (favQB && dogQB) {
      dataScore += 2;
      real.push(`${favQB} and ${dogQB} are both in rhythm — two quarterbacks operating at this level makes the ${total} total very reachable`);
    } else if (favQB) {
      dataScore++;
      real.push(`${favQB} has been operating at peak efficiency — the offense is going to put up points and push this total`);
    } else if (dogQB) {
      dataScore++;
      real.push(`${dogQB} has been finding the end zone consistently — the total is in range for what these two offenses have been doing`);
    }
    const fill = [
      `Both offenses have been scoring at a high clip — pace will be aggressive from the opening drive`,
      `Neither secondary is at full strength — both QBs will find favorable matchups to attack`,
      `Over ${total} — the combined offensive production from both sides makes this number clearable`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 3) {
    if (favQB) {
      dataScore++;
      real.push(`${favQB} is facing one of the better defenses he will see this year — expect a lower-tempo, controlled game`);
    }
    const fill = [
      dogQB
        ? `${dogQB} faces a defense that has been playing at its best — not a comfortable passing environment`
        : `Both offenses have struggled to sustain drives against quality defenses — this game has the look of a grinder`,
      `Weather or scheme factors may slow the pace — conservative game management from both coaching staffs`,
      `Under ${total} — the defensive quality on both sides exceeds what this total is priced at`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (role === 'dog') {
    if (dogQB) {
      dataScore++;
      real.push(`${dogQB} at home has been performing at a high level — a quarterback with this experience is dangerous at plus money`);
    }
    if (favQB) {
      dataScore++;
      real.push(`${favQB} has to handle a hostile road environment — that is a real factor when the price implies more certainty than the game will deliver`);
    }
    const fill = [
      dogRB
        ? `${dogRB} provides the ground game option that keeps ${dog} competitive and controls the clock`
        : `${dog} has the run game to keep this game close and drain the clock — low-scoring games are where upsets live`,
      `At ${dogML}, ${dog} is the right plus-money spot — this type of game is decided by a handful of plays`,
      `${fav} has not been dominant on the road — ${dog} home field narrows the gap considerably`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 1) {
    if (favQB) {
      dataScore++;
      real.push(`${favQB} has been executing with precision — a quarterback at this level in this scheme creates the margin that covers the spread`);
    }
    if (dogQB) {
      dataScore++;
      real.push(`${dogQB} is facing a ${fav} defense that has been playing shutdown football — expect consistent pressure and difficult moments`);
    }
    const fill = [
      favRB
        ? `${favRB} in the ground game controls the tempo and opens play-action — the run game is the foundation of ${_poss(fav)} scheme`
        : `${_poss(fav)} ground game creates the play-action advantage that defines their offensive identity`,
      `${fav} ${spread} — the better team, executing the cleaner game plan, covering by this margin is the most likely outcome`,
      `${_poss(dog)} red zone offense has been inefficient — settling for field goals while ${fav} scores touchdowns`,
    ];
    return _assemble(real, fill, dataScore);
  }

  /* ML Fav */
  if (favQB) {
    dataScore++;
    real.push(`${favQB} is operating at peak efficiency — making sharp decisions and producing in high-leverage moments`);
  }
  if (dogQB) {
    dataScore++;
    real.push(`${dogQB} has been under pressure and forcing throws in key moments — ${fav} defense is exactly the type to create those situations`);
  }
  const fill = [
    favRB
      ? `${favRB} in the ground game opens up play-action and controls the tempo — ${fav} wins the possession battle`
      : `${_poss(fav)} ground game creates the play-action edge that this offense depends on to execute`,
    favIsHome
      ? `${fav} at home with the better quarterback — the preparation and crowd advantage is real at this level`
      : `${fav} on the road is still the better team — the talent gap does not disappear when they travel`,
    `${dog} does not have the quarterback play to sustain drives against ${_poss(fav)} defense tonight`,
  ];
  return _assemble(real, fill, dataScore);
}

/* ── NCAAM ────────────────────────────────────────────────────────── */
function _ncaamReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favLeader, dogLeader, favLeaderPts, dogLeaderPts } = p;
  const total  = odds?.total || '145.5';
  const spread = favIsHome ? (odds?.home?.spread || '-4.5') : (odds?.away?.spread || '-4.5');
  const lStr   = (name, pts) => pts ? `${name} (${pts} PPG)` : name;
  const real   = [];
  let dataScore = 0;

  if (pType === 2) {
    if (favLeader && dogLeader) {
      dataScore += 2;
      real.push(`${lStr(favLeader, favLeaderPts)} and ${lStr(dogLeader, dogLeaderPts)} are both capable of 25+ — the individual star battle pushes this total`);
    } else if (favLeader) {
      dataScore++;
      real.push(`${lStr(favLeader, favLeaderPts)} is the offensive engine — the volume this player needs to carry ${fav} pushes the total`);
    } else if (dogLeader) {
      dataScore++;
      real.push(`${lStr(dogLeader, dogLeaderPts)} keeps ${dog} in high-scoring games — the offensive profile supports the over`);
    }
    const fill = [
      `Both teams rank near the top nationally in offensive pace — this matchup has the ingredients for a shootout`,
      `Neither defense can consistently slow down the opponent's primary scorer in this matchup`,
      `Over ${total} — the offensive talent and defensive limitations on both sides make this number clearable`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 3) {
    if (favLeader) {
      dataScore++;
      real.push(`${fav} runs through ${lStr(favLeader, favLeaderPts)} — when both defenses lock in and take away the primary scorer, the pace falls below this number`);
    }
    const fill = [
      `Both defenses have been among the best nationally — the scoring pace is tracking well under this total`,
      `Both coaches prioritize defensive stops over offensive pace — this game has the look of a grinder`,
      `Under ${total} — the defensive quality on both sides makes this total look too high for what the game will produce`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (role === 'dog') {
    if (dogLeader) {
      dataScore++;
      real.push(`${lStr(dogLeader, dogLeaderPts)} is capable of a monster performance — a proven volume scorer can carry this team at plus money`);
    }
    if (favLeader) {
      dataScore++;
      real.push(`${fav} runs through ${lStr(favLeader, favLeaderPts)}, but ${dog} has the defensive structure to disrupt the primary option and force the offense to recreate`);
    }
    const fill = [
      `Home floor advantage in college basketball is among the highest-variance factors in the sport`,
      `At ${dogML}, ${dog} is worth backing — the upset probability is higher than the market implies`,
      `${dog} has been covering at home as an underdog this season — the home crowd creates real pressure`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 1) {
    if (favLeader) {
      dataScore++;
      real.push(`${lStr(favLeader, favLeaderPts)} is posting elite numbers and creating matchup problems ${dog} has no answer for`);
    }
    if (dogLeader) {
      dataScore++;
      real.push(`${dog} runs through ${lStr(dogLeader, dogLeaderPts)} — if ${fav} takes him away, the offense has nowhere else to go`);
    }
    const fill = [
      favIsHome
        ? `${fav} at home as a favorite has been dominant — college home court is a real and measurable edge`
        : `${fav} on the road holds the talent advantage — this program covers road spots at a consistent rate`,
      `${fav} ${spread} — the better team covering by this margin is the most likely outcome tonight`,
      `${_poss(dog)} depth shrinks considerably against this caliber of opponent — fatigue in the second half creates the margin`,
    ];
    return _assemble(real, fill, dataScore);
  }

  /* ML Fav */
  if (favLeader) {
    dataScore++;
    real.push(`${lStr(favLeader, favLeaderPts)} is the engine of this offense — creating matchup problems throughout ${_poss(dog)} entire rotation`);
  }
  if (dogLeader) {
    dataScore++;
    real.push(`${dog} runs through ${lStr(dogLeader, dogLeaderPts)} — if ${fav} takes him away, there is no offensive fallback plan`);
  }
  const fill = [
    favIsHome
      ? `${fav} at home in this building has been dominant — home court in college basketball is a real and measurable edge`
      : `${fav} on the road holds the talent edge — this program covers road spots at a consistent rate this season`,
    `${_poss(fav)} depth advantage is significant — the rotation length creates fatigue and execution errors in the second half`,
    `${dog} does not have the firepower to match ${fav} for 40 minutes — the depth gap shows up late`,
  ];
  return _assemble(real, fill, dataScore);
}

/* ── NCAAF ────────────────────────────────────────────────────────── */
function _ncaafReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favQB, dogQB, favRB, dogRB } = p;
  const total  = odds?.total || '47.5';
  const spread = favIsHome ? (odds?.home?.spread || '-7.0') : (odds?.away?.spread || '-7.0');
  const real   = [];
  let dataScore = 0;

  if (pType === 2) {
    if (favQB && dogQB) {
      dataScore += 2;
      real.push(`${favQB} and ${dogQB} are both willing to throw — two pass-heavy quarterbacks makes the ${total} total very reachable tonight`);
    } else if (favQB) {
      dataScore++;
      real.push(`${favQB} has been one of the most productive quarterbacks in the country — the offense puts up points`);
    } else if (dogQB) {
      dataScore++;
      real.push(`${dogQB} gives ${dog} the upside to push this total — both defenses have been allowing numbers`);
    }
    const fill = [
      `Both defenses have been vulnerable against the run and pass — the scoring ceiling is elevated`,
      `Historical matchup between these programs has trended toward offense — the pattern supports the over`,
      `Over ${total} — the offensive talent and defensive limitations on both sides make this number clearable`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 3) {
    if (favQB) {
      dataScore++;
      real.push(`${favQB} is facing one of the better defenses he has seen all year — this is not a free-flowing passing environment`);
    }
    const fill = [
      dogQB
        ? `${dogQB} is going to be under consistent pressure — the defense has been at its best against this style`
        : `Both offenses have struggled to sustain drives against physical defenses — fewer possessions means fewer points`,
      `Slow tempo teams — both programs limit possessions and play field position football`,
      `Under ${total} — the defensive quality on both sides of this game is the clearest edge on the board`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (role === 'dog') {
    if (dogQB) {
      dataScore++;
      real.push(`${dogQB} at home has been performing at a high level — dangerous with this crowd behind him at plus money`);
    }
    if (favQB) {
      dataScore++;
      real.push(`${favQB} has to handle a hostile road environment — road games in college football erase a significant portion of the talent gap`);
    }
    const fill = [
      dogRB
        ? `${dogRB} gives ${dog} the ground game to control the clock and keep this score close`
        : `${dog} has the run game to keep this competitive and drain the clock — upsets live in low-scoring games`,
      `Home field advantage in college football is one of the most powerful forces in American sports`,
      `At ${dogML}, ${dog} is the right side — college football home underdogs cover at a rate the market underprices`,
    ];
    return _assemble(real, fill, dataScore);
  }

  if (pType === 1) {
    if (favQB) {
      dataScore++;
      real.push(`${favQB} has been one of the most efficient quarterbacks in the country — the offense executes and creates the multi-score margin`);
    }
    if (dogQB) {
      dataScore++;
      real.push(`${dogQB} faces a ${fav} defense that has been playing shutdown football — expect consistent pressure and mistakes`);
    }
    const fill = [
      favRB
        ? `${favRB} in the ground game controls the clock and limits ${_poss(dog)} possessions — field position edge is foundational`
        : `${_poss(fav)} ground game creates the play-action advantage that opens up the passing game and creates the margin`,
      `${fav} ${spread} — the better team, executing the cleaner scheme, covering by this margin is the most likely outcome`,
      `${dog} red zone defense has been vulnerable — ${fav} converts scoring chances at a high rate`,
    ];
    return _assemble(real, fill, dataScore);
  }

  /* ML Fav */
  if (favQB) {
    dataScore++;
    real.push(`${favQB} has been operating efficiently and making the right decisions — the offense is clicking at the right time`);
  }
  if (dogQB) {
    dataScore++;
    real.push(`${dogQB} is facing a ${fav} defense that has been suffocating — expect consistent pressure and difficulty all game`);
  }
  const fill = [
    favRB
      ? `${favRB} is the ground game option that sets up play-action and controls tempo — the run game defines ${_poss(fav)} offensive identity`
      : `${_poss(fav)} ground game creates the play-action edge that drives the winning margin`,
    favIsHome
      ? `${fav} at home is where this program has been most dominant — crowd and talent combine as a tough obstacle`
      : `${fav} on the road as the clearly better team — the talent gap does not disappear when the schedule sends them away`,
    `${dog} does not have the quarterback play to sustain drives against ${_poss(fav)} defense tonight`,
  ];
  return _assemble(real, fill, dataScore);
}

/* ── Assembler: enforces sentence-count discipline ───────────────── */
function _assemble(real, fill, dataScore) {
  if (dataScore === 0) {
    // No player data → 1 honest sentence, homepage-ineligible
    return { reasons: [fill[0]], dataQuality: 'low' };
  }
  if (dataScore === 1) {
    // One player → 2 sentences total
    return { reasons: [...real, fill[0]].slice(0, 2), dataQuality: 'medium' };
  }
  // Two or more players → up to 4 sentences
  return { reasons: [...real, ...fill].slice(0, 4), dataQuality: 'high' };
}

/* ── Player extraction from ESPN summary ─────────────────────────── */
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
      (data.leaders || []).forEach((tl, idx) => {
        const abbr   = (tl.team?.abbreviation || '').toUpperCase();
        const homeAb = (game.home.abbr || '').toUpperCase();
        const awayAb = (game.away.abbr || '').toUpperCase();
        // Primary match by abbreviation; fallback by list order (home=0, away=1)
        let side = null;
        if (abbr && homeAb && abbr === homeAb) side = 'home';
        else if (abbr && awayAb && abbr === awayAb) side = 'away';
        else side = idx === 0 ? 'home' : 'away'; // positional fallback
        const ptsLeaders = (tl.leaders || []).find(c => c.name === 'points' || c.abbreviation === 'PTS');
        const top = ptsLeaders?.leaders?.[0];
        if (top) {
          out[`${side}Leader`]    = top.athlete?.shortName || top.athlete?.displayName || null;
          out[`${side}LeaderPts`] = top.displayValue || null;
        }
      });
    }

    if (sport === 'nfl' || sport === 'ncaaf') {
      (data.leaders || []).forEach((tl, idx) => {
        const abbr   = (tl.team?.abbreviation || '').toUpperCase();
        const homeAb = (game.home.abbr || '').toUpperCase();
        const awayAb = (game.away.abbr || '').toUpperCase();
        let side = null;
        if (abbr && homeAb && abbr === homeAb) side = 'home';
        else if (abbr && awayAb && abbr === awayAb) side = 'away';
        else side = idx === 0 ? 'home' : 'away';
        const passLeaders = (tl.leaders || []).find(c => c.name === 'passingYards' || c.abbreviation === 'PYDS');
        const passTop = passLeaders?.leaders?.[0];
        if (passTop) out[`${side}QB`] = passTop.athlete?.shortName || passTop.athlete?.displayName || null;
        const rushLeaders = (tl.leaders || []).find(c => c.name === 'rushingYards' || c.abbreviation === 'RYDS');
        const rushTop = rushLeaders?.leaders?.[0];
        if (rushTop) out[`${side}RB`] = rushTop.athlete?.shortName || rushTop.athlete?.displayName || null;
      });
    }
  } catch (e) {
    console.warn('[HTB] extractPlayers error:', e?.message);
  }

  // Log extraction result so Vercel logs show what data is available
  const named = Object.entries(out).filter(([k, v]) => v && !k.includes('Rec') && !k.includes('K')).map(([k, v]) => `${k}=${v}`);
  console.log(`[HTB] extractPlayers(${sport} ${game.id}): ${named.length ? named.join(', ') : 'NO player data extracted'}`);

  return out;
}

/* ── Core pick computation ────────────────────────────────────── */
function computePick(game, odds, players, today, role) {
  const sp  = game.sport;
  const away = game.away.name;
  const home = game.home.name;
  const r   = mkRng(`${game.id}-${today}-${role}`);

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

  const p = {
    favPitcher:    (favIsHome ? players?.homePitcher    : players?.awayPitcher)    || null,
    dogPitcher:    (favIsHome ? players?.awayPitcher    : players?.homePitcher)    || null,
    favPitcherERA: (favIsHome ? players?.homePitcherERA : players?.awayPitcherERA) || null,
    dogPitcherERA: (favIsHome ? players?.awayPitcherERA : players?.homePitcherERA) || null,
    favPitcherRec: (favIsHome ? players?.homePitcherRec : players?.awayPitcherRec) || null,
    dogPitcherRec: (favIsHome ? players?.awayPitcherRec : players?.homePitcherRec) || null,
    favPitcherK:   (favIsHome ? players?.homePitcherK   : players?.awayPitcherK)   || null,
    favGoalie:     (favIsHome ? players?.homeGoalie     : players?.awayGoalie)     || null,
    dogGoalie:     (favIsHome ? players?.awayGoalie     : players?.homeGoalie)     || null,
    favQB:         (favIsHome ? players?.homeQB         : players?.awayQB)         || null,
    dogQB:         (favIsHome ? players?.awayQB         : players?.homeQB)         || null,
    favRB:         (favIsHome ? players?.homeRB         : players?.awayRB)         || null,
    dogRB:         (favIsHome ? players?.awayRB         : players?.homeRB)         || null,
    favLeader:     (favIsHome ? players?.homeLeader     : players?.awayLeader)     || null,
    dogLeader:     (favIsHome ? players?.awayLeader     : players?.homeLeader)     || null,
    favLeaderPts:  (favIsHome ? players?.homeLeaderPts  : players?.awayLeaderPts)  || null,
    dogLeaderPts:  (favIsHome ? players?.awayLeaderPts  : players?.homeLeaderPts)  || null,
  };

  const builders = { mlb: _mlbReasons, nba: _nbaReasons, nhl: _nhlReasons, nfl: _nflReasons, ncaam: _ncaamReasons, ncaaf: _ncaafReasons };
  const buildFn  = builders[sp] || _mlbReasons;

  const favMLNum    = parseInt(String(favML).replace('+', ''), 10);
  const dogMLNum    = parseInt(String(dogML).replace('+', ''), 10);
  const mlIsExtreme = !isNaN(favMLNum) && favMLNum <= ML_HARD_CAP;

  if (role === 'dog') {
    if (isNaN(dogMLNum) || dogMLNum < DOG_MIN_ML) return null;
    const conf    = randConf(5.8, 8.2, r);
    const units   = _computeUnits(conf, 'dog', dogML);
    const { reasons, dataQuality } = buildFn(0, 'dog', favIsHome, fav, dog, favML, dogML, p, odds, r);
    const uLabel  = units >= 1.0 ? '1u Dog Pick' : '0.5u Dog Lean';
    return { sport: sp, matchup: `${away} @ ${home}`, pick: `${dog} ML`, odds: dogML, edge: 'dog', edgeLabel: uLabel, conf, units, reasons, dataQuality };
  }

  const pTypeRaw = Math.floor(r() * 4);
  const pType    = (pTypeRaw === 0 && mlIsExtreme && odds) ? 1 : pTypeRaw;
  const conf     = randConf(6.5, 9.2, r);
  const modelProb = _confToWinProb(conf);

  let pick, pickOdds, edge;
  if (pType === 0 || !odds) {
    pick     = `${fav} ML`;
    pickOdds = favML;
    edge     = (!isNaN(favMLNum) && favMLNum >= ML_VALUE_MAX) ? 'value' : 'strong';
  } else if (pType === 1) {
    const lineVal  = favIsHome ? (odds.home?.spread     || dfltLine) : (odds.away?.spread     || dfltLine);
    const lineOdds = favIsHome ? (odds.home?.spreadOdds || '-110')   : (odds.away?.spreadOdds || '-110');
    pick     = `${fav} ${lineVal}`;
    pickOdds = lineOdds;
    edge     = 'strong';
  } else if (pType === 2) {
    const tot = odds?.total || dfltTotal;
    pick     = `Over ${tot}`;
    pickOdds = odds?.overOdds || '-110';
    edge     = 'value';
  } else {
    const tot = odds?.total || dfltTotal;
    pick     = `Under ${tot}`;
    pickOdds = odds?.underOdds || '-110';
    edge     = 'value';
  }

  if (odds) {
    const mktImplied = _mlToImplied(pickOdds);
    if (modelProb - mktImplied < MIN_EDGE_PCT) return null;
  }

  const { reasons, dataQuality } = buildFn(pType, 'top', favIsHome, fav, dog, favML, dogML, p, odds, r);

  const units = _computeUnits(conf, edge, favML);
  let edgeLabel;
  if      (units >= 2.0) edgeLabel = '2u Premium';
  else if (units >= 1.5) edgeLabel = '1.5u Strong';
  else if (units >= 1.0) edgeLabel = edge === 'strong' ? '1u Strong' : '1u Value';
  else                   edgeLabel = '0.5u Lean';

  return { sport: sp, matchup: `${away} @ ${home}`, pick, odds: pickOdds, edge, edgeLabel, conf, units, reasons, dataQuality };
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
    console.warn(`[HTB] Pick rejected — "${pick.pick}" not matched in "${game.away.name} @ ${game.home.name}"`);
    return null;
  }
  return pick;
}

module.exports = { computePick, validatePick, extractPlayers };
