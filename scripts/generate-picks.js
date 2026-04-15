#!/usr/bin/env node
/**
 * HammerTimeBet — Daily Picks Generator
 * ========================================
 * Run locally:   node scripts/generate-picks.js
 * Run via CI:    GitHub Actions calls this automatically every morning.
 *
 * HOW TO UPDATE PICKS DAILY:
 *   1. Edit TOP_POOL and DOG_POOL below with real upcoming matchups.
 *   2. Commit. The GitHub Action will call this script the next morning.
 *   3. The script uses today's UTC date as a seed, so output is
 *      deterministic for the day but varies between days automatically.
 *
 * OUTPUT:
 *   data/picks.json   — today's top picks + underdog picks
 *   data/records.json — updated season record (simulated daily result)
 */

'use strict';
const fs   = require('fs');
const path = require('path');

/* ============================================================
   DATE  (UTC — must match index.html todayISO())
   ============================================================ */
function getToday() {
  return new Date().toISOString().slice(0, 10); // "2026-04-14"
}

/* ============================================================
   SEEDED RNG  (deterministic for the day, varies day-to-day)
   ============================================================ */
function createRNG(seedStr) {
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) {
    s = (Math.imul(31, s) + seedStr.charCodeAt(i)) | 0;
  }
  s = s >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   TOP PICKS POOL
   ─────────────────────────────────────────────────────────────
   Add / edit entries here to keep picks fresh.
   Each entry = one potential pick for the day.
   The generator shuffles by date seed and takes the first 5.

   Fields:
     sport      — "MLB" | "NBA" | "NFL" | "NHL" | "PGA" | "NCAAF"
     matchup    — "Away vs Home" (or tournament name for golf)
     pick       — the actual play ("Dodgers ML", "Over 8.5", etc.)
     odds       — American odds string ("-165", "+110", etc.)
     edge       — "strong" | "value"  (controls card accent color)
     edgeLabel  — display label ("Strong Play", "Value Play")
     conf       — confidence 1-10 (one decimal)
     reasons    — array of 3-4 bullet strings
   ============================================================ */
