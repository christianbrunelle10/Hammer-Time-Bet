/**
 * HammerTimeBet — Canonical Game Parser (Node.js / CommonJS)
 * Mirrors the browser canonical.js exactly — do not diverge.
 */
'use strict';

function _fmtML(n) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return num >= 0 ? `+${num}` : String(num);
}

function _fmtSpread(n) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return num >= 0 ? `+${num}` : String(num);
}

function _fmtSpreadOdds(n) {
  if (n == null) return '-110';
  const num = Number(n);
  if (isNaN(num)) return '-110';
  return num >= 0 ? `+${num}` : String(num);
}

function _favFromPC(pc) {
  if (!pc) return null;
  const homeOdds = pc.homeTeamOdds;
  const awayOdds = pc.awayTeamOdds;
  if (homeOdds?.favorite === true) return 'home';
  if (awayOdds?.favorite === true) return 'away';
  const hML = homeOdds?.moneyLine != null ? Number(homeOdds.moneyLine) : null;
  const aML = awayOdds?.moneyLine != null ? Number(awayOdds.moneyLine) : null;
  if (hML != null && aML != null) return hML <= aML ? 'home' : 'away';
  if (hML != null) return hML < 0 ? 'home' : 'away';
  if (aML != null) return aML < 0 ? 'away' : 'home';
  return null;
}

function parsePickcenter(pc) {
  if (!pc) return null;
  const fav       = _favFromPC(pc);
  const homeIsFav = fav === 'home';
  const rawSpread = pc.spread != null ? Math.abs(Number(pc.spread)) : null;
  const homeSpreadN = rawSpread != null ? (homeIsFav ? -rawSpread :  rawSpread) : null;
  const awaySpreadN = rawSpread != null ? (homeIsFav ?  rawSpread : -rawSpread) : null;
  return {
    favorite: fav,
    away: {
      ml:         _fmtML(pc.awayTeamOdds?.moneyLine),
      spread:     _fmtSpread(awaySpreadN),
      spreadOdds: _fmtSpreadOdds(pc.awayTeamOdds?.spreadOdds),
    },
    home: {
      ml:         _fmtML(pc.homeTeamOdds?.moneyLine),
      spread:     _fmtSpread(homeSpreadN),
      spreadOdds: _fmtSpreadOdds(pc.homeTeamOdds?.spreadOdds),
    },
    total:     pc.overUnder != null ? String(pc.overUnder) : null,
    overOdds:  _fmtML(pc.overOdds),
    underOdds: _fmtML(pc.underOdds),
  };
}

/** Parse ESPN scoreboard event → canonical game (odds: null). */
function fromESPNEvent(event, sport) {
  const comp = event.competitions[0];
  const home = comp.competitors.find(c => c.homeAway === 'home');
  const away = comp.competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  const sType = comp.status.type.name;
  return {
    id:    String(event.id),
    sport: String(sport).toLowerCase(),
    away: {
      name:  away.team.shortDisplayName || away.team.displayName || '',
      abbr:  away.team.abbreviation     || '',
      score: away.score                 || '0',
      rec:   away.records?.[0]?.summary || '',
    },
    home: {
      name:  home.team.shortDisplayName || home.team.displayName || '',
      abbr:  home.team.abbreviation     || '',
      score: home.score                 || '0',
      rec:   home.records?.[0]?.summary || '',
    },
    status:   /^STATUS_(?:IN_PROGRESS|END_PERIOD|OVERTIME)/.test(sType)  ? 'live'
            : /^STATUS_FINAL/.test(sType)                                 ? 'final'
            : 'pre',
    state:    comp.status.type.detail     || '',
    gameTime: comp.status.type.shortDetail || '',
    odds:     null,
  };
}

/** Attach pickcenter odds to a canonical game object. */
function withPickcenter(game, pc) {
  return { ...game, odds: parsePickcenter(pc) };
}

module.exports = { fromESPNEvent, withPickcenter, parsePickcenter };
