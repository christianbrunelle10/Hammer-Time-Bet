/**
 * HammerTimeBet — Picks Frontend
 * ================================
 * Fetches picks from /api/picks and renders pick cards.
 * No pick generation, no ESPN calls, no logic — pure fetch + render.
 *
 * Usage:
 *   Sport page:  HTBPicks.render('mlb', 'mlb-picks-grid')
 *   NCAAF page:  HTBPicks.render('ncaaf', 'ncaaf-picks-grid', 'ncaaf-dogs-grid')
 *   Homepage:    HTBPicks.renderHomepage(['mlb','nba','nfl','nhl','ncaam'], 'top-picks-grid', 'dog-picks-grid')
 */
(function (global) {
  'use strict';

  /* ── Shared UI snippets ─────────────────────────────────────── */
  const LOADING = `
    <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:40px 20px;color:#444;font-size:13px">
      <div style="width:16px;height:16px;border:2px solid #2a2a2a;border-top-color:#f0b429;border-radius:50%;animation:htbPickSpin .65s linear infinite;flex-shrink:0"></div>
      Loading picks…
    </div>`;

  const NO_PICKS = `
    <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:44px 20px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#888">No picks available today.</div>
      <div style="font-size:11px;color:#444;margin-top:6px">No games scheduled for this sport today.</div>
    </div>`;

  const NO_DOGS = `
    <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:44px 20px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#888">No underdog picks available today.</div>
      <div style="font-size:11px;color:#444;margin-top:6px">Underdog picks appear when today's lines post closer to game time.</div>
    </div>`;

  if (!document.getElementById('htbPickSpinStyle')) {
    const s = document.createElement('style');
    s.id = 'htbPickSpinStyle';
    s.textContent = `
      @keyframes htbPickSpin { to { transform: rotate(360deg); } }
      .pc-sport { font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#555;background:#181818;border:1px solid #222;padding:3px 9px;border-radius:100px }
      .pc-badge { font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:4px }
      .pc-badge.strong { background:rgba(240,180,41,.1);color:#f0b429;border:1px solid rgba(240,180,41,.2) }
      .pc-badge.value  { background:rgba(0,208,132,.08);color:#00d084;border:1px solid rgba(0,208,132,.2) }
      .pc-badge.dog    { background:rgba(129,140,248,.08);color:#818cf8;border:1px solid rgba(129,140,248,.2) }
      .pc-conf-lbl { font-size:10px;color:#444;font-weight:600;white-space:nowrap }
    `;
    document.head.appendChild(s);
  }

  /* ── Pick card HTML ─────────────────────────────────────────── */
  function cardHTML(p, isDog) {
    const cls     = isDog ? 'dog' : (p.edge === 'strong' ? '' : p.edge);
    const confPct = `${Math.round(p.conf * 10)}%`;
    return `
      <div class="pick-card ${cls}">
        <div class="pc-top">
          <span class="pc-sport">${p.sport}</span>
          <span class="pc-badge ${p.edge}">${p.edgeLabel}</span>
        </div>
        <div class="pc-matchup">${p.matchup}</div>
        <div class="pc-pick">${p.pick}</div>
        <div class="pc-odds">${p.odds}</div>
        <div class="pc-conf">
          <span class="pc-conf-lbl">Confidence</span>
          <div class="conf-track"><div class="conf-fill" style="width:${confPct}"></div></div>
          <span class="pc-conf-val">${p.conf}/10</span>
        </div>
        <div class="pc-sep"></div>
        <div class="pc-reasons">${p.reasons.map(t => `<div class="pc-reason">${t}</div>`).join('')}</div>
      </div>`;
  }

  /* ── Fetch with simple in-memory cache ─────────────────────── */
  const _cache = new Map();

  async function _fetchPicks(url) {
    const hit = _cache.get(url);
    if (hit && Date.now() - hit.ts < 300_000) return hit.data; // 5 min client cache
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`/api/picks ${r.status}`);
      const data = await r.json();
      _cache.set(url, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.error('[HTB Picks]', err.message);
      return null;
    }
  }

  /* ── PUBLIC API ─────────────────────────────────────────────── */
  global.HTBPicks = {

    /** Sport page: render top + dog picks for one sport. */
    async render(sport, containerId, dogId) {
      const container = document.getElementById(containerId);
      const dogCont   = dogId ? document.getElementById(dogId) : null;
      if (container) container.innerHTML = LOADING;
      if (dogCont)   dogCont.innerHTML   = LOADING;

      const data = await _fetchPicks(`/api/picks?sport=${encodeURIComponent(sport)}`);

      if (!data) {
        if (container) container.innerHTML = NO_PICKS;
        if (dogCont)   dogCont.innerHTML   = NO_PICKS;
        return;
      }

      const { top = [], dog = [] } = data;
      console.log(`[HTB Picks] ${sport.toUpperCase()}: ${top.length} top, ${dog.length} dog picks`);

      if (container) {
        container.innerHTML = top.length ? top.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      }
      if (dogCont) {
        dogCont.innerHTML = dog.length ? dog.map(p => cardHTML(p, true)).join('') : NO_DOGS;
      }
    },

    /** Homepage: render curated top + dog picks across multiple sports. */
    async renderHomepage(sports, topId, dogId, dogLabelId) {
      const topEl      = document.getElementById(topId);
      const dogEl      = document.getElementById(dogId);
      const dogLabelEl = dogLabelId ? document.getElementById(dogLabelId) : null;
      if (topEl) topEl.innerHTML = LOADING;
      if (dogEl) dogEl.innerHTML = LOADING;
      if (dogLabelEl) dogLabelEl.textContent = "Today's Underdogs";

      const sportsParam = sports.map(s => encodeURIComponent(s)).join(',');
      const data = await _fetchPicks(`/api/picks?sports=${sportsParam}`);

      if (!data) {
        if (topEl) topEl.innerHTML = NO_PICKS;
        if (dogEl) dogEl.innerHTML = NO_DOGS;
        return;
      }

      const { top = [], dog = [] } = data;
      const topDist = top.reduce((m, p) => { m[p.sport] = (m[p.sport] || 0) + 1; return m; }, {});
      console.log(`[HTB Picks] Homepage: ${top.length} top, ${dog.length} dog — sport mix:`, topDist);

      if (topEl) {
        topEl.innerHTML = top.length ? top.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      }
      if (dogEl) {
        dogEl.innerHTML = dog.length ? dog.map(p => cardHTML(p, true)).join('') : NO_DOGS;
      }
    },
  };

})(window);
