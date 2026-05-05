/**
 * HammerTimeBet — Central Data Layer
 * ====================================
 * Usage: <script src="/components/data.js"></script>
 *        then access window.HTBData from any page or component.
 *
 * Load ORDER in HTML:
 *   1. data.js        ← this file (data + fetch logic)
 *   2. live-games.js  ← uses HTBData internally
 *   3. nav.js
 */

(function (global) {
  'use strict';

  /* ============================================================
     CONFIG
     ============================================================ */
  const CONFIG = {
    FETCH_TIMEOUT: 5000,
    ESPN_BASE:     'https://site.api.espn.com/apis/site/v2/sports',
  };

  /* ============================================================
     ESPN ENDPOINTS
     ============================================================ */
  const ESPN = {
    scoreboard: {
      mlb:   `${CONFIG.ESPN_BASE}/baseball/mlb/scoreboard`,
      nba:   `${CONFIG.ESPN_BASE}/basketball/nba/scoreboard`,
      nfl:   `${CONFIG.ESPN_BASE}/football/nfl/scoreboard`,
      ncaaf: `${CONFIG.ESPN_BASE}/football/college-football/scoreboard`,
      ncaam: `${CONFIG.ESPN_BASE}/basketball/mens-college-basketball/scoreboard`,
      nhl:   `${CONFIG.ESPN_BASE}/hockey/nhl/scoreboard`,
      golf:  `${CONFIG.ESPN_BASE}/golf/pga/scoreboard`,
    },
    summary: {
      mlb:   id => `${CONFIG.ESPN_BASE}/baseball/mlb/summary?event=${id}`,
      nba:   id => `${CONFIG.ESPN_BASE}/basketball/nba/summary?event=${id}`,
      nfl:   id => `${CONFIG.ESPN_BASE}/football/nfl/summary?event=${id}`,
      ncaaf: id => `${CONFIG.ESPN_BASE}/football/college-football/summary?event=${id}`,
      ncaam: id => `${CONFIG.ESPN_BASE}/basketball/mens-college-basketball/summary?event=${id}`,
      nhl:   id => `${CONFIG.ESPN_BASE}/hockey/nhl/summary?event=${id}`,
    },
  };

  /* ============================================================
     FETCH HELPERS
     ============================================================ */
  /** Returns YYYYMMDD in Eastern Time — ESPN ?dates= must match the ET calendar date. */
  function _todayParam() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
  }

  async function _get(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(CONFIG.FETCH_TIMEOUT) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /* ============================================================
     ESPN — SCOREBOARD PARSERS
     Delegates to HTBCanonical — single source of truth for game shape.
     ============================================================ */
  function _parseEvent(event, sport) {
    return HTBCanonical.fromESPNEvent(event, sport);
  }

  /* ============================================================
     ESPN — BOX SCORE PARSERS
     Each sport gets a dedicated parser that returns:
     {
       homeName, awayName, homeScore, awayScore,
       status,
       lines: [{ label, homeVal, awayVal }],   ← innings/periods/quarters
       stats: [{ label, homeVal, awayVal }],   ← sport-specific team stats
     }
     ============================================================ */
  function _parseBoxScoreBase(data) {
    const bs        = data.boxscore;
    const teams     = bs?.teams || [];
    // Use ESPN's explicit homeAway label — never rely on array index ordering
    const home      = teams.find(t => t.homeAway === 'home') || teams[1];
    const away      = teams.find(t => t.homeAway === 'away') || teams[0];
    return {
      homeName:  home?.team?.shortDisplayName || 'Home',
      awayName:  away?.team?.shortDisplayName || 'Away',
      homeScore: home?.team?.score            || '—',
      awayScore: away?.team?.score            || '—',
      status:    data.header?.competitions?.[0]?.status?.type?.detail || '',
      homeLines: home?.linescores || [],
      awayLines: away?.linescores || [],
      homeStats: home?.statistics || [],
      awayStats: away?.statistics || [],
    };
  }

  function _statsMap(arr) {
    const m = {};
    arr.forEach(s => { m[s.name] = s.displayValue; });
    return m;
  }

  const BOX_SCORE_PARSERS = {
    mlb(data) {
      const b = _parseBoxScoreBase(data);
      const innings = Math.max(b.homeLines.length, b.awayLines.length) || 9;
      const lines = Array.from({ length: innings }, (_, i) => ({
        label:   `${i + 1}`,
        homeVal: b.homeLines[i]?.displayValue ?? '—',
        awayVal: b.awayLines[i]?.displayValue ?? '—',
      }));
      const hm = _statsMap(b.homeStats);
      const am = _statsMap(b.awayStats);
      const keys = ['hits','runs','errors','strikeOuts','walks','leftOnBase'];
      const labels = { hits:'Hits', runs:'Runs', errors:'Errors', strikeOuts:'Strikeouts', walks:'Walks', leftOnBase:'Left On Base' };
      return { ...b, lines, lineHeader:'Inn', stats: keys.map(k => ({ label:labels[k], homeVal:hm[k]||'—', awayVal:am[k]||'—' })) };
    },

    nba(data) {
      const b = _parseBoxScoreBase(data);
      const qtrs = Math.max(b.homeLines.length, b.awayLines.length) || 4;
      const lines = Array.from({ length: qtrs }, (_, i) => ({
        label:   i < 4 ? `Q${i+1}` : `OT${i-3}`,
        homeVal: b.homeLines[i]?.displayValue ?? '—',
        awayVal: b.awayLines[i]?.displayValue ?? '—',
      }));
      const hm = _statsMap(b.homeStats);
      const am = _statsMap(b.awayStats);
      const keys = [
        'fieldGoalsMade-fieldGoalsAttempted',
        'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
        'freeThrowsMade-freeThrowsAttempted',
        'totalRebounds','assists','turnovers',
      ];
      const labels = {
        'fieldGoalsMade-fieldGoalsAttempted': 'FG',
        'threePointFieldGoalsMade-threePointFieldGoalsAttempted': '3PT',
        'freeThrowsMade-freeThrowsAttempted': 'FT',
        totalRebounds:'Rebounds', assists:'Assists', turnovers:'Turnovers',
      };
      return { ...b, lines, lineHeader:'Qtr', stats: keys.map(k => ({ label:labels[k], homeVal:hm[k]||'—', awayVal:am[k]||'—' })) };
    },

    nfl(data) {
      const b = _parseBoxScoreBase(data);
      const qtrs = Math.max(b.homeLines.length, b.awayLines.length) || 4;
      const lines = Array.from({ length: qtrs }, (_, i) => ({
        label:   i < 4 ? `Q${i+1}` : 'OT',
        homeVal: b.homeLines[i]?.displayValue ?? '—',
        awayVal: b.awayLines[i]?.displayValue ?? '—',
      }));
      const hm = _statsMap(b.homeStats);
      const am = _statsMap(b.awayStats);
      const keys = ['totalYards','netPassingYards','rushingYards','firstDowns','turnovers','sacks'];
      const labels = { totalYards:'Total Yards', netPassingYards:'Pass Yards', rushingYards:'Rush Yards', firstDowns:'1st Downs', turnovers:'Turnovers', sacks:'Sacks' };
      return { ...b, lines, lineHeader:'Qtr', stats: keys.map(k => ({ label:labels[k], homeVal:hm[k]||'—', awayVal:am[k]||'—' })) };
    },

    ncaaf(data) {
      // Same shape as NFL
      return BOX_SCORE_PARSERS.nfl(data);
    },

    ncaam(data) {
      // College basketball — halves instead of quarters
      const b = _parseBoxScoreBase(data);
      const halves = Math.max(b.homeLines.length, b.awayLines.length) || 2;
      const lines = Array.from({ length: halves }, (_, i) => ({
        label:   i === 0 ? 'H1' : i === 1 ? 'H2' : `OT${i - 1}`,
        homeVal: b.homeLines[i]?.displayValue ?? '—',
        awayVal: b.awayLines[i]?.displayValue ?? '—',
      }));
      const hm = _statsMap(b.homeStats);
      const am = _statsMap(b.awayStats);
      const keys = [
        'fieldGoalsMade-fieldGoalsAttempted',
        'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
        'freeThrowsMade-freeThrowsAttempted',
        'totalRebounds', 'assists', 'turnovers',
      ];
      const labels = {
        'fieldGoalsMade-fieldGoalsAttempted':                     'Field Goals',
        'threePointFieldGoalsMade-threePointFieldGoalsAttempted': '3-Pointers',
        'freeThrowsMade-freeThrowsAttempted':                     'Free Throws',
        totalRebounds: 'Rebounds',
        assists:       'Assists',
        turnovers:     'Turnovers',
      };
      return { ...b, lines, lineHeader:'Half', stats: keys.map(k => ({ label:labels[k], homeVal:hm[k]||'—', awayVal:am[k]||'—' })) };
    },

    nhl(data) {
      const b = _parseBoxScoreBase(data);
      const periods = Math.max(b.homeLines.length, b.awayLines.length) || 3;
      const lines = Array.from({ length: periods }, (_, i) => ({
        label:   i < 3 ? `P${i+1}` : 'OT',
        homeVal: b.homeLines[i]?.displayValue ?? '—',
        awayVal: b.awayLines[i]?.displayValue ?? '—',
      }));
      const hm = _statsMap(b.homeStats);
      const am = _statsMap(b.awayStats);
      const keys = ['saves','savePct','shots','powerPlayGoals','hits','blocked'];
      const labels = { saves:'Saves', savePct:'Save %', shots:'Shots', powerPlayGoals:'PP Goals', hits:'Hits', blocked:'Blocked' };
      return { ...b, lines, lineHeader:'Per', stats: keys.map(k => ({ label:labels[k], homeVal:hm[k]||'—', awayVal:am[k]||'—' })) };
    },
  };

  /* ============================================================
     ESPN — GOLF LEADERBOARD PARSER
     ============================================================ */
  function _parseGolfLeaderboard(data) {
    const event = data.events?.[0];
    if (!event) return null;
    const comp        = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    return {
      tournament: {
        name:    event.name,
        course:  comp?.venue?.fullName || '',
        location:comp?.venue?.address?.city || '',
        round:   comp?.status?.type?.detail || '',
      },
      players: competitors.map(c => ({
        pos:     c.linescores?.[0]?.position?.displayName || '—',
        name:    c.athlete?.displayName || '—',
        country: c.athlete?.flag?.alt  || '',
        score:   c.score || 'E',
        today:   c.linescores?.find(l => l.type === 'today')?.value || 'E',
        thru:    c.status?.thru || '—',
        strokes: c.statistics?.[0]?.value || '—',
      })),
    };
  }

  /* ============================================================
     PUBLIC API — window.HTBData
     ============================================================ */
  const HTBData = {

    /* ----------------------------------------------------------
       fetchScoreboard(sport)
       Returns: Promise<Game[]>
       Returns empty array on any error or 0 events.
    ---------------------------------------------------------- */
    async fetchScoreboard(sport) {
      const url = ESPN.scoreboard[sport];
      if (!url) return [];
      const dateParam = _todayParam();
      console.log(`[HTBData] fetchScoreboard ${sport} date=${dateParam}`);
      try {
        const { events = [] } = await _get(`${url}?dates=${dateParam}`);
        const games = events.map(e => _parseEvent(e, sport)).filter(Boolean);
        console.log(`[HTBData] fetchScoreboard ${sport} → ${games.length} games`);
        return games;
      } catch {
        return [];
      }
    },

    /* ----------------------------------------------------------
       fetchBoxScore(sport, gameId)
       Returns: Promise<ParsedBoxScore | null>
    ---------------------------------------------------------- */
    async fetchBoxScore(sport, gameId) {
      const urlFn = ESPN.summary[sport];
      if (!urlFn) return null;
      try {
        const data = await _get(urlFn(gameId));
        const parser = BOX_SCORE_PARSERS[sport];
        return parser ? parser(data) : null;
      } catch {
        return null;
      }
    },

    /* ----------------------------------------------------------
       fetchOdds(sport)
       Returns: Promise<Odds[]>
    ---------------------------------------------------------- */
    async fetchOdds(sport) {
      try {
        const r = await fetch(`/api/odds?sport=${sport}`, { signal: AbortSignal.timeout(CONFIG.FETCH_TIMEOUT) });
        if (r.ok) {
          const { odds } = await r.json();
          if (odds?.length) return odds;
        }
      } catch {}
      return [];
    },

    /* ----------------------------------------------------------
       fetchGolfLeaderboard()
       Returns: Promise<{ tournament, players }>
    ---------------------------------------------------------- */
    async fetchGolfLeaderboard() {
      try {
        const data = await _get(ESPN.scoreboard.golf);
        const parsed = _parseGolfLeaderboard(data);
        if (!parsed || !parsed.players.length) throw new Error('empty');
        return parsed;
      } catch {
        return { tournament: null, players: [] };
      }
    },

    /* ----------------------------------------------------------
       fetchGolfOdds()
       Returns: Promise<GolfOddsEntry[]>
    ---------------------------------------------------------- */
    async fetchGolfOdds() {
      return [];
    },

    /* ----------------------------------------------------------
       matchOdds(game, oddsList)
       Matches a Game object to its odds entry by team abbreviation.
       Returns: Odds | null
    ---------------------------------------------------------- */
    matchOdds(game, oddsList) {
      // Require BOTH abbreviations to match — prevents partial matches from
      // assigning one team's odds to a completely different game.
      return oddsList.find(o =>
        o.awayAbbr === game.away.abbr && o.homeAbbr === game.home.abbr
      ) || null;
    },

    /* ----------------------------------------------------------
       Expose internals for advanced use / overrides
    ---------------------------------------------------------- */
    config:  CONFIG,
    espnUrl: ESPN,
  };

  global.HTBData = HTBData;

})(window);
