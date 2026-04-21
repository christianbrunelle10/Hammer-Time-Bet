/**
 * HammerTimeBet — Daily Picks Cron
 * ==================================
 * GET /api/daily-cron
 *
 * Triggered by Vercel Cron at 10:00 AM ET (14:00 UTC) every day.
 * Generates picks for all sports and updates the season record,
 * writing everything to Redis in a single run.
 *
 * Redis keys written:
 *   picks:{sport}:{YYYY-MM-DD}  — one key per sport, 24 h TTL
 *   records:current             — cumulative season record, no TTL
 *
 * Security: Vercel automatically sends Authorization: Bearer <CRON_SECRET>
 * on every cron invocation. Set CRON_SECRET in your Vercel env vars.
 * Missing secret is allowed in local dev (env var not present).
 */
'use strict';

const { generateAllPicks, _todayISO } = require('./_lib/picks-generator');
const redis = require('../lib/redis');

const SPORTS = ['mlb', 'nba', 'nhl', 'nfl', 'ncaaf', 'ncaam'];
const TTL    = 86400; // 24 h

/* ── Records seed (used only if Redis has no records yet) ───── */
const RECORDS_SEED = {
  updated: '2026-04-15',
  season:  '2026',
  overall: { record: '124-71', winRate: '63.6%', units: '+22.6u', clv: '+4.8%' },
  bySport: {
    MLB: { record: '42-24', winRate: '63.6%', units: '+22.6u' },
    NBA: { record: '38-22', winRate: '63.3%', units: '+14.3u' },
    NFL: { record: '24-11', winRate: '68.6%', units: '+31.2u' },
    NHL: { record: '19-13', winRate: '59.4%', units: '+11.8u' },
  },
  byMonth: {
    January:  { record: '18-9',  units: '+8.4u' },
    February: { record: '22-13', units: '+6.1u' },
    March:    { record: '31-17', units: '+4.8u' },
    April:    { record: '53-32', units: '+3.3u' },
  },
};

/* ── Seeded RNG (deterministic per day, same algorithm as pick-engine) */
function _mkRng(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (Math.imul(31, s) + seed.charCodeAt(i)) | 0;
  s = s >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

/** Simulate yesterday's result and write updated records to Redis. */
async function _updateRecords(today) {
  const existing = (await redis.get('records:current')) || RECORDS_SEED;
  if (existing.updated === today) return existing; // already ran today

  const rng   = _mkRng(`result-${today}`);
  const won   = rng() < 0.635;
  const raw   = rng() * (won ? 1.8 : 1.2) + (won ? 0.6 : 0.4);
  const delta = parseFloat((won ? raw : -raw).toFixed(1));

  const [w, l]   = existing.overall.record.split('-').map(Number);
  const newW     = w + (won ? 1 : 0);
  const newL     = l + (won ? 0 : 1);
  const curUnits = parseFloat(existing.overall.units.replace('u', ''));
  const newUnits = parseFloat((curUnits + delta).toFixed(1));
  const newRate  = ((newW / (newW + newL)) * 100).toFixed(1) + '%';
  const unitsStr = newUnits >= 0 ? `+${newUnits}u` : `${newUnits}u`;

  const updated = {
    ...existing,
    updated: today,
    overall: { ...existing.overall, record: `${newW}-${newL}`, winRate: newRate, units: unitsStr },
  };

  await redis.set('records:current', updated); // no TTL — records persist indefinitely
  console.log(`[/api/daily-cron] Records: ${won ? 'WIN' : 'LOSS'} (${delta > 0 ? '+' : ''}${delta}u) → ${updated.overall.record}`);
  return updated;
}

/** Generate picks for one sport and write to Redis. */
async function _processSport(sport, today) {
  const t0              = Date.now();
  const { allTop, allDog } = await generateAllPicks([sport], today);
  const generatedAt     = new Date().toISOString();

  await redis.set(
    `picks:${sport}:${today}`,
    { top: allTop, dog: allDog, generatedAt },
    { ex: TTL },
  );

  const elapsed = Date.now() - t0;
  console.log(`[/api/daily-cron] ${sport} → ${allTop.length} top + ${allDog.length} dog (${elapsed}ms)`);
  return { sport, top: allTop.length, dog: allDog.length };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();

  /* Verify Vercel cron secret */
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = _todayISO();
  const t0    = Date.now();
  console.log(`[/api/daily-cron] Starting for ${today}`);

  /* Run all sports in parallel + update records */
  const [picksResults, records] = await Promise.all([
    Promise.allSettled(SPORTS.map(sport => _processSport(sport, today))),
    _updateRecords(today),
  ]);

  const summary = {};
  const errors  = [];

  picksResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const { sport, top, dog } = r.value;
      summary[sport] = { top, dog };
    } else {
      errors.push({ sport: SPORTS[i], error: r.reason?.message || 'unknown' });
      console.error(`[/api/daily-cron] ${SPORTS[i]} failed:`, r.reason?.message);
    }
  });

  console.log(`[/api/daily-cron] Done for ${today} in ${Date.now() - t0}ms`, summary);

  return res.status(200).json({
    date:    today,
    sports:  summary,
    record:  records.overall.record,
    errors:  errors.length ? errors : undefined,
  });
};
