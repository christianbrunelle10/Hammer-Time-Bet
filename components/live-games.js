/**
 * HammerTimeBet — Live Games Component
 * ======================================
 * Usage: <htb-live-games sports="mlb,nba,nhl" refresh="30"></htb-live-games>
 *
 * Supported sports: mlb · nba · nfl · ncaaf · nhl · golf
 *
 * Attributes:
 *   sports  — comma-separated sport keys  (default: mlb,nhl)
 *   refresh — auto-refresh seconds        (default: 30)
 *
 * Events dispatched (bubbles):
 *   htb:boxscore — { gameId, sport, teams[] }
 *   htb:golf     — { tournament, players[] }   ← golf leaderboard button
 *
 * Data priority:
 *   1. window.HTBData (data.js) when available
 *   2. Internal ESPN fetch + DK mock fallback
 */

/* ============================================================
   INJECT STYLES — once per page
   ============================================================ */
(function injectStyles() {
  if (document.getElementById('htb-lg-styles')) return;
  const s = document.createElement('style');
  s.id = 'htb-lg-styles';
  s.textContent = `
    htb-live-games { display: block; }

    /* ── Grid ── */
    .htb-lg-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 12px;
    }

    /* ── Card shell ── */
    .htb-card {
      background: #101010;
      border: 1px solid #222;
      border-radius: 12px;
      overflow: hidden;
      transition: border-color .2s, transform .2s;
    }
    .htb-card:hover { border-color: #2e2e2e; transform: translateY(-2px); }

    /* ── Card header ── */
    .htb-card-hd {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #1e1e1e;
    }
    .htb-sport-tag {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: #666;
    }
    .htb-status {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 4px;
    }
    .htb-status.live  { background: rgba(0,208,132,.1);  color: #00d084; border: 1px solid rgba(0,208,132,.2); }
    .htb-status.pre   { background: #1a1a1a; color: #555; border: 1px solid #222; }
    .htb-status.final { background: #1a1a1a; color: #444; border: 1px solid #222; }
    .htb-status.golf  { background: rgba(240,180,41,.08); color: #f0b429; border: 1px solid rgba(240,180,41,.2); }

    /* ── Scoreboard teams ── */
    .htb-card-body { padding: 14px; }
    .htb-team-row  { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
    .htb-team-info { display: flex; align-items: center; gap: 8px; }
    .htb-team-name { font-size: 15px; font-weight: 700; }
    .htb-team-rec  { font-size: 11px; color: #555; }
    .htb-score {
      font-family: 'Barlow Condensed', 'Inter', sans-serif;
      font-size: 28px;
      font-weight: 900;
      min-width: 32px;
      text-align: right;
    }
    .htb-score.lead  { color: #fff; }
    .htb-score.trail { color: #444; }

    /* ── Game state ── */
    .htb-state {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #555;
      margin: 10px 0 8px;
    }
    .htb-live-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #00d084;
      animation: htb-blink 1.4s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes htb-blink { 0%,100%{opacity:1} 50%{opacity:.15} }

    /* ── Odds board ── */
    .htb-odds-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }
    .htb-odd {
      background: #181818;
      border: 1px solid #222;
      border-radius: 6px;
      padding: 7px 8px;
      text-align: center;
    }
    .htb-odd-lbl {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #444;
      margin-bottom: 4px;
    }
    .htb-odd-val { font-size: 13px; font-weight: 700; color: #bbb; }

    /* ── Line movement ── */
    .htb-line-move {
      font-size: 10px;
      color: #444;
      margin-bottom: 10px;
      letter-spacing: .02em;
    }
    .htb-line-move strong { color: #666; }
    .htb-mv-better { color: #00d084; font-size: 11px; font-weight: 700; }
    .htb-mv-worse  { color: #ff4455; font-size: 11px; font-weight: 700; }

    /* ── Golf leaderboard card ── */
    .htb-golf-tournament {
      font-family: 'Barlow Condensed', 'Inter', sans-serif;
      font-size: 18px;
      font-weight: 900;
      text-transform: uppercase;
      margin-bottom: 2px;
      line-height: 1.1;
    }
    .htb-golf-course {
      font-size: 11px;
      color: #555;
      margin-bottom: 12px;
    }
    .htb-golf-lb {
      display: flex;
      flex-direction: column;
      gap: 0;
      margin-bottom: 12px;
      border: 1px solid #1e1e1e;
      border-radius: 8px;
      overflow: hidden;
    }
    .htb-golf-row {
      display: flex;
      align-items: center;
      padding: 7px 10px;
      border-bottom: 1px solid #141414;
      gap: 8px;
    }
    .htb-golf-row:last-child { border-bottom: none; }
    .htb-golf-pos  { font-size: 11px; font-weight: 700; color: #444; min-width: 22px; }
    .htb-golf-pos.top3 { color: #f0b429; }
    .htb-golf-player { font-size: 13px; font-weight: 700; flex: 1; }
    .htb-golf-score { font-family: 'Barlow Condensed','Inter',sans-serif; font-size: 16px; font-weight: 900; }
    .htb-golf-score.under { color: #00d084; }
    .htb-golf-score.over  { color: #ff4455; }
    .htb-golf-score.even  { color: #666; }
    .htb-golf-today { font-size: 11px; color: #444; min-width: 30px; text-align: right; }

    /* Golf odds: 2-col */
    .htb-odds-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 10px;
    }

    /* ── Actions ── */
    .htb-actions { display: flex; gap: 8px; }
    .htb-btn {
      flex: 1;
      padding: 9px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .07em;
      text-transform: uppercase;
      text-align: center;
      cursor: pointer;
      transition: background .15s, opacity .15s;
      border: none;
    }
    .htb-btn-box { background: #1a1a1a; color: #bbb; border: 1px solid #2a2a2a; }
    .htb-btn-box:hover { background: #222; color: #fff; }
    .htb-btn-bet { background: #f0b429; color: #000; font-weight: 800; }
    .htb-btn-bet:hover { opacity: .88; }

    /* ── Loading / empty ── */
    .htb-loading, .htb-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 44px 20px;
      color: #444;
      font-size: 13px;
      background: #101010;
      border: 1px solid #1e1e1e;
      border-radius: 12px;
    }
    .htb-spinner {
      width: 16px; height: 16px;
      border: 2px solid #2a2a2a;
      border-top-color: #f0b429;
      border-radius: 50%;
      animation: htb-spin .65s linear infinite;
      flex-shrink: 0;
    }
    @keyframes htb-spin { to { transform: rotate(360deg); } }
    .htb-timestamp { font-size: 11px; color: #333; margin-top: 6px; }

    @media (max-width: 560px) {
      .htb-odds-grid   { grid-template-columns: 1fr 1fr; }
      .htb-odds-grid-2 { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(s);
})();

/* ============================================================
   SPORT CONFIG
   ============================================================ */
const HTB_SPORT_CFG = {
  mlb:   { label: 'MLB',            lineLabel: 'Run Line' },
  nba:   { label: 'NBA',            lineLabel: 'Spread'   },
  nfl:   { label: 'NFL',            lineLabel: 'Spread'   },
  ncaaf: { label: 'NCAAF',          lineLabel: 'Spread'   },
  nhl:   { label: 'NHL',            lineLabel: 'Puck Line'},
  golf:  { label: 'PGA Tour',       lineLabel: null       },
};

/* ============================================================
   ESPN ENDPOINTS (internal fallback when data.js not loaded)
   ============================================================ */
const HTB_ESPN = {
  mlb:   'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba:   'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl:   'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ncaaf: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  nhl:   'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  golf:  'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
};

/* ============================================================
   MOCK DATA
   ============================================================ */
const HTB_MOCK_SCORES = {
  mlb: [
    { id:'401672101', sport:'MLB', away:{ name:'Rangers',      abbr:'TEX',  score:'1',  rec:'8-9'  }, home:{ name:'Dodgers',   abbr:'LAD',  score:'3',  rec:'12-5' }, status:'live',  state:'Bot 5th',   gameTime:'7:10 PM ET'  },
    { id:'401672102', sport:'MLB', away:{ name:'Rockies',      abbr:'COL',  score:'0',  rec:'4-14' }, home:{ name:'Padres',    abbr:'SD',   score:'2',  rec:'9-8'  }, status:'live',  state:'Top 3rd',   gameTime:'9:40 PM ET'  },
    { id:'401672103', sport:'MLB', away:{ name:'Red Sox',      abbr:'BOS',  score:'0',  rec:'7-10' }, home:{ name:'Cardinals', abbr:'STL',  score:'0',  rec:'9-8'  }, status:'pre',   state:'',          gameTime:'2:15 PM ET'  },
    { id:'401672104', sport:'MLB', away:{ name:'Astros',       abbr:'HOU',  score:'4',  rec:'10-7' }, home:{ name:'Mariners',  abbr:'SEA',  score:'2',  rec:'8-9'  }, status:'live',  state:'Top 7th',   gameTime:'9:40 PM ET'  },
  ],
  nba: [
    { id:'401705101', sport:'NBA', away:{ name:'Celtics',      abbr:'BOS',  score:'68', rec:'52-18' }, home:{ name:'Knicks',   abbr:'NYK',  score:'61', rec:'44-26' }, status:'live',  state:'Q3 5:44',   gameTime:'7:30 PM ET'  },
    { id:'401705102', sport:'NBA', away:{ name:'Lakers',       abbr:'LAL',  score:'0',  rec:'37-33' }, home:{ name:'Warriors', abbr:'GSW',  score:'0',  rec:'38-32' }, status:'pre',   state:'',          gameTime:'10:00 PM ET' },
    { id:'401705103', sport:'NBA', away:{ name:'Nuggets',      abbr:'DEN',  score:'88', rec:'50-20' }, home:{ name:'Suns',     abbr:'PHX',  score:'82', rec:'34-36' }, status:'live',  state:'Q4 2:11',   gameTime:'9:00 PM ET'  },
    { id:'401705104', sport:'NBA', away:{ name:'76ers',        abbr:'PHI',  score:'0',  rec:'35-35' }, home:{ name:'Heat',     abbr:'MIA',  score:'0',  rec:'39-31' }, status:'pre',   state:'',          gameTime:'8:00 PM ET'  },
  ],
  nfl: [
    { id:'401671801', sport:'NFL', away:{ name:'Chiefs',       abbr:'KC',   score:'17', rec:'11-3' }, home:{ name:'Bills',    abbr:'BUF',  score:'14', rec:'10-4' }, status:'live',  state:'Q3 7:42',   gameTime:'4:25 PM ET'  },
    { id:'401671802', sport:'NFL', away:{ name:'Eagles',       abbr:'PHI',  score:'0',  rec:'9-5'  }, home:{ name:'Cowboys',  abbr:'DAL',  score:'0',  rec:'8-6'  }, status:'pre',   state:'',          gameTime:'4:25 PM ET'  },
    { id:'401671803', sport:'NFL', away:{ name:'49ers',        abbr:'SF',   score:'24', rec:'10-4' }, home:{ name:'Seahawks', abbr:'SEA',  score:'20', rec:'7-7'  }, status:'live',  state:'Q4 2:54',   gameTime:'4:05 PM ET'  },
    { id:'401671804', sport:'NFL', away:{ name:'Ravens',       abbr:'BAL',  score:'0',  rec:'12-2' }, home:{ name:'Steelers', abbr:'PIT',  score:'0',  rec:'9-5'  }, status:'pre',   state:'',          gameTime:'8:20 PM ET'  },
    { id:'401671805', sport:'NFL', away:{ name:'Dolphins',     abbr:'MIA',  score:'0',  rec:'8-6'  }, home:{ name:'Jets',     abbr:'NYJ',  score:'0',  rec:'5-9'  }, status:'pre',   state:'',          gameTime:'1:00 PM ET'  },
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
};

const HTB_MOCK_GOLF = {
  tournament: { name:'Masters Tournament', course:'Augusta National GC', round:'Round 3 — In Progress' },
  players: [
    { pos:'1',   name:'Scottie Scheffler', flag:'🇺🇸', score:-14, today:-5, thru:'F' },
    { pos:'2',   name:'Rory McIlroy',      flag:'🇬🇧', score:-11, today:-4, thru:'F' },
    { pos:'3',   name:'Collin Morikawa',   flag:'🇺🇸', score:-9,  today:-3, thru:'F' },
    { pos:'T4',  name:'Jon Rahm',          flag:'🇪🇸', score:-8,  today:-2, thru:'F' },
    { pos:'T4',  name:'Xander Schauffele', flag:'🇺🇸', score:-8,  today:-4, thru:'F' },
  ],
  odds: [
    { name:'Scottie Scheffler', winner:'+175',  top5:'-180', top10:'-350' },
    { name:'Rory McIlroy',      winner:'+320',  top5:'-110', top10:'-280' },
    { name:'Collin Morikawa',   winner:'+600',  top5:'+120', top10:'-175' },
    { name:'Jon Rahm',          winner:'+750',  top5:'+160', top10:'-140' },
    { name:'Xander Schauffele', winner:'+800',  top5:'+175', top10:'-130' },
  ],
};

const HTB_DK_MOCK = {
  mlb: [
    { awayAbbr:'TEX', homeAbbr:'LAD', ml:{ away:'+145', home:'-165' }, line:{ away:'+1.5 (-125)', home:'-1.5 (+105)' }, total:{ val:'8.5'  }, lineMove:{ open:'-155', current:'-165', dir:'away' } },
    { awayAbbr:'COL', homeAbbr:'SD',  ml:{ away:'+165', home:'-195' }, line:{ away:'+1.5 (-140)', home:'-1.5 (+120)' }, total:{ val:'10.5' }, lineMove:{ open:'-175', current:'-195', dir:'away' } },
    { awayAbbr:'BOS', homeAbbr:'STL', ml:{ away:'+105', home:'-125' }, line:{ away:'+1.5 (+155)', home:'-1.5 (-190)' }, total:{ val:'7.5'  }, lineMove:{ open:'-110', current:'-125', dir:'away' } },
    { awayAbbr:'HOU', homeAbbr:'SEA', ml:{ away:'-120', home:'+100' }, line:{ away:'-1.5 (+135)', home:'+1.5 (-160)' }, total:{ val:'8.0'  }, lineMove:{ open:'-130', current:'-120', dir:'home' } },
  ],
  nba: [
    { awayAbbr:'BOS', homeAbbr:'NYK', ml:{ away:'-180', home:'+155' }, line:{ away:'-4.5 (-110)', home:'+4.5 (-110)' }, total:{ val:'218.5' }, lineMove:{ open:'-160', current:'-180', dir:'away' } },
    { awayAbbr:'LAL', homeAbbr:'GSW', ml:{ away:'+110', home:'-130' }, line:{ away:'+3 (-110)',   home:'-3 (-110)'   }, total:{ val:'224.0' }, lineMove:{ open:'-120', current:'-130', dir:'away' } },
    { awayAbbr:'DEN', homeAbbr:'PHX', ml:{ away:'-195', home:'+165' }, line:{ away:'-5.5 (-110)', home:'+5.5 (-110)' }, total:{ val:'226.5' }, lineMove:{ open:'-5',   current:'-5.5', dir:'away' } },
    { awayAbbr:'PHI', homeAbbr:'MIA', ml:{ away:'+145', home:'-170' }, line:{ away:'+4 (-110)',   home:'-4 (-110)'   }, total:{ val:'213.5' }, lineMove:{ open:'-3.5', current:'-4',   dir:'away' } },
  ],
  nfl: [
    { awayAbbr:'KC',  homeAbbr:'BUF', ml:{ away:'-135', home:'+115' }, line:{ away:'-2.5 (-110)', home:'+2.5 (-110)' }, total:{ val:'51.5' }, lineMove:{ open:'-3',   current:'-2.5', dir:'home' } },
    { awayAbbr:'PHI', homeAbbr:'DAL', ml:{ away:'-125', home:'+105' }, line:{ away:'-3 (-110)',   home:'+3 (-110)'   }, total:{ val:'45.5' }, lineMove:{ open:'-2.5', current:'-3',   dir:'away' } },
    { awayAbbr:'SF',  homeAbbr:'SEA', ml:{ away:'-175', home:'+148' }, line:{ away:'-4 (-110)',   home:'+4 (-110)'   }, total:{ val:'47.0' }, lineMove:{ open:'-3.5', current:'-4',   dir:'away' } },
    { awayAbbr:'BAL', homeAbbr:'PIT', ml:{ away:'-245', home:'+205' }, line:{ away:'-6 (-110)',   home:'+6 (-110)'   }, total:{ val:'43.0' }, lineMove:{ open:'-5.5', current:'-6',   dir:'away' } },
    { awayAbbr:'MIA', homeAbbr:'NYJ', ml:{ away:'-195', home:'+165' }, line:{ away:'-4.5 (-110)', home:'+4.5 (-110)' }, total:{ val:'40.5' }, lineMove:{ open:'-4',   current:'-4.5', dir:'away' } },
  ],
  ncaaf: [
    { awayAbbr:'OSU',  homeAbbr:'UGA',  ml:{ away:'+230', home:'-285' }, line:{ away:'+7.5 (-110)', home:'-7.5 (-110)' }, total:{ val:'47.5' }, lineMove:{ open:'-6.5', current:'-7.5', dir:'away' } },
    { awayAbbr:'TENN', homeAbbr:'BAMA', ml:{ away:'+320', home:'-420' }, line:{ away:'+10 (-110)',  home:'-10 (-110)'  }, total:{ val:'51.5' }, lineMove:{ open:'-9',   current:'-10',  dir:'away' } },
    { awayAbbr:'ND',   homeAbbr:'USC',  ml:{ away:'+150', home:'-175' }, line:{ away:'+4.5 (-110)', home:'-4.5 (-110)' }, total:{ val:'44.5' }, lineMove:{ open:'+5',   current:'+4.5', dir:'home' } },
    { awayAbbr:'TEX',  homeAbbr:'OU',   ml:{ away:'+130', home:'-155' }, line:{ away:'+3.5 (-110)', home:'-3.5 (-110)' }, total:{ val:'53.0' }, lineMove:{ open:'-3',   current:'-3.5', dir:'away' } },
  ],
  nhl: [
    { awayAbbr:'VGK', homeAbbr:'COL', ml:{ away:'-130', home:'+110' }, line:{ away:'-1.5 (+165)', home:'+1.5 (-200)' }, total:{ val:'5.5' }, lineMove:{ open:'-120', current:'-130', dir:'away' } },
    { awayAbbr:'CGY', homeAbbr:'SEA', ml:{ away:'+108', home:'-128' }, line:{ away:'+1.5 (-210)', home:'-1.5 (+175)' }, total:{ val:'6.0' }, lineMove:{ open:'-120', current:'-128', dir:'away' } },
  ],
};

/* ============================================================
   FETCH HELPERS
   Uses window.HTBData when available, otherwise fetches directly.
   ============================================================ */
async function _fetchScores(sport) {
  if (window.HTBData) return HTBData.fetchScoreboard(sport);
  try {
    const r = await fetch(HTB_ESPN[sport], { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error();
    const { events = [] } = await r.json();
    if (!events.length) throw new Error();
    return events.map(e => _parseEvent(e, sport));
  } catch {
    return HTB_MOCK_SCORES[sport] || [];
  }
}

async function _fetchOdds(sport) {
  if (window.HTBData) return HTBData.fetchOdds(sport);
  return HTB_DK_MOCK[sport] || [];
}

async function _fetchGolf() {
  if (window.HTBData) {
    const [lb, odds] = await Promise.all([HTBData.fetchGolfLeaderboard(), HTBData.fetchGolfOdds()]);
    return { tournament: lb.tournament, players: lb.players, odds };
  }
  try {
    const r = await fetch(HTB_ESPN.golf, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error();
    const data  = await r.json();
    const event = data.events?.[0];
    if (!event) throw new Error();
    const comp  = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    if (!competitors.length) throw new Error();
    return {
      tournament: { name: event.name, course: comp.venue?.fullName || '', round: comp.status?.type?.detail || '' },
      players: competitors.slice(0, 5).map(c => ({
        pos:    c.linescores?.[0]?.position?.displayName || '—',
        name:   c.athlete?.displayName || '—',
        flag:   '',
        score:  parseInt(c.score) || 0,
        today:  0,
        thru:   '—',
      })),
      odds: HTB_MOCK_GOLF.odds,
    };
  } catch {
    return HTB_MOCK_GOLF;
  }
}

function _parseEvent(event, sport) {
  const comp  = event.competitions[0];
  const home  = comp.competitors.find(c => c.homeAway === 'home');
  const away  = comp.competitors.find(c => c.homeAway === 'away');
  const sType = comp.status.type.name;
  return {
    id:       event.id,
    sport:    sport.toUpperCase(),
    away:     { name: away.team.shortDisplayName, abbr: away.team.abbreviation, score: away.score || '0', rec: away.records?.[0]?.summary || '' },
    home:     { name: home.team.shortDisplayName, abbr: home.team.abbreviation, score: home.score || '0', rec: home.records?.[0]?.summary || '' },
    status:   sType === 'STATUS_IN_PROGRESS' ? 'live' : sType === 'STATUS_FINAL' ? 'final' : 'pre',
    state:    comp.status.type.detail    || '',
    gameTime: comp.status.type.shortDetail || '',
  };
}

function _matchOdds(game, list) {
  return list.find(o => o.awayAbbr === game.away.abbr || o.homeAbbr === game.home.abbr) || null;
}

/* ============================================================
   CARD RENDERERS
   ============================================================ */

/* ── Standard game card (all team sports) ── */
function _gameCard(game, odds) {
  const isLive    = game.status === 'live';
  const isFinal   = game.status === 'final';
  const showScore = isLive || isFinal;
  const awayInt   = parseInt(game.away.score);
  const homeInt   = parseInt(game.home.score);
  const statusLbl = isLive ? 'LIVE' : isFinal ? 'FINAL' : game.gameTime;
  const cfg       = HTB_SPORT_CFG[game.sport.toLowerCase()] || {};
  const lineLabel = cfg.lineLabel || 'Spread';

  const lineAway = odds?.line?.away?.split(' ')[0] || '—';
  const lineHome = odds?.line?.home?.split(' ')[0] || '—';

  let moveBadge = '';
  if (odds?.lineMove?.open && odds.lineMove.open !== '—') {
    const { open, current, dir } = odds.lineMove;
    const cls = dir === 'away' ? 'htb-mv-worse' : 'htb-mv-better';
    moveBadge = `<div class="htb-line-move">Open <strong>${open}</strong> → <span class="${cls}">${current}</span></div>`;
  }

  const ml = odds
    ? `<div class="htb-odd"><div class="htb-odd-lbl">ML</div><div class="htb-odd-val">${odds.ml.away} / ${odds.ml.home}</div></div>`
    : `<div class="htb-odd"><div class="htb-odd-lbl">ML</div><div class="htb-odd-val">—</div></div>`;

  const rl = odds
    ? `<div class="htb-odd"><div class="htb-odd-lbl">${lineLabel}</div><div class="htb-odd-val">${lineAway} / ${lineHome}</div></div>`
    : `<div class="htb-odd"><div class="htb-odd-lbl">${lineLabel}</div><div class="htb-odd-val">—</div></div>`;

  const tot = odds
    ? `<div class="htb-odd"><div class="htb-odd-lbl">Total</div><div class="htb-odd-val">O/U ${odds.total.val}</div></div>`
    : `<div class="htb-odd"><div class="htb-odd-lbl">Total</div><div class="htb-odd-val">—</div></div>`;

  return `
    <div class="htb-card" data-game-id="${game.id}">
      <div class="htb-card-hd">
        <span class="htb-sport-tag">${game.sport}</span>
        <span class="htb-status ${game.status}">${statusLbl}</span>
      </div>
      <div class="htb-card-body">
        <div class="htb-team-row">
          <div class="htb-team-info">
            <span class="htb-team-name">${game.away.name}</span>
            ${game.away.rec ? `<span class="htb-team-rec">${game.away.rec}</span>` : ''}
          </div>
          <span class="htb-score ${showScore ? (awayInt > homeInt ? 'lead' : 'trail') : ''}">${showScore ? game.away.score : ''}</span>
        </div>
        <div class="htb-team-row">
          <div class="htb-team-info">
            <span class="htb-team-name">${game.home.name}</span>
            ${game.home.rec ? `<span class="htb-team-rec">${game.home.rec}</span>` : ''}
          </div>
          <span class="htb-score ${showScore ? (homeInt > awayInt ? 'lead' : 'trail') : ''}">${showScore ? game.home.score : ''}</span>
        </div>
        <div class="htb-state">
          ${isLive ? '<span class="htb-live-dot"></span>' : ''}
          ${game.state || game.gameTime}
        </div>
        <div class="htb-odds-grid">${ml}${rl}${tot}</div>
        ${moveBadge}
        <div class="htb-actions">
          <button class="htb-btn htb-btn-box"
            data-game-id="${game.id}"
            data-sport="${game.sport.toLowerCase()}"
            data-away="${game.away.name}"
            data-home="${game.home.name}">Box Score</button>
          <button class="htb-btn htb-btn-bet">Bet on DK →</button>
        </div>
      </div>
    </div>`;
}

/* ── Golf leaderboard card ── */
function _scoreClass(n) { return n < 0 ? 'under' : n > 0 ? 'over' : 'even'; }
function _scoreLabel(n) { return n < 0 ? `${n}` : n > 0 ? `+${n}` : 'E'; }

function _golfCard(data) {
  const { tournament, players, odds } = data;
  const roundStatus = tournament.round || 'In Progress';

  const leaderboardRows = players.slice(0, 5).map(p => {
    if (!p.name) return '';
    const isTop3 = ['1','2','3'].includes(String(p.pos));
    return `
      <div class="htb-golf-row">
        <span class="htb-golf-pos${isTop3 ? ' top3' : ''}">${p.pos}</span>
        <span class="htb-golf-player">${p.flag || ''} ${p.name}</span>
        <span class="htb-golf-score ${_scoreClass(p.score)}">${_scoreLabel(p.score)}</span>
        <span class="htb-golf-today" style="color:#444">${p.thru === 'F' ? 'F' : p.thru ? `Thru ${p.thru}` : ''}</span>
      </div>`;
  }).join('');

  const topOdds = (odds || []).slice(0, 4);
  const oddsHTML = topOdds.map(o => `
    <div class="htb-odd">
      <div class="htb-odd-lbl" style="font-size:8px">${o.name.split(' ').pop()}</div>
      <div class="htb-odd-val">${o.winner}</div>
    </div>`).join('');

  return `
    <div class="htb-card htb-golf-card">
      <div class="htb-card-hd">
        <span class="htb-sport-tag">PGA Tour</span>
        <span class="htb-status golf">${roundStatus}</span>
      </div>
      <div class="htb-card-body">
        <div class="htb-golf-tournament">${tournament.name}</div>
        <div class="htb-golf-course">${tournament.course || ''}</div>
        <div class="htb-golf-lb">${leaderboardRows}</div>
        ${topOdds.length ? `
          <div class="htb-odd-lbl" style="margin-bottom:6px">DK Winner Odds</div>
          <div class="htb-odds-grid-2">${oddsHTML}</div>
        ` : ''}
        <div class="htb-actions">
          <button class="htb-btn htb-btn-box htb-btn-golf-lb">Full Leaderboard</button>
          <button class="htb-btn htb-btn-bet">Bet on DK →</button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   WEB COMPONENT
   ============================================================ */
class HTBLiveGames extends HTMLElement {
  connectedCallback() {
    this._sports  = (this.getAttribute('sports') || 'mlb,nhl').split(',').map(s => s.trim().toLowerCase());
    this._refresh = parseInt(this.getAttribute('refresh') || '30');
    this._golfData = null;

    // Render sample data immediately — no network wait, page looks functional at once
    this._renderSample();

    // Then fetch live data and update in background
    this._load();
    this._timer = setInterval(() => this._load(), this._refresh * 1000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

  /* Show mock cards instantly (no spinner, no wait) */
  _renderSample() {
    const teamSports = this._sports.filter(s => s !== 'golf');
    const hasGolf    = this._sports.includes('golf');

    const ms = (window.HTBData?.mock?.scores) || HTB_MOCK_SCORES;
    const mo = (window.HTBData?.mock?.odds)   || HTB_DK_MOCK;
    const mg = (window.HTBData?.mock?.golf)   || HTB_MOCK_GOLF;

    const teamCards = teamSports.flatMap(sport => {
      const games = ms[sport] || [];
      const odds  = mo[sport] || [];
      return games.map(g => _gameCard(g, _matchOdds(g, odds)));
    });
    const golfCards = hasGolf ? [_golfCard(mg)] : [];
    const all = [...teamCards, ...golfCards];

    if (!all.length) return;

    this._golfData = mg;
    this.innerHTML = `
      <div class="htb-lg-grid">${all.join('')}</div>
      <div class="htb-timestamp">Sample data · checking for live updates…</div>`;
    this._wireButtons();
  }

  async _load() {
    const teamSports = this._sports.filter(s => s !== 'golf');
    const hasGolf    = this._sports.includes('golf');

    // Fetch all in parallel — each sport falls back to mock on error or off-season
    const [teamResults, golfData] = await Promise.all([
      Promise.all(teamSports.map(async sport => {
        const [games, odds] = await Promise.all([_fetchScores(sport), _fetchOdds(sport)]);
        return games.map(game => ({ game, odds: _matchOdds(game, odds) }));
      })),
      hasGolf ? _fetchGolf() : Promise.resolve(null),
    ]);

    if (golfData) this._golfData = golfData;

    const teamCards = teamResults.flat().map(({ game, odds }) => _gameCard(game, odds));
    const golfCards = golfData ? [_golfCard(golfData)] : [];
    const all       = [...teamCards, ...golfCards];

    if (!all.length) {
      this.innerHTML = `<div class="htb-empty">No games found today. Check back soon.</div>`;
      return;
    }

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.innerHTML = `
      <div class="htb-lg-grid">${all.join('')}</div>
      <div class="htb-timestamp">Updated ${ts} · ESPN scores · Sample odds · Auto-refreshes every ${this._refresh}s</div>`;

    this._wireButtons();
  }

  _wireButtons() {
    // Team sport box score buttons
    this.querySelectorAll('.htb-btn-box:not(.htb-btn-golf-lb)').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('htb:boxscore', {
          bubbles: true,
          detail: {
            gameId: btn.dataset.gameId,
            sport:  btn.dataset.sport,
            teams:  [btn.dataset.away, btn.dataset.home],
          },
        }));
      });
    });

    // Golf leaderboard button
    this.querySelectorAll('.htb-btn-golf-lb').forEach(btn => {
      btn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('htb:golf', {
          bubbles: true,
          detail:  this._golfData || HTB_MOCK_GOLF,
        }));
      });
    });
  }
}

customElements.define('htb-live-games', HTBLiveGames);
