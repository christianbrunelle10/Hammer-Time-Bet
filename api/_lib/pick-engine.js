/**
 * HammerTimeBet — Pick Engine (Node.js / CommonJS)
 *
 * Reason generation is data-anchored: every sentence tries to use a real
 * player name, real stat, or real matchup context from ESPN data.
 * Generic market copy is only used as a last resort when no player data exists.
 *
 * Each builder returns { reasons: string[4], dataQuality: 'high'|'medium'|'low' }
 * dataQuality is stored on the pick and used by homepage curation scoring.
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
function _pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
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

/* ── Possessive helper ──────────────────────────────────────────── */
function _poss(name) {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/* ── ERA quality helper ─────────────────────────────────────────── */
function _eraGrade(era) {
  const n = parseFloat(era);
  if (isNaN(n) || !era) return null;
  if (n < 3.00) return 'elite';
  if (n < 3.75) return 'solid';
  if (n < 4.50) return 'average';
  if (n < 5.50) return 'elevated';
  return 'poor';
}

/* ═══════════════════════════════════════════════════════════════════
   SPORT REASON BUILDERS
   Each returns { reasons: string[], dataQuality: 'high'|'medium'|'low' }
   pType: 0=ML, 1=spread/runline/puckline, 2=over, 3=under
   role: 'top' | 'dog'
═══════════════════════════════════════════════════════════════════ */

function _mlbReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const {
    favPitcher, dogPitcher,
    favPitcherERA, dogPitcherERA,
    favPitcherRec, dogPitcherRec,
    favPitcherK,
  } = p;

  const reasons = [];
  let dataScore = 0;
  const total   = odds?.total || '8.0';
  const spread  = favIsHome ? (odds?.home?.spread || '-1.5') : (odds?.away?.spread || '-1.5');

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (dogPitcher && dogPitcherERA) {
      dataScore++;
      const grade = _eraGrade(dogPitcherERA);
      if (grade === 'elevated' || grade === 'poor') {
        r1.push(`${dogPitcher} (${dogPitcherERA} ERA) has been giving up runs at an elevated clip — ${fav} figures to do damage against him tonight`);
      } else {
        r1.push(`${dogPitcher} (${dogPitcherERA} ERA) is not a lockdown starter — ${fav} offense has enough pop to push this total`);
      }
    }
    if (favPitcher && favPitcherERA) {
      dataScore++;
      const grade = _eraGrade(favPitcherERA);
      if (grade === 'elevated' || grade === 'poor') {
        r1.push(`${favPitcher} (${favPitcherERA} ERA) has been hittable — ${dog} lineup has the upside to keep scoring against him`);
      }
    }
    if (!r1.length) r1.push(`Both starters have been hittable in recent outings — the run-scoring environment favors the over tonight`);
    reasons.push(_pick(r1, r));
    reasons.push(`${dog} has been scoring consistently and ${fav} offense has been productive — both sides have legitimate run-scoring upside`);
    reasons.push(`Neither bullpen is in a position to put up zeros if a lead develops — late-inning scoring is a real possibility`);
    reasons.push(`The ${total} total is in range for both offenses given the pitching matchup tonight — lean to the over`);
    return { reasons, dataQuality: dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    const r1 = [];
    if (favPitcher && favPitcherERA) {
      dataScore++;
      const grade = _eraGrade(favPitcherERA);
      const obs = grade === 'elite' ? ' — at that ERA level, he\'s as good as anyone in baseball right now'
                : grade === 'solid' ? ' — consistent enough to keep ${dog} from putting up a big number'
                : '';
      r1.push(`${favPitcher} (${favPitcherERA} ERA) is the anchor here${obs.replace('${dog}', dog)}`);
    }
    if (dogPitcher && dogPitcherERA) {
      dataScore++;
      const grade = _eraGrade(dogPitcherERA);
      if (grade === 'elite' || grade === 'solid') {
        r1.push(`${dogPitcher} (${dogPitcherERA} ERA) is pitching at a high level — two quality starters set up a low-scoring game`);
      }
    }
    if (!r1.length) r1.push(`Strong pitching matchup tonight — both starters have the stuff to keep the scoring in check`);
    reasons.push(_pick(r1, r));
    if (favPitcher && dogPitcher) {
      reasons.push(`The ${favPitcher} vs ${dogPitcher} matchup is a pitcher's duel setup — run prevention is the story on both sides`);
    } else {
      reasons.push(`Both offenses have been inconsistent at the plate recently — scoring pace is tracking below this total`);
    }
    reasons.push(`Both bullpens have the depth to protect late leads — the under is the play when neither team has a clear offense edge`);
    reasons.push(`Under ${total} — the pitching quality on display tonight is the clearest edge on this board`);
    return { reasons, dataQuality: dataScore >= 2 ? 'medium' : 'low' };
  }

  /* Run line ──────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favPitcher) {
      dataScore++;
      const era = favPitcherERA ? ` (${favPitcherERA} ERA)` : '';
      const rec = favPitcherRec ? `, ${favPitcherRec} on the season` : '';
      r1.push(`${favPitcher}${era}${rec} on the hill — the depth to go 6+ innings is how ${fav} creates the margin for the run line`);
      r1.push(`When ${favPitcher}${era} is going deep into games, ${fav} tends to win by multiple runs — run line is live`);
    } else {
      r1.push(`${fav} holds the mound advantage — quality starts from this rotation lead to decisive winning margins`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogPitcher) {
      dataScore++;
      const era = dogPitcherERA ? ` (${dogPitcherERA} ERA)` : '';
      r2.push(`${dogPitcher}${era} has been prone to giving up crooked numbers — free baserunners pile up into multi-run innings for ${fav}`);
      r2.push(`${dog} counters with ${dogPitcher}${era} — a starter who has been unable to strand runners, which opens the door for ${fav} to cover`);
    } else {
      r2.push(`${_poss(dog)} rotation is the clear weakness in this matchup — ${fav} lineup is capable of putting up a multi-run number`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(`${_poss(fav)} bullpen has the depth to protect a lead deep into the game — the run line stays alive into the final innings`);
    reasons.push(`Run line at ${spread} offers better price than the straight moneyline — the pitching edge supports this margin`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogPitcher) {
      dataScore++;
      const era = dogPitcherERA ? ` (${dogPitcherERA} ERA)` : '';
      const rec = dogPitcherRec ? `, ${dogPitcherRec}` : '';
      const grade = _eraGrade(dogPitcherERA);
      const obs = (grade === 'elite' || grade === 'solid')
        ? ' — that level of performance makes this team dangerous regardless of the price'
        : '';
      r1.push(`${dogPitcher}${era}${rec} takes the mound for ${dog}${obs} — a starter in this form makes the plus money worth considering`);
      r1.push(`${dog} sends ${dogPitcher}${era} to the hill${rec} — the market is undervaluing what this pitcher brings to tonight's matchup`);
    } else {
      r1.push(`${dog} has the pitching situation to keep this game competitive — the plus money at ${dogML} represents real value`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (favPitcher) {
      dataScore++;
      const era = favPitcherERA ? ` (${favPitcherERA} ERA)` : '';
      r2.push(`${favPitcher}${era} is the clear ace in this matchup — but ${dog} has seen this type of arm before and the lineup is capable of keeping it close`);
      r2.push(`${fav} counters with ${favPitcher}${era}, but the gap between these rotations at ${dogML} more than compensates for the difference`);
    } else {
      r2.push(`${fav} holds the rotation edge, but the plus-money price on ${dog} more than covers the pitching gap`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favIsHome
      ? `${dog} on the road has been more competitive than the market accounts for — the away record holds up in spots like this`
      : `${dog} at home is where you want them as an underdog — the crowd and comfort factor are real in this building`
    );
    reasons.push(`At ${dogML}, ${dog} offers positive EV — this type of upset only needs to happen in roughly 1-in-3 of these spots to be profitable`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favPitcher) {
    dataScore++;
    const era = favPitcherERA ? ` (${favPitcherERA} ERA)` : '';
    const rec = favPitcherRec ? `, ${favPitcherRec} this season` : '';
    const kNote = favPitcherK ? ` with ${favPitcherK} strikeouts on the year` : '';
    const grade = _eraGrade(favPitcherERA);
    const qualifier = grade === 'elite' ? ' — as good a mound advantage as you will find on today\'s board'
                    : grade === 'solid' ? ' — the pitching edge is clear before first pitch'
                    : '';
    r1.push(`${favPitcher}${era}${rec}${kNote} takes the ball for ${fav}${qualifier}`);
    r1.push(`${fav} hands the ball to ${favPitcher}${era}${rec} — ${dog} is going to have to solve a real problem at the top of this rotation`);
  } else {
    r1.push(`${fav} holds the mound advantage in this matchup — the pitching situation is the clearest edge entering tonight`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogPitcher) {
    dataScore++;
    const era = dogPitcherERA ? ` (${dogPitcherERA} ERA)` : '';
    const grade = _eraGrade(dogPitcherERA);
    const obs = grade === 'elevated' ? ` — that ERA tells the story of a starter ${fav} lineup can exploit`
              : grade === 'poor'     ? ` — command problems have created real opportunities for opposing offenses`
              : ` — ${fav} lineup is set up to do damage against this style of starter`;
    r2.push(`${dogPitcher}${era} counters for ${dog}${obs}`);
    r2.push(`The ${dog} rotation sends ${dogPitcher}${era} to the mound — matchup edge goes to ${fav} in the pitching department`);
  } else {
    r2.push(`${_poss(dog)} rotation is a weakness in this spot — ${fav} lineup should find runs early in the game`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favIsHome
    ? `${fav} at home with their best starter — the crowd and comfort factor compounds the pitching edge`
    : `${fav} on the road with ${favPitcher || 'an ace-caliber arm'} — this is the type of spot where road favorites deliver`
  );
  reasons.push(`${_poss(fav)} lineup has been producing with runners on base — the offense can back up the pitching advantage tonight`);
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

/* ── NBA ─────────────────────────────────────────────────────────── */
function _nbaReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favLeader, dogLeader, favLeaderPts, dogLeaderPts } = p;
  const reasons   = [];
  let dataScore   = 0;
  const total     = odds?.total || '220.5';
  const spread    = favIsHome ? (odds?.home?.spread || '-5.0') : (odds?.away?.spread || '-5.0');

  const leaderStr = (name, pts) => pts ? `${name} (${pts} PPG)` : name;

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (favLeader && dogLeader) {
      dataScore += 2;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} and ${leaderStr(dogLeader, dogLeaderPts)} are both capable of putting up 30 — the individual battle alone pushes this total`);
    } else if (favLeader) {
      dataScore++;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} is the engine of this offense — the scoring burden falls on him and the total reflects that upside`);
    } else {
      r1.push(`Both offenses have been playing at a high tempo — the scoring ceiling is elevated in this specific matchup`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(`Both teams rank near the top in pace — this game should run at a high tempo from the opening tip`);
    reasons.push(`Neither defense has been effective against this opponent\'s offensive style — the scoring ceiling is real`);
    reasons.push(`Over ${total} — both offenses have the talent and tempo to clear this number if the game stays competitive late`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    reasons.push(favLeader
      ? `${_poss(fav)} offense runs through ${favLeader} — when both defenses are locked in, perimeter scoring gets suppressed`
      : `Both defenses have been playing at an elite level — the scoring pace is tracking well below this total`
    );
    reasons.push(`Slow halfcourt pace expected — both coaching staffs prioritize defensive stops in this type of matchup`);
    reasons.push(`Late-game possession management from both benches should keep the final number clean — under is the play`);
    reasons.push(`Under ${total} — the defensive quality on both sides of this game is the clearest bet on the board tonight`);
    return { reasons, dataQuality: favLeader ? 'medium' : 'low' };
  }

  /* Spread ─────────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favLeader) {
      dataScore++;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} is creating matchup problems ${dog} has no answer for — the talent gap shows up in the box score`);
      r1.push(`${favLeader} has been the most efficient player in this matchup — the advantage compounds through the entire ${fav} lineup`);
    } else {
      r1.push(`${fav} has a real talent and depth edge in this game — that gap shows up as a margin in the final score`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogLeader) {
      dataScore++;
      r2.push(`${dog} runs through ${leaderStr(dogLeader, dogLeaderPts)} — if ${fav} can contain the primary scoring option, the offense has no fallback`);
    } else {
      r2.push(`${dog} lacks the depth to match ${fav} possession for possession — the bench gap is the margin in this game`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favIsHome
      ? `${fav} at home as a favorite has been excellent — the crowd and preparation advantage are real factors tonight`
      : `${fav} on the road has been covering at a high rate — the talent advantage travels`
    );
    reasons.push(`${fav} ${spread} — the better team covering by this margin is the realistic and most likely outcome tonight`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogLeader) {
      dataScore++;
      r1.push(`${leaderStr(dogLeader, dogLeaderPts)} is capable of taking over this game — a scorer of this caliber makes ${dog} dangerous at any number`);
      r1.push(`${dogLeader} has been the most dangerous player in this matchup — ${fav} has had no consistent answer for him`);
    } else {
      r1.push(`${dog} at home has been a difficult out this season — the home court advantage is real and worth the plus-money risk`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (favLeader) {
      dataScore++;
      r2.push(`${fav} runs through ${leaderStr(favLeader, favLeaderPts)}, but ${dog} has shown it can disrupt primary ball-handlers and force the rest of the lineup to create`);
    } else {
      r2.push(`${fav} is the better team but the ${dogML} number implies a wider gap than the actual talent difference justifies`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favIsHome
      ? `${dog} on the road has been more competitive than the market reflects — the road record is a real counter to the price`
      : `${dog} at home with this lineup is where you want them as an underdog — do not dismiss the home floor advantage`
    );
    reasons.push(`At ${dogML}, ${dog} only needs to win this type of game occasionally to show long-term profit — the EV is on the right side`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favLeader) {
    dataScore++;
    r1.push(`${leaderStr(favLeader, favLeaderPts)} is the engine of this offense — creating matchup problems ${dog} has no consistent answer for`);
    r1.push(`${favLeader} has been at his best in high-leverage spots — ${fav} is the team you want when a scorer is playing at this level`);
  } else {
    r1.push(`${fav} has been one of the best two-way teams in the league recently — the talent edge is clear at both ends`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogLeader) {
    dataScore++;
    r2.push(`${dog} runs through ${leaderStr(dogLeader, dogLeaderPts)} — if ${fav} contains the primary option, the offense has no fallback plan`);
    r2.push(`${dogLeader} is ${_poss(dog)} best chance to keep this close, but ${fav} has the defensive versatility to make his night difficult`);
  } else {
    r2.push(`${dog} lacks the offensive firepower to match ${fav} at their current level — the depth gap is real and exploitable tonight`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favIsHome
    ? `${fav} at home has been dominant — the crowd and routine advantage have been meaningful factors throughout the season`
    : `${fav} on the road with this roster is still the better team — the talent advantage doesn\'t disappear away from home`
  );
  reasons.push(`${fav} at ${favML} — a number that reflects the real gap between these two rosters in current form`);
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

/* ── NHL ─────────────────────────────────────────────────────────── */
function _nhlReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favGoalie, dogGoalie } = p;
  const reasons = [];
  let dataScore = 0;
  const total   = odds?.total || '5.5';
  const spread  = favIsHome ? (odds?.home?.spread || '-1.5') : (odds?.away?.spread || '-1.5');

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (dogGoalie) {
      dataScore++;
      r1.push(`${dogGoalie} has been giving up goals consistently — the vulnerability in the ${dog} crease is the reason to lean to the over`);
    }
    if (favGoalie && !r1.length) r1.push(`Both goalies have been tested heavily this week — neither crease is locked down entering tonight`);
    if (!r1.length) r1.push(`High-tempo matchup between two offenses that have been clicking — the over is the natural play`);
    reasons.push(_pick(r1, r));
    reasons.push(`Both power play units have been active and dangerous lately — a penalty-heavy game pushes the goal total up`);
    reasons.push(`These two teams have been playing high-scoring games in recent head-to-head matchups — offensive history supports the over`);
    reasons.push(`Over ${total} — the goaltending matchup and pace both point toward more scoring than the posted number suggests`);
    return { reasons, dataQuality: dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    const r1 = [];
    if (favGoalie && dogGoalie) {
      dataScore += 2;
      r1.push(`${favGoalie} and ${dogGoalie} are both playing at a high level right now — elite goaltending on both sides sets up a tight, low-scoring game`);
    } else if (favGoalie) {
      dataScore++;
      r1.push(`${favGoalie} has been the best player on the ice for ${fav} this week — that level of goaltending suppresses the total`);
    } else {
      r1.push(`Both goalies are playing well — the defensive structure from both benches is keeping games tight and low-scoring`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(`Both teams in a tight standings position — defensive structure is locked in and disciplined in high-stakes games`);
    reasons.push(`Historical matchup between these two has trended toward defensive battles — the pattern holds tonight`);
    reasons.push(`Under ${total} — the goaltending quality on display makes this total look high for what this game is likely to produce`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Puck line ─────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favGoalie) {
      dataScore++;
      r1.push(`${favGoalie} in net for ${fav} — the crease has been the foundation of their multi-goal wins, and the puck line follows his starts`);
      r1.push(`When ${favGoalie} is at his best, ${fav} has the ability to control games from start to finish — puck line is live`);
    } else {
      r1.push(`${fav} wins by multi-goal margins when the offense is running — puck line coverage tracks their dominant performances`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogGoalie) {
      dataScore++;
      r2.push(`${dogGoalie} has been allowing goals in bunches recently — the puck line exposure is real when you\'re facing a ${fav} offense in this form`);
    } else {
      r2.push(`${dog} has been unable to keep games within one goal consistently — puck line is the right side at the better price`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(`${_poss(fav)} power play has been converting at a strong rate — special teams edge compounds the run line advantage`);
    reasons.push(`Puck line at ${spread} offers a meaningfully better price than the straight moneyline — take the spread tonight`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogGoalie) {
      dataScore++;
      r1.push(`${dogGoalie} is playing at a high level right now — in-form goaltending makes any team dangerous in a one-goal sport like this`);
      r1.push(`${dog} starts ${dogGoalie} — the market is not fully pricing in how well he has been playing, which is where the value comes from`);
    } else {
      r1.push(`${dog} at home has been an excellent underdog this season — this building creates real pressure on visiting teams`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (favGoalie) {
      dataScore++;
      r2.push(`${favGoalie} has shown road vulnerability this season — ${dog} is in position to exploit that trend at home tonight`);
    } else {
      r2.push(`${fav}\'s road performance has been inconsistent — the plus money on ${dog} reflects a real gap in the away-game résumé`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favIsHome
      ? `${dog} on the road in a goaltending-driven sport — if their crease is locked in, they can steal this game at the right price`
      : `${dog} at home in this building — the crowd factor in hockey is amplified, especially in a tight series`
    );
    reasons.push(`At ${dogML}, ${dog} is the best plus-money spot on tonight\'s board — the goaltending situation makes this price too generous`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favGoalie) {
    dataScore++;
    r1.push(`${favGoalie} in net for ${fav} — posting consistent, elite numbers in the crease and giving this team a real foundation to win from`);
    r1.push(`${fav} rides ${favGoalie} tonight — a goalie playing at this level is the single biggest edge in a one-goal sport`);
  } else {
    r1.push(`${fav} holds the goaltending advantage in this matchup — the crease is where games are decided in hockey`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogGoalie) {
    dataScore++;
    r2.push(`${dogGoalie} has shown inconsistency recently — ${fav} offense has the firepower to find the net against a goalie in this form`);
    r2.push(`${dog} starts ${dogGoalie}, but the form line on him suggests vulnerability — ${fav} offense is positioned to exploit it`);
  } else {
    r2.push(`${_poss(dog)} goaltending has been the weak link — ${fav} offense is in position to generate the chances and convert them`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favIsHome
    ? `${fav} protecting home ice — the crowd and familiarity factor are real in hockey, especially in a tight matchup like this`
    : `${fav} on the road with ${favGoalie || 'a quality goalie'} — road wins in hockey start between the pipes`
  );
  reasons.push(`${fav} at ${favML} — the goaltending edge is clear, and that\'s where the money is in hockey`);
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

/* ── NFL ─────────────────────────────────────────────────────────── */
function _nflReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favQB, dogQB, favRB, dogRB } = p;
  const reasons = [];
  let dataScore = 0;
  const total   = odds?.total || '47.5';
  const spread  = favIsHome ? (odds?.home?.spread || '-3.0') : (odds?.away?.spread || '-3.0');

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (favQB && dogQB) {
      dataScore += 2;
      r1.push(`${favQB} and ${dogQB} are both in rhythm — two quarterbacks playing at this level makes the ${total} total very reachable`);
    } else if (favQB) {
      dataScore++;
      r1.push(`${favQB} has been operating at peak efficiency — the offense is going to put up points and push the total`);
    } else {
      r1.push(`Both offenses have been scoring at a high clip — this total is in range for what these teams have been doing`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(`Both teams rank near the top in offensive efficiency — high-tempo play expected from the opening drive`);
    reasons.push(`Neither secondary is at full strength — both QBs are going to find favorable matchups and exploit them`);
    reasons.push(`Over ${total} — the combined offensive production from both sides makes this number clearable tonight`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    const r1 = [];
    if (favQB) {
      dataScore++;
      r1.push(`${favQB} is facing one of the better defensive units he will see this year — expect a controlled, lower-tempo game`);
    } else {
      r1.push(`Both defenses have been outstanding recently — elite units on both sides set up a lower-scoring game`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(dogQB
      ? `${dogQB} faces a defense that has been playing at an elite level — this is not a comfortable passing environment`
      : `Both offenses have struggled to sustain drives against quality defenses — this matchup has the makings of a grinder`
    );
    reasons.push(`Weather or game-flow factors may slow the pace — conservative game management expected from both coaching staffs`);
    reasons.push(`Under ${total} — the defensive quality on both sides exceeds what this total is priced at`);
    return { reasons, dataQuality: dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Spread ─────────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favQB) {
      dataScore++;
      r1.push(`${favQB} operating at peak efficiency — the offense is clicking in all three phases and that shows up in the margin`);
      r1.push(`${fav} goes through ${favQB} — a quarterback playing at this level takes the ball and covers the spread`);
    } else {
      r1.push(`${fav} has a real scheme and execution edge — that kind of dominance creates sustained field position and covers the spread`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogQB) {
      dataScore++;
      r2.push(`${dogQB} is facing a ${fav} defense that is playing at its best — he will be under pressure and forced into mistakes`);
      r2.push(`${dog} runs through ${dogQB}, but ${fav} has the defensive scheme to take him out of his comfort zone`);
    } else {
      r2.push(`${dog} does not have the quarterback play to keep up with ${fav} on a neutral field — the spread reflects a real gap`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favRB
      ? `${favRB} in the ground game controls the clock and opens up play-action — the run game is the foundation of ${_poss(fav)} scheme tonight`
      : `${_poss(fav)} ground game is an underrated edge here — run blocking advantage translates directly to the spread`
    );
    reasons.push(`${fav} ${spread} — the better team, executing the cleaner game plan, covering by this margin is the most realistic outcome`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogQB) {
      dataScore++;
      r1.push(`${dogQB} at home has been performing at a high level — do not dismiss a quarterback with this experience at plus money`);
      r1.push(`${dog} goes through ${dogQB} — in this building, he has shown the ability to manage the game and keep the score close`);
    } else {
      r1.push(`${dog} at home is a dangerous underdog — the home crowd factor in this stadium is not to be dismissed`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (favQB) {
      dataScore++;
      r2.push(`${favQB} has to handle a hostile road environment — that is a real factor when the ${dogML} implies more certainty than the game will deliver`);
    } else {
      r2.push(`${fav} on the road faces a prepared ${dog} team — road conditions erase part of the talent gap`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(dogRB
      ? `${dogRB} provides the ground game option that keeps ${dog} competitive and controls the clock — field position matters at this level`
      : `${dog} has the ground game to keep this competitive and drain the clock — a low-scoring game is where the upset happens`
    );
    reasons.push(`At ${dogML}, ${dog} is the most interesting plus-money spot on today\'s board — this type of game is decided by single plays`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favQB) {
    dataScore++;
    r1.push(`${favQB} is operating at peak efficiency — the offense is in sync and he is making the right decisions in high-pressure moments`);
    r1.push(`${fav} goes through ${favQB} — a quarterback at this level makes the team a difficult out at any price`);
  } else {
    r1.push(`${fav} has the better quarterback and scheme in this matchup — execution and depth advantage is clear`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogQB) {
    dataScore++;
    r2.push(`${dogQB} has been under pressure and making costly errors in recent games — ${fav} defense is exactly the type to force those situations`);
    r2.push(`${dog} relies on ${dogQB} to create, but ${fav} has the defensive personnel to disrupt the timing and force him into bad decisions`);
  } else {
    r2.push(`${dog} does not have the quarterback play to sustain drives against ${_poss(fav)} defense — the field position game tips strongly to ${fav}`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favRB
    ? `${favRB} in the ground game opens up play-action and controls the tempo — ${fav} wins the time-of-possession battle and limits ${_poss(dog)} opportunities`
    : `${_poss(fav)} ground game creates the play-action advantage that this offense needs to run their scheme effectively`
  );
  reasons.push(favIsHome
    ? `${fav} at home with the better quarterback — the preparation and crowd advantage is real at this level`
    : `${fav} on the road is still the better team — the talent gap doesn\'t flip when they leave their building`
  );
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

/* ── NCAAM ────────────────────────────────────────────────────────── */
function _ncaamReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favLeader, dogLeader, favLeaderPts, dogLeaderPts } = p;
  const reasons = [];
  let dataScore = 0;
  const total   = odds?.total || '145.5';
  const spread  = favIsHome ? (odds?.home?.spread || '-4.5') : (odds?.away?.spread || '-4.5');

  const leaderStr = (name, pts) => pts ? `${name} (${pts} PPG)` : name;

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (favLeader && dogLeader) {
      dataScore += 2;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} and ${leaderStr(dogLeader, dogLeaderPts)} are both capable of 25+ — the individual star battle alone pushes this total`);
    } else if (favLeader) {
      dataScore++;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} is the offensive engine — the volume required for this team to win pushes the total`);
    } else {
      r1.push(`Both teams have been playing at a high tempo — expect a high-scoring, up-and-down game tonight`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(`Both teams rank near the top nationally in offensive pace — this matchup has the ingredients for a shootout`);
    reasons.push(`Neither defense has the personnel to slow down the opponent\'s primary offensive players tonight`);
    reasons.push(`Over ${total} — the offensive talent in this game and the defensive limitations on both sides make this number clearable`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    reasons.push(favLeader
      ? `${fav} runs through ${favLeader} — when both defenses lock in and take away the star, the scoring pace drops below this number`
      : `Both defenses have been outstanding nationally — elite defensive units clashing in this game keep the total in check`
    );
    reasons.push(`Slow tempo expected — both programs play at a deliberate pace that limits possessions and scoring`);
    reasons.push(`Both coaches prioritize defensive stops above offensive pace — this game has the makings of a grinder`);
    reasons.push(`Under ${total} — the defensive quality on both sides makes this total look too high for what this game will produce`);
    return { reasons, dataQuality: favLeader ? 'medium' : 'low' };
  }

  /* Spread ─────────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favLeader) {
      dataScore++;
      r1.push(`${leaderStr(favLeader, favLeaderPts)} is posting elite numbers and creating matchup problems ${dog} has no consistent answer for`);
      r1.push(`${favLeader} has been the best player in this matchup all season — the talent gap translates directly to the margin`);
    } else {
      r1.push(`${fav} has a real efficiency and depth edge in this game — the talent gap shows up in the final margin`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogLeader) {
      dataScore++;
      r2.push(`${dog} relies on ${leaderStr(dogLeader, dogLeaderPts)} to generate offense — if ${fav} takes him away, the attack has nowhere to go`);
    } else {
      r2.push(`${dog} lacks the offensive firepower to keep up with ${fav} at their current level — the spread reflects a real gap`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favIsHome
      ? `${fav} at home as a favorite in college basketball — the crowd and atmosphere advantage is among the most powerful in sports`
      : `${fav} on the road still holds the talent edge — this program covers as a road favorite at a consistent rate`
    );
    reasons.push(`${fav} ${spread} — the better team, playing at a high level, covering by this margin is the most likely outcome tonight`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogLeader) {
      dataScore++;
      r1.push(`${leaderStr(dogLeader, dogLeaderPts)} is capable of a monster performance — a proven high-volume scorer can carry a team on the right night`);
      r1.push(`${dogLeader} is the reason ${dog} is dangerous at plus money — he can take over and make the market look wrong`);
    } else {
      r1.push(`${dog} at home as an underdog is one of the highest-variance spots in college basketball — the crowd can swing this game`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(favLeader
      ? `${fav} runs through ${leaderStr(favLeader, favLeaderPts)} — if ${dog} can disrupt the primary option, the offense loses its rhythm`
      : `${fav} is the better team but the ${dogML} price implies more certainty than a college basketball game actually delivers`
    );
    reasons.push(`Home floor advantage in college basketball is one of the most significant edges in American sports — this building matters`);
    reasons.push(`At ${dogML}, ${dog} is the right plus-money spot — the upset probability is well above what the market is implying`);
    if (dogLeader) dataScore++;
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favLeader) {
    dataScore++;
    r1.push(`${leaderStr(favLeader, favLeaderPts)} is the engine of this offense — creating matchup problems throughout ${_poss(dog)} entire rotation`);
    r1.push(`${favLeader} has been at his best in big games this season — ${fav} is the team you back when this scorer is running hot`);
  } else {
    r1.push(`${fav} efficiency has been at an elite level at both ends — real depth and execution advantage in this matchup`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogLeader) {
    dataScore++;
    r2.push(`${dog} runs through ${leaderStr(dogLeader, dogLeaderPts)} — if ${fav} takes him away, there is no offensive fallback plan`);
  } else {
    r2.push(`${dog} does not have the offensive depth to match ${fav} for 40 minutes — the depth gap shows up late in close games`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favIsHome
    ? `${fav} at home as a favorite in this building has been dominant — home court in college basketball is a real and measurable edge`
    : `${fav} on the road holds the talent advantage — this program covers in road spots at a consistent rate this season`
  );
  reasons.push(`${_poss(fav)} depth advantage is significant — the rotation length creates fatigue and execution errors in the second half`);
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

/* ── NCAAF ────────────────────────────────────────────────────────── */
function _ncaafReasons(pType, role, favIsHome, fav, dog, favML, dogML, p, odds, r) {
  const { favQB, dogQB, favRB, dogRB } = p;
  const reasons = [];
  let dataScore = 0;
  const total   = odds?.total || '47.5';
  const spread  = favIsHome ? (odds?.home?.spread || '-7.0') : (odds?.away?.spread || '-7.0');

  /* Over ─────────────────────────────────────────────────────────── */
  if (pType === 2) {
    const r1 = [];
    if (favQB && dogQB) {
      dataScore += 2;
      r1.push(`${favQB} and ${dogQB} are both willing to throw — two pass-happy quarterbacks make the ${total} total very reachable`);
    } else if (favQB) {
      dataScore++;
      r1.push(`${favQB} has been one of the most productive quarterbacks in the country — the offense is going to put up points`);
    } else {
      r1.push(`Both offenses have been allowing big numbers — the scoring ceiling in this specific matchup is elevated`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(`Both defenses have been vulnerable against the run and pass — the scoring potential on both sides is real`);
    reasons.push(`Historical matchup between these programs has trended toward offense — the pattern supports the over tonight`);
    reasons.push(`Over ${total} — the offensive talent on both sides and the defensive limitations make this number clearable`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Under ─────────────────────────────────────────────────────────── */
  if (pType === 3) {
    const r1 = [];
    if (favQB) {
      dataScore++;
      r1.push(`${favQB} is facing one of the better defenses he has seen all year — this is not a free-flowing passing environment`);
    } else {
      r1.push(`Both defenses have been excellent this season — the under is the natural play when two elite units square off`);
    }
    reasons.push(_pick(r1, r));
    reasons.push(dogQB
      ? `${dogQB} is going to be under consistent pressure — the defense has been at its best against quarterbacks of this style`
      : `Both offenses have struggled to sustain drives against physical defenses — fewer possessions means fewer points`
    );
    reasons.push(`Slow tempo teams — both programs limit possessions and play field position football, which keeps the final score low`);
    reasons.push(`Under ${total} — the defensive quality on both sides of this game is the strongest signal on the board tonight`);
    return { reasons, dataQuality: dataScore >= 1 ? 'medium' : 'low' };
  }

  /* Spread ─────────────────────────────────────────────────────────── */
  if (pType === 1) {
    const r1 = [];
    if (favQB) {
      dataScore++;
      r1.push(`${favQB} has been one of the most efficient quarterbacks in the country — the offense executes the scheme and creates the margin`);
      r1.push(`${fav} runs through ${favQB} — a quarterback at this level in this system is the reason the spread is live`);
    } else {
      r1.push(`${fav} has a clear scheme and execution edge — sustained field position control throughout the game is the result`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (dogQB) {
      dataScore++;
      r2.push(`${dogQB} faces a ${fav} defense that has been playing shutdown football — expect pressure and difficult moments throughout`);
      r2.push(`${dog} relies on ${dogQB} to generate offense, but ${fav} has the defensive personnel to disrupt his timing all night`);
    } else {
      r2.push(`${dog} does not have the quarterback play to sustain drives against this level of competition — field position tips to ${fav}`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(favRB
      ? `${favRB} in the ground game controls the clock and limits ${_poss(dog)} possessions — field position edge is foundational to the scheme`
      : `${_poss(fav)} ground game creates the play-action advantage that opens up the passing game and creates the margin`
    );
    reasons.push(`${fav} ${spread} — the better team, executing the cleaner scheme, covering by this margin is the most likely outcome`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Dog ─────────────────────────────────────────────────────────── */
  if (role === 'dog') {
    const r1 = [];
    if (dogQB) {
      dataScore++;
      r1.push(`${dogQB} at home has been performing at a high level — this quarterback is dangerous with the home crowd behind him`);
      r1.push(`${dog} goes through ${dogQB} — in this environment, he has shown the ability to manage games and create explosive plays`);
    } else {
      r1.push(`${dog} at home in college football — the home field advantage is one of the most significant forces in American sports`);
    }
    reasons.push(_pick(r1, r));
    const r2 = [];
    if (favQB) {
      dataScore++;
      r2.push(`${favQB} has to handle a hostile road environment — road games in college football erase a significant portion of the talent gap`);
    } else {
      r2.push(`${fav} on the road faces a prepared ${dog} team — the road conditions and crowd make this game much closer than the price suggests`);
    }
    reasons.push(_pick(r2, r));
    reasons.push(dogRB
      ? `${dogRB} gives ${dog} the ground game to control the clock and keep this score close — time of possession is everything at plus money`
      : `${dog} has the run game to keep this competitive and drain the clock — a low-scoring game is where the upset opportunity lives`
    );
    reasons.push(`At ${dogML}, ${dog} is the play — college football home underdogs cover at a rate the market consistently underprices`);
    return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
  }

  /* ML Fav ─────────────────────────────────────────────────────────── */
  const r1 = [];
  if (favQB) {
    dataScore++;
    r1.push(`${favQB} has been operating efficiently and making the right decisions — the offense is clicking at the right time`);
    r1.push(`${fav} goes through ${favQB} — a quarterback playing at this level is the hardest thing to defend in college football`);
  } else {
    r1.push(`${fav} holds the execution and scheme edge — their offensive system has been a problem for opponents all season`);
  }
  reasons.push(_pick(r1, r));

  const r2 = [];
  if (dogQB) {
    dataScore++;
    r2.push(`${dogQB} is facing a ${fav} defense that has been suffocating — expect consistent pressure and difficulty all game`);
    r2.push(`${dog} relies on ${dogQB}, but ${fav} has the defensive scheme to disrupt his timing and force errors in critical moments`);
  } else {
    r2.push(`${dog} does not have the quarterback play to sustain drives against ${fav} — the field position gap creates the margin`);
  }
  reasons.push(_pick(r2, r));

  reasons.push(favRB
    ? `${favRB} is the ground game option that sets up play-action and controls the game tempo — the run game is the foundation of this scheme`
    : `${_poss(fav)} ground game creates the play-action advantage that defines their offensive identity and drives the winning margin`
  );
  reasons.push(favIsHome
    ? `${fav} at home is where this program has been most dominant — the combination of talent and crowd is difficult to overcome`
    : `${fav} on the road as the clearly better team — the talent gap does not disappear when the schedule takes them away from home`
  );
  return { reasons, dataQuality: dataScore >= 2 ? 'high' : dataScore >= 1 ? 'medium' : 'low' };
}

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
  const sp      = game.sport;
  const spUp    = sp.toUpperCase();
  const away    = game.away.name;
  const home    = game.home.name;
  const r       = mkRng(`${game.id}-${today}-${role}`);

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

  // Build player context object for builders
  const playerCtx = {
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

  const favMLNum    = parseInt(String(favML).replace('+', ''), 10);
  const dogMLNum    = parseInt(String(dogML).replace('+', ''), 10);
  const mlIsExtreme = !isNaN(favMLNum) && favMLNum <= ML_HARD_CAP;

  // Select builder for this sport
  const builders = { mlb: _mlbReasons, nba: _nbaReasons, nhl: _nhlReasons, nfl: _nflReasons, ncaam: _ncaamReasons, ncaaf: _ncaafReasons };
  const buildFn  = builders[sp] || _mlbReasons;

  if (role === 'dog') {
    if (isNaN(dogMLNum) || dogMLNum < DOG_MIN_ML) return null;
    const conf    = randConf(5.8, 8.2, r);
    const units   = _computeUnits(conf, 'dog', dogML);
    const { reasons, dataQuality } = buildFn(0, 'dog', favIsHome, fav, dog, favML, dogML, playerCtx, odds, r);
    const uLabel  = units >= 1.0 ? '1u Dog Pick' : '0.5u Dog Lean';
    return {
      sport: sp, matchup: `${away} @ ${home}`,
      pick: `${dog} ML`, odds: dogML,
      edge: 'dog', edgeLabel: uLabel,
      conf, units, reasons, dataQuality,
    };
  }

  const pTypeRaw = Math.floor(r() * 4);
  const pType    = (pTypeRaw === 0 && mlIsExtreme && odds) ? 1 : pTypeRaw;

  const conf      = randConf(6.5, 9.2, r);
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

  const { reasons, dataQuality } = buildFn(pType, 'top', favIsHome, fav, dog, favML, dogML, playerCtx, odds, r);

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
    console.warn(`[HTB] Pick rejected — "${pick.pick}" team not found in "${game.away.name} @ ${game.home.name}"`);
    return null;
  }
  return pick;
}

module.exports = { computePick, validatePick, extractPlayers };