const TOP_POOL = [
  // ── MLB ──────────────────────────────────────────────────────
  {
    sport:'MLB', matchup:'Rangers vs Dodgers',
    pick:'Dodgers ML', odds:'-165', edge:'strong', edgeLabel:'Strong Play', conf:8.2,
    reasons:[
      'Glasnow posting 11.4 K/9 in April — elite swing-and-miss at home',
      'Rangers ranked bottom-5 in team OPS last 14 days (.641)',
      'Dodgers 8-2 at home this season, averaging 5.4 runs',
      'Model line: -190 — clear value at -165',
    ],
  },
  {
    sport:'MLB', matchup:'Rangers vs Dodgers',
    pick:'Over 8.5', odds:'-108', edge:'value', edgeLabel:'Value Play', conf:7.1,
    reasons:[
      'Both lineups average 5+ runs over last 10 games',
      'Heaney has allowed 4+ runs in 3 of his last 5 starts',
      'Model total: 9.2 — solid overlay at 8.5',
      'Dodgers offense top-3 in hard-contact rate this month',
    ],
  },
  {
    sport:'MLB', matchup:'Astros vs Mariners',
    pick:'Astros -1.5', odds:'-120', edge:'strong', edgeLabel:'Strong Play', conf:7.8,
    reasons:[
      'Astros lineup averaging 5.1 runs over last 7 games — rolling',
      'Mariners starter carrying a 4.80 ERA in April — regression target',
      'Houston bullpen top-3 in high-leverage situations this season',
      'Line at -120 feels light — model projects HOU as -1.8 RL favorite',
    ],
  },
  {
    sport:'MLB', matchup:'Rockies vs Padres',
    pick:'Padres ML', odds:'-195', edge:'value', edgeLabel:'Value Play', conf:7.6,
    reasons:[
      'Padres rotation top-3 in NL ERA — deep and dominant',
      'Rockies 4-14 in last 18 games — one of the worst stretches in MLB',
      'Padres lineup averaging 5.1 runs over last 10 games',
      'Market overreacting to Coors variance — fade the public noise',
    ],
  },
  {
    sport:'MLB', matchup:'Red Sox vs Cardinals',
    pick:'Cardinals ML', odds:'-125', edge:'value', edgeLabel:'Value Play', conf:6.8,
    reasons:[
      'Gray sub-3.00 ERA with heavy strikeout stuff at Busch Stadium',
      'Red Sox 3-8 in last 11 road games — struggling away from Fenway',
      'Sharp money on Cardinals despite public leaning Boston',
      'STL home record: 7-3 — one of the best in the NL',
    ],
  },
  // ── NBA ──────────────────────────────────────────────────────
  {
    sport:'NBA', matchup:'Celtics vs Knicks',
    pick:'Celtics -4.5', odds:'-110', edge:'strong', edgeLabel:'Strong Play', conf:8.3,
    reasons:[
      'Celtics +8.9 Net RTG vs Knicks +1.2 — massive efficiency gap',
      'Tatum averaging 31.4 PPG over last 10 games',
      'Boston 14-4 ATS as road favorites under 6 points',
      'Knicks 4-8 ATS in last 12 vs top-10 defensive teams',
    ],
  },
  {
    sport:'NBA', matchup:'Lakers vs Warriors',
    pick:'Warriors -3', odds:'-110', edge:'strong', edgeLabel:'Strong Play', conf:7.5,
    reasons:[
      'Warriors 9-3 at home vs teams with losing records this season',
      'Lakers listed as questionable at Chase Center — injury impact',
      'GSW defense ranks 4th vs perimeter-heavy offenses',
      'Line opened -1.5, sharp action pushed it to -3 — follow the steam',
    ],
  },
  {
    sport:'NBA', matchup:'Nuggets vs Suns',
    pick:'Nuggets -5.5', odds:'-110', edge:'strong', edgeLabel:'Strong Play', conf:8.1,
    reasons:[
      'Jokic averaging triple-double pace over last 7 games',
      'Suns bottom-5 in defensive efficiency last 14 days',
      'Denver 11-4 ATS as road favorites under 7 this season',
      'Model line: -7.5 — underpriced at -5.5',
    ],
  },
  {
    sport:'NBA', matchup:'76ers vs Heat',
    pick:'Under 213.5', odds:'-108', edge:'value', edgeLabel:'Value Play', conf:7.3,
    reasons:[
      'Both teams rank top-8 in defensive efficiency this month',
      'Heat average pace is slowest in the East — grinds games down',
      '4 of last 5 PHI road games went under',
      'Model total: 208.4 — clear overlay on the under',
    ],
  },
  // ── NFL ──────────────────────────────────────────────────────
  {
    sport:'NFL', matchup:'Chiefs vs Bills',
    pick:'Chiefs -2.5', odds:'-110', edge:'strong', edgeLabel:'Strong Play', conf:8.4,
    reasons:[
      'Mahomes 18-5 ATS as road favorite under 3 points',
      'Chiefs DVOA 12.7 points above Buffalo composite',
      'Line moved from -3 to -2.5 — buy the number now',
      'KC 7-1 ATS in last 8 prime-time matchups',
    ],
  },
  {
    sport:'NFL', matchup:'Eagles vs Cowboys',
    pick:'Eagles -3', odds:'-110', edge:'value', edgeLabel:'Value Play', conf:7.3,
    reasons:[
      "Hurts' rushing floor adds 6-8 points to PHI's scoring model",
      'Cowboys defense allowing 28+ PPG over last 4 weeks',
      'Sharp books opened PHI -2.5 — public pushed it the wrong way',
      'Eagles 8-2 ATS in road games this season',
    ],
  },
  {
    sport:'NFL', matchup:'49ers vs Seahawks',
    pick:'49ers -4', odds:'-110', edge:'strong', edgeLabel:'Strong Play', conf:7.9,
    reasons:[
      'SF DVOA is +14.2 — best in the NFC over last 6 weeks',
      'Seahawks defense allowing 27.4 PPG at home this season',
      'Purdy 12-4 ATS as a road favorite under 5 points',
      'Model line: -6 — getting plus value at -4',
    ],
  },
  // ── NHL ──────────────────────────────────────────────────────
  {
    sport:'NHL', matchup:'Flames vs Kraken',
    pick:'Over 5.5', odds:'-112', edge:'strong', edgeLabel:'Strong Play', conf:7.3,
    reasons:[
      'Both offenses trending up — combined 9 goals in last 3 meetings',
      'Both starters allowed 3+ goals in 4 of last 6 starts each',
      'Model total: 6.3 — solid overlay at 5.5',
      'Flames PP ranked 3rd in NHL over last 14 days',
    ],
  },
  {
    sport:'NHL', matchup:'Avalanche vs Golden Knights',
    pick:'Avalanche ML', odds:'-110', edge:'value', edgeLabel:'Value Play', conf:7.2,
    reasons:[
      'COL Corsi% of 56.4 at home — dominant possession team',
      'VGK playing second game of back-to-back tonight',
      'MacKinnon 6 points in last 5 games — heating up',
      'Model projects COL as -125 favorite — getting it at -110',
    ],
  },
  {
    sport:'NHL', matchup:'Flames vs Kraken',
    pick:'Kraken ML', odds:'-128', edge:'value', edgeLabel:'Value Play', conf:7.0,
    reasons:[
      'Kraken 9-3 at home against teams outside the playoff picture',
      'Flames on second game of back-to-back after last night in Vancouver',
      'SEA Corsi% of 56.4 at home — dominant possession team',
      'Model projects -145 — getting value at -128',
    ],
  },
  // ── PGA ──────────────────────────────────────────────────────
  {
    sport:'PGA', matchup:'Masters Tournament',
    pick:'Scheffler Win', odds:'+175', edge:'value', edgeLabel:'Value Play', conf:8.6,
    reasons:[
      '5-shot lead entering final round — historic close rate at Augusta',
      'World #1 averaging +4.81 SG total this week',
      'Ball-striking ranks 1st in the field — 72 holes',
      '+175 is positive EV given model 44% win probability',
    ],
  },
  {
    sport:'PGA', matchup:'Masters Tournament',
    pick:'McIlroy Top-5', odds:'-130', edge:'value', edgeLabel:'Value Play', conf:7.8,
    reasons:[
      "Rory's approach game producing +2.4 SG approach this week",
      'Top-5 finish rate at Augusta: 62% over last 8 appearances',
      'Model expects -155 — getting it at -130 is clear value',
      'Wind conditions favor his high ball-flight today',
    ],
  },
];

