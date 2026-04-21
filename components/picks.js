/**
 * HammerTimeBet — Picks Frontend
 * ================================
 * Fetches picks from /api/picks and renders pick cards.
 * No pick generation, no ESPN calls, no logic — pure fetch + render.
 *
 * Usage:
 *   Sport page:  HTBPicks.render('mlb', 'mlb-picks-grid')
 *   Sport page with dogs: HTBPicks.render('mlb', 'mlb-picks-grid', 'mlb-dogs-grid')
 *   Homepage:    HTBPicks.renderWithFeatured(['mlb','nba','nfl','nhl','ncaam'], 'featured-play', 'top-picks-grid', 'dog-picks-grid')
 */
(function (global) {
  'use strict';

  /* ── Shared UI snippets ─────────────────────────────────────── */
  const LOADING = `
    <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:48px 20px;color:#555;font-size:12px;letter-spacing:.04em">
      <div style="width:16px;height:16px;border:2px solid #2a2a2a;border-top-color:#f0b429;border-radius:50%;animation:htbPickSpin .65s linear infinite;flex-shrink:0"></div>
      Generating picks…
    </div>`;

  const FEATURED_LOADING = `
    <div style="background:#101010;border:1px solid #222;border-top:4px solid #222;border-radius:14px;padding:24px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:14px">
        <div style="width:160px;height:11px;background:#1a1a1a;border-radius:3px"></div>
        <div style="display:flex;gap:6px"><div style="width:44px;height:20px;background:#1a1a1a;border-radius:100px"></div><div style="width:80px;height:20px;background:#1a1a1a;border-radius:4px"></div></div>
      </div>
      <div style="width:55%;height:38px;background:#1a1a1a;border-radius:4px;margin-bottom:18px"></div>
      <div style="display:flex;gap:28px;margin-bottom:16px">
        <div><div style="width:56px;height:26px;background:#1a1a1a;border-radius:4px;margin-bottom:4px"></div><div style="width:40px;height:10px;background:#1a1a1a;border-radius:3px"></div></div>
        <div><div style="width:40px;height:26px;background:#1a1a1a;border-radius:4px;margin-bottom:4px"></div><div style="width:64px;height:10px;background:#1a1a1a;border-radius:3px"></div></div>
        <div><div style="width:52px;height:26px;background:#1a1a1a;border-radius:4px;margin-bottom:4px"></div><div style="width:52px;height:10px;background:#1a1a1a;border-radius:3px"></div></div>
      </div>
      <div style="height:4px;background:#1a1a1a;border-radius:2px;margin-bottom:18px"></div>
      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid #1a1a1a;padding-top:16px">
        <div style="height:12px;background:#1a1a1a;border-radius:3px;width:92%"></div>
        <div style="height:12px;background:#1a1a1a;border-radius:3px;width:84%"></div>
        <div style="height:12px;background:#1a1a1a;border-radius:3px;width:88%"></div>
        <div style="height:12px;background:#1a1a1a;border-radius:3px;width:76%"></div>
      </div>
    </div>`;

  const NO_PICKS = `
    <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:48px 20px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#666">No picks available today.</div>
      <div style="font-size:11px;color:#444;margin-top:6px">No games scheduled for this sport today.</div>
    </div>`;

  const NO_DOGS = `
    <div style="grid-column:1/-1;background:#101010;border:1px solid #1e1e1e;border-radius:12px;padding:48px 20px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#666">No underdog picks today.</div>
      <div style="font-size:11px;color:#444;margin-top:6px">Underdog picks appear when today's lines post closer to game time.</div>
    </div>`;

  /* ── Inject styles once ─────────────────────────────────────── */
  if (!document.getElementById('htbPickSpinStyle')) {
    const s = document.createElement('style');
    s.id = 'htbPickSpinStyle';
    s.textContent = `
      @keyframes htbPickSpin { to { transform: rotate(360deg); } }

      /* ── Shared badge/sport chips ── */
      .pc-sport { font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#555;background:#181818;border:1px solid #222;padding:3px 9px;border-radius:100px }
      .pc-badge { font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:4px }
      .pc-badge.strong { background:rgba(240,180,41,.1);color:#f0b429;border:1px solid rgba(240,180,41,.2) }
      .pc-badge.value  { background:rgba(0,208,132,.08);color:#00d084;border:1px solid rgba(0,208,132,.2) }
      .pc-badge.dog    { background:rgba(129,140,248,.08);color:#818cf8;border:1px solid rgba(129,140,248,.2) }
      .pc-conf-lbl { font-size:10px;color:#444;font-weight:600;white-space:nowrap }
      .conf-track  { flex:1;height:5px !important;background:#1e1e1e;border-radius:3px;overflow:hidden }
      .conf-fill   { height:100%;border-radius:3px }

      /* ── Featured pick card ── */
      .featured-pick-card {
        background: #101010;
        border: 1px solid #2a2a2a;
        border-top: 4px solid #f0b429;
        border-radius: 14px;
        padding: 24px;
        margin-bottom: 16px;
        box-shadow: 0 2px 40px rgba(240,180,41,.07);
        transition: box-shadow .2s;
      }
      .featured-pick-card:hover { box-shadow: 0 4px 48px rgba(240,180,41,.12); }
      .fpc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .fpc-eyebrow {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .16em;
        text-transform: uppercase;
        color: #f0b429;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fpc-badges { display: flex; align-items: center; gap: 6px; }
      .fpc-matchup { font-size: 12px; color: #555; margin-bottom: 6px; letter-spacing: .02em; }
      .fpc-pick {
        font-family: 'Barlow Condensed', sans-serif;
        font-size: clamp(32px, 5vw, 42px);
        font-weight: 900;
        text-transform: uppercase;
        line-height: 1;
        margin-bottom: 18px;
        color: #fff;
      }
      .fpc-meta { display: flex; gap: 28px; margin-bottom: 14px; flex-wrap: wrap; }
      .fpc-meta-item { text-align: left; }
      .fpc-meta-val {
        font-family: 'Barlow Condensed', sans-serif;
        font-size: 28px;
        font-weight: 900;
        line-height: 1;
        color: #ccc;
      }
      .fpc-meta-val.fpc-odds { color: #f0b429; }
      .fpc-meta-lbl {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .13em;
        text-transform: uppercase;
        color: #444;
        margin-top: 4px;
      }
      .fpc-bar-wrap { height:5px;background:#1e1e1e;border-radius:3px;overflow:hidden;margin-bottom:18px }
      .fpc-bar-fill { height:100%;background:#f0b429;border-radius:3px }
      .fpc-reasons { border-top:1px solid #1e1e1e;padding-top:16px;display:flex;flex-direction:column;gap:8px }
      .fpc-reason  { display:flex;gap:9px;font-size:12px;color:#888;line-height:1.5 }
      .fpc-arrow   { color:#f0b429;font-size:9px;margin-top:3px;flex-shrink:0 }
    `;
    document.head.appendChild(s);
  }

  /* ── Featured pick card HTML ────────────────────────────────── */
  function featuredCardHTML(p) {
    const confPct = `${Math.round(p.conf * 10)}%`;
    const edgeCls = p.edge || 'strong';
    return `
      <div class="featured-pick-card">
        <div class="fpc-header">
          <div class="fpc-eyebrow">★&nbsp; Top Play of the Day</div>
          <div class="fpc-badges">
            <span class="pc-sport">${p.sport.toUpperCase()}</span>
            <span class="pc-badge ${edgeCls}">${p.edgeLabel}</span>
          </div>
        </div>
        <div class="fpc-matchup">${p.matchup}</div>
        <div class="fpc-pick">${p.pick}</div>
        <div class="fpc-meta">
          <div class="fpc-meta-item">
            <div class="fpc-meta-val fpc-odds">${p.odds}</div>
            <div class="fpc-meta-lbl">Odds</div>
          </div>
          <div class="fpc-meta-item">
            <div class="fpc-meta-val">${p.units}u</div>
            <div class="fpc-meta-lbl">Recommended</div>
          </div>
          <div class="fpc-meta-item">
            <div class="fpc-meta-val">${p.conf.toFixed(1)}/10</div>
            <div class="fpc-meta-lbl">Confidence</div>
          </div>
        </div>
        <div class="fpc-bar-wrap"><div class="fpc-bar-fill" style="width:${confPct}"></div></div>
        <div class="fpc-reasons">
          ${p.reasons.map(r => `<div class="fpc-reason"><span class="fpc-arrow">▸</span>${r}</div>`).join('')}
        </div>
      </div>`;
  }

  /* ── Regular pick card HTML ─────────────────────────────────── */
  function cardHTML(p, isDog) {
    const cls     = isDog ? 'dog' : (p.edge === 'strong' ? '' : p.edge);
    const confPct = `${Math.round(p.conf * 10)}%`;
    const fillClr = isDog ? '#818cf8' : (p.edge === 'value' ? '#00d084' : '#f0b429');
    return `
      <div class="pick-card ${cls}">
        <div class="pc-top">
          <span class="pc-sport">${p.sport.toUpperCase()}</span>
          <span class="pc-badge ${isDog ? 'dog' : p.edge}">${p.edgeLabel}</span>
        </div>
        <div class="pc-matchup">${p.matchup}</div>
        <div class="pc-pick">${p.pick}</div>
        <div class="pc-odds">${p.odds}</div>
        <div class="pc-conf">
          <span class="pc-conf-lbl">Confidence</span>
          <div class="conf-track"><div class="conf-fill" style="width:${confPct};background:${fillClr}"></div></div>
          <span class="pc-conf-val" style="font-size:12px;font-weight:700;color:#666">${p.conf.toFixed(1)}/10</span>
        </div>
        <div class="pc-sep"></div>
        <div class="pc-reasons">${p.reasons.map(t => `<div class="pc-reason">${t}</div>`).join('')}</div>
      </div>`;
  }

  /* ── Fetch with 5-min in-memory cache ───────────────────────── */
  const _cache = new Map();

  async function _fetchPicks(url) {
    const hit = _cache.get(url);
    if (hit && Date.now() - hit.ts < 300_000) return hit.data;
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
      console.log(`[HTB Picks] ${sport.toUpperCase()}: ${top.length} top, ${dog.length} dog`);

      if (container) {
        container.innerHTML = top.length ? top.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      }
      if (dogCont) {
        dogCont.innerHTML = dog.length ? dog.map(p => cardHTML(p, true)).join('') : NO_DOGS;
      }
    },

    /**
     * Homepage: renders the #1 pick as a full-width featured card,
     * remaining top picks in the regular grid, dogs in the dog grid.
     */
    async renderWithFeatured(sports, featuredId, topId, dogId, dogLabelId) {
      const featuredEl = document.getElementById(featuredId);
      const topEl      = document.getElementById(topId);
      const dogEl      = document.getElementById(dogId);
      const dogLabelEl = dogLabelId ? document.getElementById(dogLabelId) : null;

      if (featuredEl) featuredEl.innerHTML = FEATURED_LOADING;
      if (topEl)      topEl.innerHTML      = LOADING;
      if (dogEl)      dogEl.innerHTML      = LOADING;
      if (dogLabelEl) dogLabelEl.textContent = "Today's Underdogs";

      const sportsParam = sports.map(s => encodeURIComponent(s)).join(',');
      const data = await _fetchPicks(`/api/picks?sports=${sportsParam}`);

      if (!data) {
        if (featuredEl) featuredEl.innerHTML = '';
        if (topEl)      topEl.innerHTML      = NO_PICKS;
        if (dogEl)      dogEl.innerHTML      = NO_DOGS;
        return;
      }

      const { top = [], dog = [] } = data;
      const [featured, ...rest]    = top;

      const dist = top.reduce((m, p) => { m[p.sport] = (m[p.sport] || 0) + 1; return m; }, {});
      console.log(`[HTB Picks] Homepage: ${top.length} top (${Object.entries(dist).map(([s,n])=>`${s}:${n}`).join(', ')}), ${dog.length} dog`);

      if (featuredEl) {
        featuredEl.innerHTML = featured ? featuredCardHTML(featured) : '';
      }
      if (topEl) {
        topEl.innerHTML = rest.length
          ? rest.map(p => cardHTML(p, false)).join('')
          : (featured ? '' : NO_PICKS);
      }
      if (dogEl) {
        dogEl.innerHTML = dog.length ? dog.map(p => cardHTML(p, true)).join('') : NO_DOGS;
      }
    },

    /** Legacy: render all top picks into one grid (no featured split). */
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
      if (topEl) topEl.innerHTML = top.length ? top.map(p => cardHTML(p, false)).join('') : NO_PICKS;
      if (dogEl) dogEl.innerHTML = dog.length ? dog.map(p => cardHTML(p, true)).join('') : NO_DOGS;
    },
  };

})(window);
