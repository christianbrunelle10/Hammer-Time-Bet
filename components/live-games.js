/**
 * HammerTimeBet — Live Games Component
 * Usage: <htb-live-games sports="mlb,nhl" refresh="30"></htb-live-games>
 *
 * Attributes:
 *   sports  — comma-separated list: mlb, nba, nfl, nhl (default: mlb,nhl)
 *   refresh — auto-refresh interval in seconds (default: 30)
 *
 * Events dispatched:
 *   htb:boxscore  — { gameId, sport, teams } — wire to your box score modal
 */

/* ============================================================
   STYLES — injected once into <head>
   ============================================================ */
(function injectStyles() {
  if (document.getElementById('htb-lg-styles')) return;
  const s = document.createElement('style');
  s.id = 'htb-lg-styles';
  s.textContent = `
    htb-live-games { display: block; }

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
    .htb-card:hover { border-color: #333; transform: translateY(-2px); }

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
      color: #888;
    }
    .htb-status {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 4px;
    }
    .htb-status.live  { background: rgba(0,208,132,.1); color: #00d084; border: 1px solid rgba(0,208,132,.2); }
    .htb-status.pre   { background: #1a1a1a; color: #666; border: 1px solid #222; }
    .htb-status.final { background: #1a1a1a; color: #555; border: 1px solid #222; }

    /* ── Scoreboard ── */
    .htb-card-body { padding: 14px; }
    .htb-team-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }
    .htb-team-info { display: flex; align-items: center; gap: 8px; }
    .htb-team-name { font-size: 15px; font-weight: 700; }
    .htb-team-rec  { font-size: 11px; color: #666; }
    .htb-score {
      font-family: 'Barlow Condensed', 'Inter', sans-serif;
      font-size: 28px;
      font-weight: 900;
      min-width: 32px;
      text-align: right;
    }
    .htb-score.lead  { color: #fff; }
    .htb-score.trail { color: #555; }

    .htb-state {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #666;
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
      margin-bottom: 12px;
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
      color: #555;
      margin-bottom: 4px;
    }
    .htb-odd-val { font-size: 13px; font-weight: 700; color: #ccc; }
    .htb-odd-val.moved-better { color: #00d084; }
    .htb-odd-val.moved-worse  { color: #ff4455; }

    .htb-line-move {
      font-size: 10px;
      color: #555;
      margin-bottom: 12px;
      letter-spacing: .02em;
    }
    .htb-line-move strong { color: #888; }

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
    .htb-btn-box  { background: #1a1a1a; color: #bbb; border: 1px solid #2a2a2a; }
    .htb-btn-box:hover { background: #222; color: #fff; }
    .htb-btn-bet  { background: #f0b429; color: #000; font-weight: 800; }
    .htb-btn-bet:hover { opacity: .88; }

    /* ── Loading / empty ── */
    .htb-loading, .htb-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 44px 20px;
      color: #555;
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
    .htb-timestamp { font-size: 11px; color: #444; margin-top: 4px; }

    @media (max-width: 560px) {
      .htb-odds-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(s);
})();

/* ============================================================
   ESPN DATA SERVICE
   ============================================================ */
const ESPN_ENDPOINTS = {
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
};

async function fetchESPNScores(sport) {
  try {
    const r = await fetch(ESPN_ENDPOINTS[sport], { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error();
    const { events = [] } = await r.json();
    return events.map(e => parseESPNEvent(e, sport));
  } catch {
    return MOCK_SCORES[sport] || [];
  }
}

function parseESPNEvent(event, sport) {
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
    state:    comp.status.type.detail || '',
    gameTime: comp.status.type.shortDetail || '',
  };
}

/* ============================================================
   DRAFTKINGS ODDS SERVICE
   ──────────────────────────────────────────────────────────
   DraftKings has no public API (CORS-blocked from browser).
   Production options:
     1. The Odds API (https://the-odds-api.com) — free 500 req/mo
     2. A Vercel / Netlify serverless proxy to DraftKings
     3. SportsDataIO or ActionNetwork odds feed
   Replace fetchDKOdds() body when your data source is ready.
   ============================================================ */
async function fetchDKOdds(sport) {
  // SWAP THIS LINE when your odds endpoint is ready:
  // return fetch(`/api/odds?sport=${sport}`).then(r => r.json());
  return DK_MOCK[sport] || [];
}

function matchOdds(game, oddsList) {
  return oddsList.find(o =>
    o.awayAbbr === game.away.abbr || o.homeAbbr === game.home.abbr
  ) || null;
}

/* ============================================================
   MOCK DATA — mirrors real ESPN + DraftKings shape
   ============================================================ */
const MOCK_SCORES = {
  mlb: [
    { id:'401672101', sport:'MLB', away:{ name:'Rangers',   abbr:'TEX', score:'1', rec:'8-9'  }, home:{ name:'Dodgers',  abbr:'LAD', score:'3', rec:'12-5' }, status:'live',  state:'Bot 5th', gameTime:'7:10 PM ET' },
    { id:'401672102', sport:'MLB', away:{ name:'Rockies',   abbr:'COL', score:'0', rec:'4-14' }, home:{ name:'Padres',   abbr:'SD',  score:'2', rec:'9-8'  }, status:'live',  state:'Top 3rd', gameTime:'9:40 PM ET' },
    { id:'401672103', sport:'MLB', away:{ name:'Red Sox',   abbr:'BOS', score:'0', rec:'7-10' }, home:{ name:'Cardinals',abbr:'STL', score:'0', rec:'9-8'  }, status:'pre',   state:'',        gameTime:'2:15 PM ET' },
    { id:'401672104', sport:'MLB', away:{ name:'Astros',    abbr:'HOU', score:'4', rec:'10-7' }, home:{ name:'Mariners', abbr:'SEA', score:'2', rec:'8-9'  }, status:'live',  state:'Top 7th', gameTime:'9:40 PM ET' },
  ],
  nhl: [
    { id:'401701201', sport:'NHL', away:{ name:'Golden Knights', abbr:'VGK', score:'2', rec:'' }, home:{ name:'Avalanche', abbr:'COL', score:'1', rec:'' }, status:'live', state:'3rd 11:22', gameTime:'9:00 PM ET' },
    { id:'401701202', sport:'NHL', away:{ name:'Flames',         abbr:'CGY', score:'0', rec:'' }, home:{ name:'Kraken',    abbr:'SEA', score:'0', rec:'' }, status:'pre',  state:'',          gameTime:'10:00 PM ET' },
  ],
};

const DK_MOCK = {
  mlb: [
    { awayAbbr:'TEX', homeAbbr:'LAD', ml:{ away:'+145', home:'-165' }, line:{ away:'+1.5 (-125)', home:'-1.5 (+105)' }, total:{ val:'8.5', over:'-110', under:'-110' }, lineMove:{ open:'-155', current:'-165', dir:'away' } },
    { awayAbbr:'COL', homeAbbr:'SD',  ml:{ away:'+165', home:'-195' }, line:{ away:'+1.5 (-140)', home:'-1.5 (+120)' }, total:{ val:'10.5', over:'-115', under:'-105' }, lineMove:{ open:'-175', current:'-195', dir:'away' } },
    { awayAbbr:'BOS', homeAbbr:'STL', ml:{ away:'+105', home:'-125' }, line:{ away:'+1.5 (+155)', home:'-1.5 (-190)' }, total:{ val:'7.5', over:'-105', under:'-115' }, lineMove:{ open:'-110', current:'-125', dir:'away' } },
    { awayAbbr:'HOU', homeAbbr:'SEA', ml:{ away:'-120', home:'+100' }, line:{ away:'-1.5 (+135)', home:'+1.5 (-160)' }, total:{ val:'8.0', over:'-108', under:'-112' }, lineMove:{ open:'-130', current:'-120', dir:'home' } },
  ],
  nhl: [
    { awayAbbr:'VGK', homeAbbr:'COL', ml:{ away:'-130', home:'+110' }, line:{ away:'-1.5 (+165)', home:'+1.5 (-200)' }, total:{ val:'5.5', over:'-115', under:'-105' }, lineMove:{ open:'-120', current:'-130', dir:'away' } },
    { awayAbbr:'CGY', homeAbbr:'SEA', ml:{ away:'+108', home:'-128' }, line:{ away:'+1.5 (-210)', home:'-1.5 (+175)' }, total:{ val:'6.0', over:'-112', under:'-108' }, lineMove:{ open:'-120', current:'-128', dir:'away' } },
  ],
};

/* ============================================================
   CARD TEMPLATE
   ============================================================ */
function gameCardHTML(game, odds) {
  const live    = game.status === 'live';
  const final   = game.status === 'final';
  const showScore = live || final;
  const awayInt = parseInt(game.away.score);
  const homeInt = parseInt(game.home.score);

  const statusLabel = live ? 'LIVE' : final ? 'FINAL' : game.gameTime;
  const statusCls   = game.status;

  const lineLabel = game.sport === 'NHL' ? 'Puck Line' : game.sport === 'NBA' ? 'Spread' : 'Run Line';

  // Line movement badge
  let moveBadge = '';
  if (odds?.lineMove) {
    const { open, current, dir } = odds.lineMove;
    const cls = dir === 'away' ? 'moved-worse' : 'moved-better';
    moveBadge = `<div class="htb-line-move">Open: <strong>${open}</strong> → Now: <span class="htb-odd-val ${cls}" style="font-size:11px">${current}</span></div>`;
  }

  const ml   = odds ? `<div class="htb-odd"><div class="htb-odd-lbl">Moneyline</div><div class="htb-odd-val">${odds.ml.away} / ${odds.ml.home}</div></div>` : `<div class="htb-odd"><div class="htb-odd-lbl">ML</div><div class="htb-odd-val">—</div></div>`;
  const rl   = odds ? `<div class="htb-odd"><div class="htb-odd-lbl">${lineLabel}</div><div class="htb-odd-val">${odds.line.away.split(' ')[0]} / ${odds.line.home.split(' ')[0]}</div></div>` : `<div class="htb-odd"><div class="htb-odd-lbl">${lineLabel}</div><div class="htb-odd-val">—</div></div>`;
  const tot  = odds ? `<div class="htb-odd"><div class="htb-odd-lbl">Total</div><div class="htb-odd-val">O/U ${odds.total.val}</div></div>` : `<div class="htb-odd"><div class="htb-odd-lbl">Total</div><div class="htb-odd-val">—</div></div>`;

  return `
    <div class="htb-card" data-game-id="${game.id}">
      <div class="htb-card-hd">
        <span class="htb-sport-tag">${game.sport}</span>
        <span class="htb-status ${statusCls}">${statusLabel}</span>
      </div>
      <div class="htb-card-body">
        <div class="htb-team-row">
          <div class="htb-team-info">
            <span class="htb-team-name">${game.away.name}</span>
            <span class="htb-team-rec">${game.away.rec}</span>
          </div>
          <span class="htb-score ${showScore ? (awayInt > homeInt ? 'lead' : 'trail') : ''}">${showScore ? game.away.score : ''}</span>
        </div>
        <div class="htb-team-row">
          <div class="htb-team-info">
            <span class="htb-team-name">${game.home.name}</span>
            <span class="htb-team-rec">${game.home.rec}</span>
          </div>
          <span class="htb-score ${showScore ? (homeInt > awayInt ? 'lead' : 'trail') : ''}">${showScore ? game.home.score : ''}</span>
        </div>
        <div class="htb-state">${live ? '<span class="htb-live-dot"></span>' : ''}${game.state || game.gameTime}</div>
        <div class="htb-odds-grid">${ml}${rl}${tot}</div>
        ${moveBadge}
        <div class="htb-actions">
          <button class="htb-btn htb-btn-box" data-game-id="${game.id}" data-sport="${game.sport.toLowerCase()}">Box Score</button>
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
    this._sports  = (this.getAttribute('sports') || 'mlb,nhl').split(',').map(s => s.trim());
    this._refresh = parseInt(this.getAttribute('refresh') || '30');
    this._lastUpdate = null;

    this.innerHTML = `<div class="htb-loading"><div class="htb-spinner"></div>Loading live scores…</div>`;
    this._load();
    this._timer = setInterval(() => this._load(), this._refresh * 1000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

  async _load() {
    const results = await Promise.all(
      this._sports.map(async sport => {
        const [games, odds] = await Promise.all([fetchESPNScores(sport), fetchDKOdds(sport)]);
        return games.map(game => ({ game, odds: matchOdds(game, odds) }));
      })
    );

    const all = results.flat();
    this._lastUpdate = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

    if (!all.length) {
      this.innerHTML = `<div class="htb-empty">No games found today. Check back soon.</div>`;
      return;
    }

    this.innerHTML = `
      <div class="htb-lg-grid">${all.map(({ game, odds }) => gameCardHTML(game, odds)).join('')}</div>
      <div class="htb-timestamp">Updated ${this._lastUpdate} · Auto-refreshes every ${this._refresh}s</div>`;

    // Wire box score buttons
    this.querySelectorAll('.htb-btn-box').forEach(btn => {
      btn.addEventListener('click', () => {
        const gameId = btn.dataset.gameId;
        const sport  = btn.dataset.sport;
        const card   = btn.closest('.htb-card');
        const teams  = [...card.querySelectorAll('.htb-team-name')].map(n => n.textContent);
        this.dispatchEvent(new CustomEvent('htb:boxscore', {
          bubbles: true,
          detail: { gameId, sport, teams }
        }));
      });
    });
  }
}

customElements.define('htb-live-games', HTBLiveGames);