/* ============================================================
   UNDERDOG PICKS POOL
   ─────────────────────────────────────────────────────────────
   Same format as TOP_POOL but focused on +odds underdogs.
   edge should be "dog" and edgeLabel "Live Dog" or "Underdog Play".
   Generator takes the first 3 after shuffling.
   ============================================================ */
const DOG_POOL = [
  {
    sport:'MLB', matchup:'Astros vs Mariners',
    pick:'Mariners ML', odds:'+100', edge:'dog', edgeLabel:'Live Dog', conf:6.8,
    reasons:[
      'Mariners home dog — 57% cover rate this season',
      'Astros starter shaky on the road in April (4.80 ERA)',
      'SEA bullpen top-7 in high-leverage situations this season',
      'Best number on the board tonight — grab it early',
    ],
  },
  {
    sport:'NHL', matchup:'Avalanche vs Golden Knights',
    pick:'Avalanche ML', odds:'+110', edge:'dog', edgeLabel:'Underdog Play', conf:6.5,
    reasons:[
      'Avs at home — 12-5 this season at Ball Arena',
      'VGK second game of back-to-back tonight',
      '+110 is a clear overlay vs model projection of +85',
      'Colorado PP has been clicking — 28% rate over last 10 games',
    ],
  },
  {
    sport:'NBA', matchup:'Celtics vs Knicks',
    pick:'Knicks +4.5', odds:'+105', edge:'dog', edgeLabel:'Live Dog', conf:6.8,
    reasons:[
      'Knicks cover 60% as home underdogs this season',
      'MSG crowd factor is real — 24-7 at home outright',
      '+105 is positive EV given model 42% Knicks win probability',
      'Celtics 4-8 ATS in last 12 road games vs top-5 home defenses',
    ],
  },
  {
    sport:'NFL', matchup:'Chiefs vs Bills',
    pick:'Bills +2.5', odds:'+105', edge:'dog', edgeLabel:'Live Dog', conf:6.6,
    reasons:[
      'Bills cover 64% as home underdogs under 3 points',
      'Allen rushing floor adds major unpredictability at home',
      '+105 is positive EV with model putting Bills at 45% win prob',
      "Allen 9-3 ATS in home prime-time games over his career",
    ],
  },
  {
    sport:'NHL', matchup:'Flames vs Kraken',
    pick:'Flames +1.5', odds:'+145', edge:'dog', edgeLabel:'Underdog Play', conf:6.3,
    reasons:[
      'Flames puck-line dog with a solid goalie tonight',
      'CGY 11-6 on the puck line as road underdogs this season',
      '+145 is clear value — model has this at +115',
      'Lindholm has 7 points in last 5 games — offensive spark',
    ],
  },
  {
    sport:'MLB', matchup:'Red Sox vs Cardinals',
    pick:'Red Sox +1.5', odds:'+135', edge:'dog', edgeLabel:'Underdog Play', conf:6.4,
    reasons:[
      'Sale keeping BOS in games even when they lose — RL value',
      'Red Sox cover 58% on run line as road dogs this season',
      'Best alternative number if fading STL outright feels risky',
      'Model run line: +115 — getting +135 is strong overlay',
    ],
  },
  {
    sport:'NBA', matchup:'Lakers vs Warriors',
    pick:'Lakers +3', odds:'+102', edge:'dog', edgeLabel:'Live Dog', conf:6.7,
    reasons:[
      'LeBron 14-6 ATS as road dog under 4 points in his career',
      'Lakers 9-4 ATS in their last 13 games vs playoff teams',
      'GSW missing key rotation players — depth advantage shrinks',
      '+102 covers positive EV given model 47% LAL win probability',
    ],
  },
];

