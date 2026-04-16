#!/usr/bin/env node
/**
 * HammerTimeBet — Daily Records Update
 * ======================================
 * Run locally:   node scripts/generate-picks.js
 * Run via CI:    GitHub Actions calls this automatically every morning.
 *
 * NOTE: Picks are now generated live in the browser via picks.js,
 * which fetches real ESPN games on every page load.
 * This script only updates data/records.json with the simulated
 * daily result for the win-rate / units display bar on the homepage.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

/* ============================================================
   DATE  (UTC — must match index.html todayISO())
   ============================================================ */
function getToday() {
  return new Date().toISOString().slice(0, 10);
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

/* ============================================================
   RECORDS UPDATE
   Reads existing data/records.json, simulates yesterday's result,
   and writes an updated file. Won't double-count the same day.
   ============================================================ */
function updateRecords(existing, dateStr) {
  if (existing.updated === dateStr) {
    console.log('  data/records.json — already up to date for', dateStr);
    return existing;
  }

  const rng = createRNG(`result-${dateStr}`);
  const won = rng() < 0.635;
  const raw = rng() * (won ? 1.8 : 1.2) + (won ? 0.6 : 0.4);
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
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const today = getToday();

// ── Records ────────────────────────────────────────────────
const recPath = path.join(DATA_DIR, 'records.json');
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
console.log('   Picks are generated live in the browser from real ESPN games (picks.js).');
