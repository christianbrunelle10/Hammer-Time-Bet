/**
 * HammerTimeBet — Canonical Game Object Layer
 * =============================================
 * Single source of truth for ESPN game parsing.
 * Every page and component must use these parsers —
 * never parse ESPN JSON independently.
 *
 * Canonical game shape:
 * {
 *   id:       string          — ESPN event ID
 *   sport:    string          — lowercase (mlb, nba, nfl, nhl, ncaaf, ncaam)
 *   away:     { name, abbr, score, rec }
 *   home:     { name, abbr, score, rec }
 *   status:   'live' | 'pre' | 'final'
 *   state:    string          — e.g. "2nd Quarter", "Top 7th"
 *   gameTime: string          — e.g. "7:10 PM ET"
 *   odds:     null | {
 *     favorite:   'home' | 'away' | null
 *     away: { ml, spread, spreadOdds }
 *     home: { ml, spread, spreadOdds }
 *     total:      string | null
 *     overOdds:   string | null
 *     underOdds:  string | null
 *   }
 * }
 *
 * Load ORDER: canonical.js must come BEFORE data.js, picks.js, live-games.js.
 */

(function (global) {
  'use strict';

  /* ============================================================
     PRIVATE HELPERS
     ============================================================ */

  /** Format a moneyline integer as "+150" or "-110". Returns null if nullish. */
  function _fmtML(n) {
    if (n == null) return null;
    const num = Number(n);
    if (isNaN(num)) return null;
    return num >= 0 ? `+${num}` : String(num);
  }

  /** Format a spread number as "+3.5" or "-1.5". Returns null if nullish. */
  function _fmtSpread(n) {
    if (n == null) return null;
    const num = Number(n);
    if (isNaN(num)) return null;
    return num >= 0 ? `+${num}` : String(num);
  }

  /** Format spread odds; defaults to '-110' if null. */
  function _fmtSpreadOdds(n) {
    if (n == null) return '-110';
    const num = Number(n);
    if (isNaN(num)) return '-110';
    return num >= 0 ? `+${num}` : String(num);
  }

  /**
   * Determine which side is favored from a ESPN pickcenter object.
   * Returns 'home', 'away', or null.
   */
  function _favFromPC(pc) {
    if (!pc) return null;
    const homeOdds = pc.homeTeamOdds;
    const awayOdds = pc.awayTeamOdds;

    // 1. Explicit ESPN favorite flag
    if (homeOdds?.favorite === true) return 'home';
    if (awayOdds?.favorite === true) return 'away';

    // 2. Compare moneylines — lower (more negative) = favored
    const hML = homeOdds?.moneyLine != null ? Number(homeOdds.moneyLine) : null;
    const aML = awayOdds?.moneyLine != null ? Number(awayOdds.moneyLine) : null;
    if (hML != null && aML != null) return hML <= aML ? 'home' : 'away';
    if (hML != null) return hML < 0 ? 'home' : 'away';
    if (aML != null) return aML < 0 ? 'away' : 'home';

    return null;
  }

  /**
   * Build a canonical odds object from a pickcenter entry.
   * pc = data.pickcenter[0]
   */
  function _parsePickcenter(pc) {
    if (!pc) return null;

    const fav        = _favFromPC(pc);
    const homeIsFav  = fav === 'home';
    const rawSpread  = pc.spread != null ? Math.abs(Number(pc.spread)) : null;

    // Assign signed spreads based on who is actually favored
    const homeSpreadN = rawSpread != null ? (homeIsFav ? -rawSpread : rawSpread) : null;
    const awaySpreadN = rawSpread != null ? (homeIsFav ? rawSpread : -rawSpread) : null;

    return {
      favorite:   fav,
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
      total:      pc.overUnder != null ? String(pc.overUnder) : null,
      overOdds:   _fmtML(pc.overOdds),
      underOdds:  _fmtML(pc.underOdds),
    };
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  const HTBCanonical = {

    /**
     * Parse a single ESPN scoreboard event into a canonical game object.
     * No odds attached — use withPickcenter() to add them.
     *
     * @param {object} event  — one entry from ESPN scoreboard `events[]`
     * @param {string} sport  — lowercase sport key (mlb, nba, nfl, nhl, ncaaf, ncaam)
     * @returns canonical game object (odds: null)
     */
    fromESPNEvent(event, sport) {
      const comp  = event.competitions[0];
      const home  = comp.competitors.find(c => c.homeAway === 'home');
      const away  = comp.competitors.find(c => c.homeAway === 'away');

      if (!home || !away) {
        console.warn('[HTBCanonical] Missing home or away competitor in event', event.id);
        return null;
      }

      const sType = comp.status.type.name;

      return {
        id:       String(event.id),
        sport:    String(sport).toLowerCase(),
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
        status:   sType === 'STATUS_IN_PROGRESS' ? 'live'
                : sType === 'STATUS_FINAL'        ? 'final'
                : 'pre',
        state:    comp.status.type.detail     || '',
        gameTime: comp.status.type.shortDetail || '',
        odds:     null,
      };
    },

    /**
     * Parse an ESPN summary API response into a canonical game object.
     * Automatically attaches odds from pickcenter if present.
     *
     * @param {object} data   — full ESPN summary API response
     * @param {string} sport  — lowercase sport key
     * @returns canonical game object (odds attached if pickcenter present)
     */
    fromESPNSummary(data, sport) {
      // The summary response nests the event under data.header
      const header = data.header;
      const comp   = header?.competitions?.[0];
      if (!comp) {
        console.warn('[HTBCanonical] No competition found in summary response');
        return null;
      }

      const home  = comp.competitors.find(c => c.homeAway === 'home');
      const away  = comp.competitors.find(c => c.homeAway === 'away');

      if (!home || !away) {
        console.warn('[HTBCanonical] Missing home or away competitor in summary', header?.id);
        return null;
      }

      const sType = comp.status.type.name;

      const game = {
        id:       String(header.id),
        sport:    String(sport).toLowerCase(),
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
        status:   sType === 'STATUS_IN_PROGRESS' ? 'live'
                : sType === 'STATUS_FINAL'        ? 'final'
                : 'pre',
        state:    comp.status.type.detail     || '',
        gameTime: comp.status.type.shortDetail || '',
        odds:     null,
      };

      // Attach pickcenter odds if present
      const pc = (data.pickcenter || [])[0];
      if (pc) {
        game.odds = _parsePickcenter(pc);
      }

      return game;
    },

    /**
     * Return a new game object with odds attached from a pickcenter entry.
     * Use this when you have a canonical game from fromESPNEvent() and
     * later fetch odds from the summary endpoint.
     *
     * @param {object} game  — canonical game object
     * @param {object} pc    — data.pickcenter[0]
     * @returns new canonical game object with odds field set
     */
    withPickcenter(game, pc) {
      return { ...game, odds: _parsePickcenter(pc) };
    },

    /**
     * Validate a canonical game object.
     * Returns [] if valid, or an array of error strings if invalid.
     * Pages should exclude games with validation errors.
     *
     * @param {object} game  — canonical game object
     * @returns string[]
     */
    validate(game) {
      const errs = [];
      if (!game)              { errs.push('game is null'); return errs; }
      if (!game.id)           errs.push('missing id');
      if (!game.sport)        errs.push('missing sport');
      if (!game.away?.name)   errs.push('missing away team name');
      if (!game.away?.abbr)   errs.push('missing away team abbreviation');
      if (!game.home?.name)   errs.push('missing home team name');
      if (!game.home?.abbr)   errs.push('missing home team abbreviation');
      if (!game.status)       errs.push('missing status');

      // If odds present, validate they're self-consistent
      if (game.odds) {
        const o = game.odds;
        if (o.favorite && o.favorite !== 'home' && o.favorite !== 'away') {
          errs.push(`invalid odds.favorite: "${o.favorite}"`);
        }
        if (o.favorite === 'home' && o.home.spread && !o.home.spread.startsWith('-')) {
          errs.push('home is favorite but home spread is positive — check spread direction');
        }
        if (o.favorite === 'away' && o.away.spread && !o.away.spread.startsWith('-')) {
          errs.push('away is favorite but away spread is positive — check spread direction');
        }
      }

      return errs;
    },

    /**
     * Return which side is favored: 'home', 'away', or null.
     *
     * @param {object} game  — canonical game object
     * @returns 'home' | 'away' | null
     */
    favSide(game) {
      return game?.odds?.favorite ?? null;
    },

    /**
     * Return the favored team object ({ name, abbr, score, rec }).
     * Falls back to home team if favorite is unknown.
     *
     * @param {object} game  — canonical game object
     * @returns team object
     */
    favTeam(game) {
      const side = this.favSide(game);
      if (side === 'away') return game.away;
      return game.home;   // default: home
    },

    /**
     * Return the underdog team object ({ name, abbr, score, rec }).
     * Falls back to away team if favorite is unknown.
     *
     * @param {object} game  — canonical game object
     * @returns team object
     */
    dogTeam(game) {
      const side = this.favSide(game);
      if (side === 'away') return game.home;
      return game.away;   // default: away
    },

    /**
     * Return the odds for the favored side.
     * @param {object} game  — canonical game object
     * @returns { ml, spread, spreadOdds } or null
     */
    favOdds(game) {
      if (!game?.odds) return null;
      const side = this.favSide(game);
      return side === 'away' ? game.odds.away : game.odds.home;
    },

    /**
     * Return the odds for the underdog side.
     * @param {object} game  — canonical game object
     * @returns { ml, spread, spreadOdds } or null
     */
    dogOdds(game) {
      if (!game?.odds) return null;
      const side = this.favSide(game);
      return side === 'away' ? game.odds.home : game.odds.away;
    },

    /**
     * Return the moneyline number for the favored team (as a plain integer).
     * Useful for confidence threshold calculations.
     *
     * @param {object} game  — canonical game object
     * @returns number | null
     */
    favMLNum(game) {
      const odds = this.favOdds(game);
      if (!odds?.ml) return null;
      const n = parseInt(odds.ml.replace('+', ''), 10);
      return isNaN(n) ? null : n;
    },

  };

  /* ============================================================
     EXPORT
     ============================================================ */
  global.HTBCanonical = HTBCanonical;

}(window));
