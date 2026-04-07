'use strict';

const { readJsonFile } = require('../_lib/data-store');
const { requireRole } = require('../_lib/auth');
const { isAllowedOrigin, setNoCache } = require('../_lib/security');

function bucketKey(dateIso, mode) {
  const d = new Date(dateIso || Date.now());
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (mode === 'daily') return y + '-' + m + '-' + day;
  if (mode === 'monthly') return y + '-' + m;
  if (mode === 'yearly') return String(y);
  const start = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - dayNum);
  const wy = start.getUTCFullYear();
  const wm = String(start.getUTCMonth() + 1).padStart(2, '0');
  const wd = String(start.getUTCDate()).padStart(2, '0');
  return wy + '-' + wm + '-' + wd;
}

function buildStats(rows, mode) {
  const map = new Map();
  rows.forEach((r) => {
    const key = bucketKey(r.timestamp, mode);
    const x = map.get(key) || { key, total: 0, yes: 0, no: 0 };
    x.total += 1;
    if (String(r.answer || '').toUpperCase() === 'YES') x.yes += 1;
    if (String(r.answer || '').toUpperCase() === 'NO') x.no += 1;
    map.set(key, x);
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function toSortedCountArray(mapObj, keyName) {
  return Array.from(mapObj.entries())
    .map((row) => ({ [keyName]: row[0], count: Number(row[1] || 0) }))
    .sort((a, b) => b.count - a.count);
}

function buildSelectionAnalytics(trackingRows, stations) {
  const stationNameById = new Map((stations || []).map((s) => [String(s.id || ''), String(s.name || '')]));
  const stationCounts = new Map();
  const modeCounts = new Map();
  const countryCounts = new Map();

  (trackingRows || []).forEach((r) => {
    const stationId = String(r.station_id || '').trim();
    const stationName = String(r.station || '').trim();
    const country = String(r.country || '').trim();
    const mode = String(r.fishing_mode || '').trim().toLowerCase();

    const resolvedStationName = stationId
      ? (stationNameById.get(stationId) || stationName || stationId)
      : (stationName || null);

    if (resolvedStationName) {
      stationCounts.set(resolvedStationName, (stationCounts.get(resolvedStationName) || 0) + 1);
    }

    if (mode === 'deep' || mode === 'coastal') {
      modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);
    }

    if (country) {
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
    }
  });

  const stationSelectionCounts = toSortedCountArray(stationCounts, 'station_name');
  const fishingModeDistribution = toSortedCountArray(modeCounts, 'mode');
  const countryUsage = toSortedCountArray(countryCounts, 'country');

  return {
    station_selection_counts: stationSelectionCounts.slice(0, 10),
    fishing_mode_distribution: fishingModeDistribution,
    country_usage: countryUsage.slice(0, 10),
    selection_insights: {
      top_performing: stationSelectionCounts.slice(0, 3),
      low_usage: stationSelectionCounts.slice(-3).reverse()
    }
  };
}

module.exports = async function handler(req, res) {
  setNoCache(res);
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden_domain' });

  const actor = await requireRole('admin')(req, res);
  if (!actor) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const feedback = await readJsonFile('feedback', []);
  const stations = await readJsonFile('stations', []);
  const tracking = await readJsonFile('tracking', []);

  const totalYes = feedback.filter((r) => String(r.answer || '').toUpperCase() === 'YES').length;
  const totalNo = feedback.filter((r) => String(r.answer || '').toUpperCase() === 'NO').length;
  const total = feedback.length;
  const accuracy = total ? Number(((totalYes / total) * 100).toFixed(2)) : 0;

  let scoreHit = 0;
  let scoreTotal = 0;
  feedback.forEach((r) => {
    const score = Number(r.score || 0);
    const yes = String(r.answer || '').toUpperCase() === 'YES';
    const no = String(r.answer || '').toUpperCase() === 'NO';
    if (!yes && !no) return;
    scoreTotal += 1;
    if ((yes && score >= 60) || (no && score < 60)) scoreHit += 1;
  });
  const scoreAccuracy = scoreTotal ? Number(((scoreHit / scoreTotal) * 100).toFixed(2)) : 0;

  const stationMap = new Map();
  feedback.forEach((r) => {
    const key = String(r.station || 'غير محدد');
    const item = stationMap.get(key) || { station: key, total: 0, yes: 0, no: 0 };
    item.total += 1;
    if (String(r.answer || '').toUpperCase() === 'YES') item.yes += 1;
    if (String(r.answer || '').toUpperCase() === 'NO') item.no += 1;
    stationMap.set(key, item);
  });

  const topLocations = Array.from(stationMap.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  const bestStations = Array.from(stationMap.values())
    .map((x) => ({ ...x, accuracy: x.total ? Number(((x.yes / x.total) * 100).toFixed(2)) : 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 10);

  const selectionAnalytics = buildSelectionAnalytics(tracking, stations);

  return res.status(200).json({
    ok: true,
    total_yes: totalYes,
    total_no: totalNo,
    accuracy: accuracy,
    score_accuracy: scoreAccuracy,
    top_locations: topLocations,
    best_stations: bestStations,
    weakest_stations: bestStations.slice().reverse().slice(0, 10),
    daily_stats: buildStats(feedback, 'daily'),
    weekly_stats: buildStats(feedback, 'weekly'),
    monthly_stats: buildStats(feedback, 'monthly'),
    yearly_stats: buildStats(feedback, 'yearly'),
    station_count: stations.length,
    station_selection_counts: selectionAnalytics.station_selection_counts,
    fishing_mode_distribution: selectionAnalytics.fishing_mode_distribution,
    country_usage: selectionAnalytics.country_usage,
    selection_insights: selectionAnalytics.selection_insights
  });
};