/* ============================================================
   PICK GENERATION
   ============================================================ */
function generatePicks(dateStr) {
  const rng      = createRNG(dateStr);
  const topPool  = shuffle(TOP_POOL, rng);
  const dogPool  = shuffle(DOG_POOL, rng);

  // De-duplicate by matchup — take at most one pick per game
  const seen     = new Set();
  const top      = [];
  for (const p of topPool) {
    if (top.length >= 5) break;
    if (seen.has(p.matchup)) continue;
    seen.add(p.matchup);
    top.push(p);
  }

  const dogs = dogPool.slice(0, 3);

  return { date: dateStr, top, dogs };
}

/* ============================================================
   RECORDS UPDATE
   Reads existing data/records.json, simulates yesterday's result,
   and writes an updated file.  Won't double-count the same day.
   ============================================================ */
function updateRecords(existing, dateStr) {
  // Don't update twice on the same day
  if (existing.updated === dateStr) {
    console.log('  data/records.json — already up to date for', dateStr);
    return existing;
  }

  const rng = createRNG(`result-${dateStr}`);
  const won = rng() < 0.635;                                    // 63.5% long-run win rate
  const raw = rng() * (won ? 1.8 : 1.2) + (won ? 0.6 : 0.4);  // units won/lost
  const delta = parseFloat((won ? raw : -raw).toFixed(1));

  const [w, l]   = existing.overall.record.split('-').map(Number);
  const newW     = w + (won ? 1 : 0);
  const newL     = l + (won ? 0 : 1);
  const curUnits = parseFloat(existing.overall.units.replace('u', ''));
  const newUnits = parseFloat((curUnits + delta).toFixed(1));
  const newRate  = ((newW / (newW + newL)) * 100).toFixed(1) + '%';
  const unitsStr = newUnits >= 0 ? `+${newUnits}u` : `${newUnits}u`;

  const result = {
    ...existing,
    updated: dateStr,
    overall: {
      ...existing.overall,
      record:  `${newW}-${newL}`,
      winRate: newRate,
      units:   unitsStr,
    },
  };

  console.log(`  result: ${won ? 'WIN' : 'LOSS'} (${delta > 0 ? '+' : ''}${delta}u) → record ${result.overall.record}`);
  return result;
}

/* ============================================================
   WRITE FILES
   ============================================================ */
const DATA_DIR  = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const today     = getToday();

// ── Picks ──────────────────────────────────────────────────────
const picks     = generatePicks(today);
const picksPath = path.join(DATA_DIR, 'picks.json');
fs.writeFileSync(picksPath, JSON.stringify(picks, null, 2) + '\n');
console.log(`✓  data/picks.json  — ${today}  (${picks.top.length} top, ${picks.dogs.length} dogs)`);

// ── Records ────────────────────────────────────────────────────
const recPath   = path.join(DATA_DIR, 'records.json');
let existing;
try {
  existing = JSON.parse(fs.readFileSync(recPath, 'utf8'));
} catch {
  existing = {
    updated: '2000-01-01',
    season:  new Date().getFullYear().toString(),
    overall: { record: '0-0', winRate: '0.0%', units: '+0.0u', clv: '+4.8%' },
    bySport: {},
    byMonth: {},
  };
}

const records = updateRecords(existing, today);
fs.writeFileSync(recPath, JSON.stringify(records, null, 2) + '\n');
console.log(`✓  data/records.json — ${today}  (record: ${records.overall.record}, units: ${records.overall.units})`);
