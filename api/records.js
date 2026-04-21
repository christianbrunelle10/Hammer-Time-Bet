'use strict';
/**
 * HammerTimeBet — Records API
 * ============================
 * GET /api/records
 *
 * Returns the current season win/loss record from Redis.
 * Written daily by /api/daily-cron after picks generation.
 * Falls back to a hardcoded seed if Redis is empty (first deploy).
 *
 * Cache: 1 h CDN — records only change once per day.
 */

const redis = require('../lib/redis');

/* Last known values — used if Redis has no records yet */
const SEED = {
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const records = (await redis.get('records:current')) || SEED;

  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json(records);
};
