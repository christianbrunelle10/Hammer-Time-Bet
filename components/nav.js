/**
 * HammerTimeBet — Reusable Navigation Component
 * Usage: <script src="/components/nav.js"></script>
 *        <htb-nav></htb-nav>
 *
 * Active link is set automatically based on window.location.pathname.
 * To override: <htb-nav active="mlb"></htb-nav>
 */

class HTBNav extends HTMLElement {
  connectedCallback() {
    const override = this.getAttribute('active');
    const path     = window.location.pathname.toLowerCase();
    const current  = override || this._detectActive(path);

    this.innerHTML = this._template(current);
    this._bindToggle();
  }

  _detectActive(path) {
    if (path === '/' || path.endsWith('index.html')) return 'home';
    const sports = ['mlb', 'nba', 'nfl', 'nhl', 'golf'];
    return sports.find(s => path.includes(s)) || 'home';
  }

  _link(key, label, current) {
    const active = key === current ? ' nav-active' : '';
    return `<a href="${key === 'home' ? '/' : `/${key}`}" class="nav-link${active}">${label}</a>`;
  }

  _template(current) {
    return `
      <style>
        htb-nav { display: block; }

        .htb-nav-bar {
          position: sticky;
          top: 0;
          z-index: 200;
          background: rgba(8,8,8,.97);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid #222;
          height: 56px;
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 0;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .htb-brand {
          font-family: 'Barlow Condensed', 'Inter', sans-serif;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: .04em;
          text-transform: uppercase;
          color: #fff;
          text-decoration: none;
          white-space: nowrap;
          margin-right: 28px;
          flex-shrink: 0;
        }
        .htb-brand em { font-style: normal; color: #f0b429; }

        .htb-links {
          display: flex;
          align-items: center;
          gap: 2px;
          flex: 1;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .htb-links::-webkit-scrollbar { display: none; }

        .nav-link {
          padding: 6px 13px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: #888;
          text-decoration: none;
          white-space: nowrap;
          transition: color .15s, background .15s;
          flex-shrink: 0;
        }
        .nav-link:hover  { color: #fff; background: #181818; }
        .nav-link.nav-active { color: #fff; background: #1e1e1e; }

        /* Live indicator dot on active link */
        .nav-active::after {
          content: '';
          display: inline-block;
          width: 5px;
          height: 5px;
          background: #f0b429;
          border-radius: 50%;
          margin-left: 6px;
          vertical-align: middle;
          position: relative;
          top: -1px;
        }

        .htb-nav-right {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-left: auto;
          flex-shrink: 0;
        }

        .htb-picks-btn {
          background: #f0b429;
          color: #000;
          padding: 7px 16px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .08em;
          text-transform: uppercase;
          text-decoration: none;
          transition: opacity .15s;
          white-space: nowrap;
        }
        .htb-picks-btn:hover { opacity: .85; }

        /* Hamburger — mobile only */
        .htb-hamburger {
          display: none;
          flex-direction: column;
          gap: 5px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          margin-left: 8px;
        }
        .htb-hamburger span {
          display: block;
          width: 22px;
          height: 2px;
          background: #888;
          border-radius: 2px;
          transition: background .15s;
        }
        .htb-hamburger:hover span { background: #fff; }

        /* Mobile drawer */
        .htb-mobile-menu {
          display: none;
          flex-direction: column;
          background: #0f0f0f;
          border-bottom: 1px solid #222;
          padding: 12px 16px 16px;
          gap: 4px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        .htb-mobile-menu.open { display: flex; }
        .htb-mobile-menu .nav-link {
          font-size: 14px;
          padding: 10px 14px;
          border-radius: 8px;
          color: #888;
        }
        .htb-mobile-menu .nav-link:hover,
        .htb-mobile-menu .nav-link.nav-active { background: #1a1a1a; color: #fff; }

        @media (max-width: 680px) {
          .htb-links      { display: none; }
          .htb-picks-btn  { display: none; }
          .htb-hamburger  { display: flex; }
          .htb-brand      { margin-right: auto; }
        }
      </style>

      <!-- ── Desktop bar ────────────────────────── -->
      <div class="htb-nav-bar">
        <a href="/" class="htb-brand">Hammer<em>Time</em>Bet</a>

        <nav class="htb-links" aria-label="Main navigation">
          ${this._link('home', 'Home',  current)}
          ${this._link('mlb',  'MLB',   current)}
          ${this._link('nba',  'NBA',   current)}
          ${this._link('nfl',  'NFL',   current)}
          ${this._link('nhl',  'NHL',   current)}
          ${this._link('golf', 'Golf',  current)}
        </nav>

        <div class="htb-nav-right">
          <a href="/#picks" class="htb-picks-btn">Today's Picks</a>
          <button class="htb-hamburger" id="htb-menu-btn" aria-label="Open menu" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>

      <!-- ── Mobile drawer ──────────────────────── -->
      <div class="htb-mobile-menu" id="htb-mobile-menu" role="navigation" aria-label="Mobile navigation">
        ${this._link('home', 'Home',  current)}
        ${this._link('mlb',  'MLB',   current)}
        ${this._link('nba',  'NBA',   current)}
        ${this._link('nfl',  'NFL',   current)}
        ${this._link('nhl',  'NHL',   current)}
        ${this._link('golf', 'Golf',  current)}
      </div>
    `;
  }

  _bindToggle() {
    const btn  = this.querySelector('#htb-menu-btn');
    const menu = this.querySelector('#htb-mobile-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target)) menu.classList.remove('open');
    }, { passive: true });

    // Close on route link click
    menu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => menu.classList.remove('open'));
    });
  }
}

customElements.define('htb-nav', HTBNav);
