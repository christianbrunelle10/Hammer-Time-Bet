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
 *
 * To activate real odds: set HTBData.ODDS_API_KEY to your
 * The Odds API key (https://the-odds-api.com — 500 free req/mo).
 * Everything else (ESPN) works with no key required.
 */

(function (global) {
  'use strict';

  /* ============================================================
     CONFIG
     ============================================================ */
  const CONFIG = {
    ODDS_API_KEY:  'YOUR_ODDS_API_KEY', // ← swap when ready
    FETCH_TIMEOUT: 5000,                // ms
    ESPN_BASE:     'https://site.api.espn.com/apis/site/v2/sports',
    ODDS_BASE:     'https://api.the-odds-api.com/v4/sports',
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
      nhl:   `${CONFIG.ESPN_BASE}/hockey/nhl/scoreboard`,
      golf:  `${CONFIG.ESPN_BASE}/golf/pga/scoreboard`,
    },
    summary: {
      mlb:   id => `${CONFIG.ESPN_BASE}/baseball/mlb/summary?event=${id}`,
      nba:   id => `${CONFIG.ESPN_BASE}/basketball/nba/summary?event=${id}`,
      nfl:   id => `${CONFIG.ESPN_BASE}/football/nfl/summary?event=${id}`,
      ncaaf: id => `${CONFIG.ESPN_BASE}/football/college-football/summary?event=${id}`,
      nhl:   id => `${CONFIG.ESPN_BASE}/hockey/nhl/summary?event=${id}`,
    },
  };

  /* ============================================================
     THE ODDS API — sport keys
     Docs: https://the-odds-api.com/liveapi/guides/v4/#overview
     ============================================================ */
  const ODDS_SPORT_KEY = {
    mlb:   'baseball_mlb',
    nba:   'basketball_nba',
    nfl:   'americanfootball_nfl',
    ncaaf: 'americanfootball_ncaaf',
    nhl:   'icehockey_nhl',
    golf:  'golf_pga_championship_winner', // outright winner market
  };

  /* ============================================================
     FETCH HELPERS
     ============================================================ */
  async function _get(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(CONFIG.FETCH_TIMEOUT) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /* ============================================================
     ESPN — SCOREBOARD PARSERS
     Normalises every sport into the same Game shape:
     {
       id, sport,
       away: { name, abbr, score, rec },
       home: { name, abbr, score, rec },
       status: 'live' | 'pre' | 'final',
       state, gameTime
     }
     ============================================================ */
  function _fmtML(n) {
    if (n === undefined || n === null || n === 0) return null;
    return n > 0 ? `+${n}` : String(n);
  }

  function _parseEvent(event, sport) {
    const comp  = event.competitions[0];
    const home  = comp.competitors.find(c => c.homeAway === 'home');
    const away  = comp.competitors.find(c => c.homeAway === 'away');
    const sType = comp.status.type.name;

    // Extract ESPN's embedded odds (free, same request, no API key needed)
    let espnOdds = null;
    const eo = comp.odds?.[0];
    if (eo) {
      const awayML = _fmtML(eo.awayTeamOdds?.moneyLine);
      const homeML = _fmtML(eo.homeTeamOdds?.moneyLine);
      const awayPt = eo.awayTeamOdds?.spreadOdds ?? eo.awayTeamOdds?.pointSpread?.alternateDisplayValue;
      const homePt = eo.homeTeamOdds?.spreadOdds ?? eo.homeTeamOdds?.pointSpread?.alternateDisplayValue;
      const ou     = eo.overUnder != null ? String(eo.overUnder) : null;
      espnOdds = {
        awayAbbr: away.team.abbreviation,
        homeAbbr: home.team.abbreviation,
        ml:    { away: awayML || '—', home: homeML || '—' },
        line:  { away: awayPt != null ? String(awayPt) : '—', home: homePt != null ? String(homePt) : '—' },
        total: { val: ou || '—', over: null, under: null },
      };
    }

    return {
      id:       event.id,
      sport:    sport.toUpperCase(),
      away: {
        name:  away.team.shortDisplayName,
        abbr:  away.team.abbreviation,
        score: away.score  || '0',
        rec:   away.records?.[0]?.summary || '',
      },
      home: {
        name:  home.team.shortDisplayName,
        abbr:  home.team.abbreviation,
        score: home.score  || '0',
        rec:   home.records?.[0]?.summary || '',
      },
      status:   sType === 'STATUS_IN_PROGRESS' ? 'live'
              : sType === 'STATUS_FINAL'        ? 'final'
              : 'pre',
      state:    comp.status.type.detail    || '',
      gameTime: comp.status.type.shortDetail || '',
      espnOdds,
    };
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
    const home      = bs?.teams?.[1];
    const away      = bs?.teams?.[0];
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
     MOCK DATA
     Mirrors live ESPN + odds shapes exactly.
     Displayed when the real API returns 0 events (off-season)
     or when a network error occurs.
     ============================================================ */
  const MOCK = {
    scores: {
      mlb: [
        { id:'401672101', sport:'MLB', away:{ name:'Rangers',   abbr:'TEX', score:'1', rec:'8-9'  }, home:{ name:'Dodgers',   abbr:'LAD', score:'3', rec:'12-5' }, status:'live',  state:'Bot 5th', gameTime:'7:10 PM ET'  },
        { id:'401672102', sport:'MLB', away:{ name:'Rockies',   abbr:'COL', score:'0', rec:'4-14' }, home:{ name:'Padres',    abbr:'SD',  score:'2', rec:'9-8'  }, status:'live',  state:'Top 3rd', gameTime:'9:40 PM ET'  },
        { id:'401672103', sport:'MLB', away:{ name:'Red Sox',   abbr:'BOS', score:'0', rec:'7-10' }, home:{ name:'Cardinals', abbr:'STL', score:'0', rec:'9-8'  }, status:'pre',   state:'',        gameTime:'2:15 PM ET'  },
        { id:'401672104', sport:'MLB', away:{ name:'Astros',    abbr:'HOU', score:'4', rec:'10-7' }, home:{ name:'Mariners',  abbr:'SEA', score:'2', rec:'8-9'  }, status:'live',  state:'Top 7th', gameTime:'9:40 PM ET'  },
      ],
      nba: [
        { id:'401705101', sport:'NBA', away:{ name:'Celtics',   abbr:'BOS', score:'68', rec:'52-18' }, home:{ name:'Knicks',   abbr:'NYK', score:'61', rec:'44-26' }, status:'live', state:'Q3 5:44',  gameTime:'7:30 PM ET'  },
        { id:'401705102', sport:'NBA', away:{ name:'Lakers',    abbr:'LAL', score:'0',  rec:'37-33' }, home:{ name:'Warriors', abbr:'GSW', score:'0',  rec:'38-32' }, status:'pre',  state:'',         gameTime:'10:00 PM ET' },
        { id:'401705103', sport:'NBA', away:{ name:'Nuggets',   abbr:'DEN', score:'88', rec:'50-20' }, home:{ name:'Suns',     abbr:'PHX', score:'82', rec:'34-36' }, status:'live', state:'Q4 2:11',  gameTime:'9:00 PM ET'  },
        { id:'401705104', sport:'NBA', away:{ name:'76ers',     abbr:'PHI', score:'0',  rec:'35-35' }, home:{ name:'Heat',     abbr:'MIA', score:'0',  rec:'39-31' }, status:'pre',  state:'',         gameTime:'8:00 PM ET'  },
      ],
      nfl: [
        { id:'401671801', sport:'NFL', away:{ name:'Chiefs',    abbr:'KC',  score:'17', rec:'11-3' }, home:{ name:'Bills',    abbr:'BUF', score:'14', rec:'10-4' }, status:'live', state:'Q3 7:42',  gameTime:'4:25 PM ET' },
        { id:'401671802', sport:'NFL', away:{ name:'Eagles',    abbr:'PHI', score:'0',  rec:'9-5'  }, home:{ name:'Cowboys',  abbr:'DAL', score:'0',  rec:'8-6'  }, status:'pre',  state:'',         gameTime:'4:25 PM ET' },
        { id:'401671803', sport:'NFL', away:{ name:'49ers',     abbr:'SF',  score:'24', rec:'10-4' }, home:{ name:'Seahawks', abbr:'SEA', score:'20', rec:'7-7'  }, status:'live', state:'Q4 2:54',  gameTime:'4:05 PM ET' },
        { id:'401671804', sport:'NFL', away:{ name:'Ravens',    abbr:'BAL', score:'0',  rec:'12-2' }, home:{ name:'Steelers', abbr:'PIT', score:'0',  rec:'9-5'  }, status:'pre',  state:'',         gameTime:'8:20 PM ET' },
        { id:'401671805', sport:'NFL', away:{ name:'Dolphins',  abbr:'MIA', score:'0',  rec:'8-6'  }, home:{ name:'Jets',     abbr:'NYJ', score:'0',  rec:'5-9'  }, status:'pre',  state:'',         gameTime:'1:00 PM ET' },
      ],
      ncaaf: [
        { id:'401628281', sport:'NCAAF', away:{ name:'Ohio State', abbr:'OSU',  score:'14', rec:'' }, home:{ name:'Georgia',  abbr:'UGA',  score:'21', rec:'' }, status:'live', state:'Q3 4:22', gameTime:'3:30 PM ET' },
        { id:'401628282', sport:'NCAAF', away:{ name:'Tennessee',  abbr:'TENN', score:'0',  rec:'' }, home:{ name:'Alabama',  abbr:'BAMA', score:'0',  rec:'' }, status:'pre',  state:'',        gameTime:'7:00 PM ET' },
        { id:'401628283', sport:'NCAAF', away:{ name:'Notre Dame', abbr:'ND',   score:'7',  rec:'' }, home:{ name:'USC',      abbr:'USC',  score:'10', rec:'' }, status:'live', state:'Q2 2:15', gameTime:'7:30 PM ET' },
        { id:'401628284', sport:'NCAAF', away:{ name:'Texas',      abbr:'TEX',  score:'0',  rec:'' }, home:{ name:'Oklahoma', abbr:'OU',   score:'0',  rec:'' }, status:'pre',  state:'',        gameTime:'8:00 PM ET' },
      ],
      nhl: [
        { id:'401701201', sport:'NHL', away:{ name:'Golden Knights', abbr:'VGK', score:'2', rec:'' }, home:{ name:'Avalanche', abbr:'COL', score:'1', rec:'' }, status:'live', state:'3rd 11:22', gameTime:'9:00 PM ET'  },
        { id:'401701202', sport:'NHL', away:{ name:'Flames',         abbr:'CGY', score:'0', rec:'' }, home:{ name:'Kraken',    abbr:'SEA', score:'0', rec:'' }, status:'pre',  state:'',          gameTime:'10:00 PM ET' },
      ],
    },

    odds: {
      mlb: [
        { awayAbbr:'TEX', homeAbbr:'LAD', ml:{ away:'+145', home:'-165' }, line:{ away:'+1.5 (-125)', home:'-1.5 (+105)' }, total:{ val:'8.5',  over:'-110', under:'-110' }, lineMove:{ open:'-155', current:'-165', dir:'away' } },
        { awayAbbr:'COL', homeAbbr:'SD',  ml:{ away:'+165', home:'-195' }, line:{ away:'+1.5 (-140)', home:'-1.5 (+120)' }, total:{ val:'10.5', over:'-115', under:'-105' }, lineMove:{ open:'-175', current:'-195', dir:'away' } },
        { awayAbbr:'BOS', homeAbbr:'STL', ml:{ away:'+105', home:'-125' }, line:{ away:'+1.5 (+155)', home:'-1.5 (-190)' }, total:{ val:'7.5',  over:'-105', under:'-115' }, lineMove:{ open:'-110', current:'-125', dir:'away' } },
        { awayAbbr:'HOU', homeAbbr:'SEA', ml:{ away:'-120', home:'+100' }, line:{ away:'-1.5 (+135)', home:'+1.5 (-160)' }, total:{ val:'8.0',  over:'-108', under:'-112' }, lineMove:{ open:'-130', current:'-120', dir:'home' } },
      ],
      nba: [
        { awayAbbr:'BOS', homeAbbr:'NYK', ml:{ away:'-180', home:'+155' }, line:{ away:'-4.5 (-110)', home:'+4.5 (-110)' }, total:{ val:'218.5', over:'-110', under:'-110' }, lineMove:{ open:'-160', current:'-180', dir:'away' } },
        { awayAbbr:'LAL', homeAbbr:'GSW', ml:{ away:'+110', home:'-130' }, line:{ away:'+3 (-110)',   home:'-3 (-110)'   }, total:{ val:'224.0', over:'-112', under:'-108' }, lineMove:{ open:'-120', current:'-130', dir:'away' } },
        { awayAbbr:'DEN', homeAbbr:'PHX', ml:{ away:'-195', home:'+165' }, line:{ away:'-5.5 (-110)', home:'+5.5 (-110)' }, total:{ val:'226.5', over:'-108', under:'-112' }, lineMove:{ open:'-5',   current:'-5.5', dir:'away' } },
        { awayAbbr:'PHI', homeAbbr:'MIA', ml:{ away:'+145', home:'-170' }, line:{ away:'+4 (-110)',   home:'-4 (-110)'   }, total:{ val:'213.5', over:'-110', under:'-110' }, lineMove:{ open:'-3.5', current:'-4',   dir:'away' } },
      ],
      nfl: [
        { awayAbbr:'KC',  homeAbbr:'BUF', ml:{ away:'-135', home:'+115' }, line:{ away:'-2.5 (-110)', home:'+2.5 (-110)' }, total:{ val:'51.5', over:'-110', under:'-110' }, lineMove:{ open:'-3',   current:'-2.5', dir:'home' } },
        { awayAbbr:'PHI', homeAbbr:'DAL', ml:{ away:'-125', home:'+105' }, line:{ away:'-3 (-110)',   home:'+3 (-110)'   }, total:{ val:'45.5', over:'-108', under:'-112' }, lineMove:{ open:'-2.5', current:'-3',   dir:'away' } },
        { awayAbbr:'SF',  homeAbbr:'SEA', ml:{ away:'-175', home:'+148' }, line:{ away:'-4 (-110)',   home:'+4 (-110)'   }, total:{ val:'47.0', over:'-112', under:'-108' }, lineMove:{ open:'-3.5', current:'-4',   dir:'away' } },
        { awayAbbr:'BAL', homeAbbr:'PIT', ml:{ away:'-245', home:'+205' }, line:{ away:'-6 (-110)',   home:'+6 (-110)'   }, total:{ val:'43.0', over:'-110', under:'-110' }, lineMove:{ open:'-5.5', current:'-6',   dir:'away' } },
        { awayAbbr:'MIA', homeAbbr:'NYJ', ml:{ away:'-195', home:'+165' }, line:{ away:'-4.5 (-110)', home:'+4.5 (-110)' }, total:{ val:'40.5', over:'-110', under:'-110' }, lineMove:{ open:'-4',   current:'-4.5', dir:'away' } },
      ],
      ncaaf: [
        { awayAbbr:'OSU',  homeAbbr:'UGA',  ml:{ away:'+230', home:'-285' }, line:{ away:'+7.5 (-110)', home:'-7.5 (-110)' }, total:{ val:'47.5', over:'-110', under:'-110' }, lineMove:{ open:'-6.5', current:'-7.5', dir:'away' } },
        { awayAbbr:'TENN', homeAbbr:'BAMA', ml:{ away:'+320', home:'-420' }, line:{ away:'+10 (-110)',  home:'-10 (-110)'  }, total:{ val:'51.5', over:'-108', under:'-112' }, lineMove:{ open:'-9',   current:'-10',  dir:'away' } },
        { awayAbbr:'ND',   homeAbbr:'USC',  ml:{ away:'+150', home:'-175' }, line:{ away:'+4.5 (-110)', home:'-4.5 (-110)' }, total:{ val:'44.5', over:'-112', under:'-108' }, lineMove:{ open:'+5',   current:'+4.5', dir:'home' } },
        { awayAbbr:'TEX',  homeAbbr:'OU',   ml:{ away:'+130', home:'-155' }, line:{ away:'+3.5 (-110)', home:'-3.5 (-110)' }, total:{ val:'53.0', over:'-110', under:'-110' }, lineMove:{ open:'-3',   current:'-3.5', dir:'away' } },
      ],
      nhl: [
        { awayAbbr:'VGK', homeAbbr:'COL', ml:{ away:'-130', home:'+110' }, line:{ away:'-1.5 (+165)', home:'+1.5 (-200)' }, total:{ val:'5.5', over:'-115', under:'-105' }, lineMove:{ open:'-120', current:'-130', dir:'away' } },
        { awayAbbr:'CGY', homeAbbr:'SEA', ml:{ away:'+108', home:'-128' }, line:{ away:'+1.5 (-210)', home:'-1.5 (+175)' }, total:{ val:'6.0', over:'-112', under:'-108' }, lineMove:{ open:'-120', current:'-128', dir:'away' } },
      ],
    },

    golf: {
      tournament: {
        name:    'Masters Tournament',
        course:  'Augusta National GC',
        location:'Augusta, GA',
        purse:   '$18,000,000',
        round:   'Round 3 — In Progress',
        par:     72,
      },
      players: [
        { pos:'1',   name:'Scottie Scheffler', country:'USA', flag:'🇺🇸', score:-14, today:-5, thru:'F',  strokes:202, move:'same' },
        { pos:'2',   name:'Rory McIlroy',      country:'NIR', flag:'🇬🇧', score:-11, today:-4, thru:'F',  strokes:205, move:'up'   },
        { pos:'3',   name:'Collin Morikawa',   country:'USA', flag:'🇺🇸', score:-9,  today:-3, thru:'F',  strokes:207, move:'up'   },
        { pos:'T4',  name:'Jon Rahm',          country:'ESP', flag:'🇪🇸', score:-8,  today:-2, thru:'F',  strokes:208, move:'down' },
        { pos:'T4',  name:'Xander Schauffele', country:'USA', flag:'🇺🇸', score:-8,  today:-4, thru:'F',  strokes:208, move:'up'   },
        { pos:'6',   name:'Viktor Hovland',    country:'NOR', flag:'🇳🇴', score:-7,  today:-1, thru:'F',  strokes:209, move:'same' },
        { pos:'T7',  name:'Brooks Koepka',     country:'USA', flag:'🇺🇸', score:-6,  today:0,  thru:'F',  strokes:210, move:'down' },
        { pos:'T7',  name:'Ludvig Åberg',      country:'SWE', flag:'🇸🇪', score:-6,  today:-3, thru:'F',  strokes:210, move:'up'   },
        { pos:'9',   name:'Patrick Cantlay',   country:'USA', flag:'🇺🇸', score:-5,  today:+1, thru:'F',  strokes:211, move:'down' },
        { pos:'10',  name:'Tommy Fleetwood',   country:'ENG', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', score:-4,  today:-2, thru:'F',  strokes:212, move:'up'   },
        { pos:'CUT', name:null },
        { pos:'T11', name:'Justin Thomas',     country:'USA', flag:'🇺🇸', score:-1,  today:+2, thru:'F',  strokes:215, move:'down' },
        { pos:'T11', name:'Shane Lowry',       country:'IRL', flag:'🇮🇪', score:-1,  today:-1, thru:'F',  strokes:215, move:'same' },
      ],
      odds: [
        { name:'Scottie Scheffler', flag:'🇺🇸', winner:'+175',  top5:'-180', top10:'-350', mc:'-800' },
        { name:'Rory McIlroy',      flag:'🇬🇧', winner:'+320',  top5:'-110', top10:'-280', mc:'-700' },
        { name:'Collin Morikawa',   flag:'🇺🇸', winner:'+600',  top5:'+120', top10:'-175', mc:'-550' },
        { name:'Jon Rahm',          flag:'🇪🇸', winner:'+750',  top5:'+160', top10:'-140', mc:'-450' },
        { name:'Xander Schauffele', flag:'🇺🇸', winner:'+800',  top5:'+175', top10:'-130', mc:'-420' },
        { name:'Viktor Hovland',    flag:'🇳🇴', winner:'+1200', top5:'+260', top10:'+110', mc:'-350' },
        { name:'Brooks Koepka',     flag:'🇺🇸', winner:'+1600', top5:'+340', top10:'+155', mc:'-280' },
        { name:'Ludvig Åberg',      flag:'🇸🇪', winner:'+1800', top5:'+380', top10:'+175', mc:'-260' },
      ],
    },
  };

  /* ============================================================
     PUBLIC API — window.HTBData
     ============================================================ */
  const HTBData = {

    /* ----------------------------------------------------------
       fetchScoreboard(sport)
       Returns: Promise<Game[]>
       Falls back to MOCK.scores[sport] on any error or 0 events.
    ---------------------------------------------------------- */
    async fetchScoreboard(sport) {
      const url = ESPN.scoreboard[sport];
      if (!url) return MOCK.scores[sport] || [];
      try {
        const { events = [] } = await _get(url);
        if (!events.length) throw new Error('no events');
        return events.map(e => _parseEvent(e, sport));
      } catch {
        return MOCK.scores[sport] || [];
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

       HOW TO ACTIVATE REAL ODDS:
         1. Sign up at https://the-odds-api.com (500 free req/mo)
         2. Set HTBData.config.ODDS_API_KEY = 'your-key-here'
         3. Uncomment the live fetch block below

       Alternatively wire up your own proxy:
         return fetch(`/api/odds?sport=${sport}`).then(r => r.json())
    ---------------------------------------------------------- */
    async fetchOdds(sport) {
      // ── LIVE FETCH (uncomment when key is set) ────────────────
      // if (CONFIG.ODDS_API_KEY !== 'YOUR_ODDS_API_KEY') {
      //   const key    = CONFIG.ODDS_API_KEY;
      //   const sKey   = ODDS_SPORT_KEY[sport];
      //   const url    = `${CONFIG.ODDS_BASE}/${sKey}/odds?apiKey=${key}&regions=us&markets=h2h,spreads,totals&bookmakers=draftkings`;
      //   try {
      //     const games = await _get(url);
      //     return games.map(g => _transformOddsAPIGame(g));
      //   } catch {}
      // }
      // ── MOCK FALLBACK ─────────────────────────────────────────
      return MOCK.odds[sport] || [];
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
        return { tournament: MOCK.golf.tournament, players: MOCK.golf.players };
      }
    },

    /* ----------------------------------------------------------
       fetchGolfOdds()
       Returns: Promise<GolfOddsEntry[]>
    ---------------------------------------------------------- */
    async fetchGolfOdds() {
      // ── LIVE FETCH (uncomment when key is set) ────────────────
      // if (CONFIG.ODDS_API_KEY !== 'YOUR_ODDS_API_KEY') {
      //   try {
      //     const key = CONFIG.ODDS_API_KEY;
      //     const url = `${CONFIG.ODDS_BASE}/${ODDS_SPORT_KEY.golf}/odds?apiKey=${key}&regions=us&markets=outrights&bookmakers=draftkings`;
      //     return await _get(url);
      //   } catch {}
      // }
      return MOCK.golf.odds;
    },

    /* ----------------------------------------------------------
       matchOdds(game, oddsList)
       Matches a Game object to its odds entry by team abbreviation.
       Returns: Odds | null
    ---------------------------------------------------------- */
    matchOdds(game, oddsList) {
      return oddsList.find(o =>
        o.awayAbbr === game.away.abbr || o.homeAbbr === game.home.abbr
      ) || null;
    },

    /* ----------------------------------------------------------
       Expose internals for advanced use / overrides
    ---------------------------------------------------------- */
    config:  CONFIG,
    mock:    MOCK,
    espnUrl: ESPN,
  };

  /* ============================================================
     The Odds API → internal shape transformer
     (used when live odds are activated)
     ============================================================ */
  function _transformOddsAPIGame(g) {
    const dk = g.bookmakers?.find(b => b.key === 'draftkings');
    const h2h     = dk?.markets?.find(m => m.key === 'h2h');
    const spreads = dk?.markets?.find(m => m.key === 'spreads');
    const totals  = dk?.markets?.find(m => m.key === 'totals');

    const awayML  = h2h?.outcomes?.find(o => o.name === g.away_team)?.price;
    const homeML  = h2h?.outcomes?.find(o => o.name === g.home_team)?.price;
    const awaySpd = spreads?.outcomes?.find(o => o.name === g.away_team);
    const homeSpd = spreads?.outcomes?.find(o => o.name === g.home_team);
    const over    = totals?.outcomes?.find(o => o.name === 'Over');
    const under   = totals?.outcomes?.find(o => o.name === 'Under');

    return {
      awayAbbr:  g.away_team,
      homeAbbr:  g.home_team,
      ml:    { away: _fmt(awayML),          home: _fmt(homeML)          },
      line:  { away: _fmtSpread(awaySpd),   home: _fmtSpread(homeSpd)  },
      total: { val: over?.point || '—',     over: _fmt(over?.price),    under: _fmt(under?.price) },
      lineMove: { open: '—', current: '—', dir: 'same' },
    };
  }

  function _fmt(price) {
    if (price == null) return '—';
    return price > 0 ? `+${price}` : `${price}`;
  }
  function _fmtSpread(outcome) {
    if (!outcome) return '—';
    const pt = outcome.point > 0 ? `+${outcome.point}` : `${outcome.point}`;
    return `${pt} (${_fmt(outcome.price)})`;
  }

  global.HTBData = HTBData;

})(window);
