'use strict';

const { readJsonFile } = require('./_lib/data-store');
const { requireRole } = require('./_lib/auth');
const { isAllowedOrigin, setNoCache } = require('./_lib/security');

// Success metric thresholds (used to compute health flags in response)
const THRESHOLDS = {
  sessions_per_day:  20,
  analyses_per_day:  10,
  conversion_pct:    60   // station_select → analysis_complete
};

function todayCutoff() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
}

function dayKey(timestamp) {
  const d = new Date(timestamp || '');
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
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

  const tracking = await readJsonFile('tracking', []);

  // ---- Aggregate all-time ----
  const sessions = new Set();
  const stationMap = {};    // station_name → count
  const countryMap = {};    // country → count
  const modeMap = {};       // fishing_mode → count
  let totalAnalyses = 0;
  let totalStationSelects = 0;

  tracking.forEach(function (r) {
    if (r.session_id) sessions.add(r.session_id);
    if (r.event_type === 'analysis_complete') {
      totalAnalyses++;
      const name = String(r.station || '').trim() || String(r.station_id || '').trim() || null;
      if (name) stationMap[name] = (stationMap[name] || 0) + 1;
    }
    if (r.event_type === 'station_select' || r.event_type === 'analysis_complete') {
      if (r.event_type === 'station_select') totalStationSelects++;
    }
    if (r.country) countryMap[r.country] = (countryMap[r.country] || 0) + 1;
    if (r.fishing_mode === 'coastal' || r.fishing_mode === 'deep') {
      modeMap[r.fishing_mode] = (modeMap[r.fishing_mode] || 0) + 1;
    }
  });

  // ---- Daily breakdown ----
  const dailySessions = {};    // date → Set of session_ids
  const dailyAnalyses = {};    // date → count
  const dailyStationSelect = {}; // date → count

  tracking.forEach(function (r) {
    const k = dayKey(r.timestamp);
    if (!k) return;
    if (r.session_id) {
      if (!dailySessions[k]) dailySessions[k] = new Set();
      dailySessions[k].add(r.session_id);
    }
    if (r.event_type === 'analysis_complete') {
      dailyAnalyses[k] = (dailyAnalyses[k] || 0) + 1;
    }
    if (r.event_type === 'station_select') {
      dailyStationSelect[k] = (dailyStationSelect[k] || 0) + 1;
    }
  });

  // Build last-14-days log (with today and health flags)
  const todayMs = todayCutoff();
  const dailyLog = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(todayMs - i * 86400000);
    const k = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
    const daySessions = dailySessions[k] ? dailySessions[k].size : 0;
    const dayAnalyses = dailyAnalyses[k] || 0;
    const dayStSel = dailyStationSelect[k] || 0;
    // conversion: of people who selected a station, how many completed analysis
    const conversionPct = dayStSel > 0
      ? Number(((dayAnalyses / (dayStSel + dayAnalyses)) * 100).toFixed(1))
      : (dayAnalyses > 0 ? 100 : null);
    dailyLog.push({
      date: k,
      sessions: daySessions,
      analysis_complete: dayAnalyses,
      conversion_pct: conversionPct,
      meets_sessions_target:  daySessions  >= THRESHOLDS.sessions_per_day,
      meets_analyses_target:  dayAnalyses  >= THRESHOLDS.analyses_per_day,
      meets_conversion_target: conversionPct !== null ? conversionPct >= THRESHOLDS.conversion_pct : null
    });
  }

  // ---- Top 5 stations ----
  const top5Stations = Object.entries(stationMap)
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function (p) {
      return {
        station: p[0],
        count: p[1],
        share_pct: totalAnalyses > 0 ? Number(((p[1] / totalAnalyses) * 100).toFixed(1)) : 0
      };
    });

  // ---- Country distribution ----
  const countryTotal = Object.values(countryMap).reduce(function (a, b) { return a + b; }, 0);
  const countryDist = Object.entries(countryMap)
    .sort(function (a, b) { return b[1] - a[1]; })
    .map(function (p) {
      return {
        country: p[0],
        count: p[1],
        share_pct: countryTotal > 0 ? Number(((p[1] / countryTotal) * 100).toFixed(1)) : 0
      };
    });

  // ---- Fishing mode split ----
  const modeTotal = Object.values(modeMap).reduce(function (a, b) { return a + b; }, 0);
  const modeSplit = Object.entries(modeMap)
    .sort(function (a, b) { return b[1] - a[1]; })
    .map(function (p) {
      return {
        mode: p[0],
        count: p[1],
        share_pct: modeTotal > 0 ? Number(((p[1] / modeTotal) * 100).toFixed(1)) : 0
      };
    });

  // ---- Overall conversion (all-time) ----
  const overallConversionPct = (totalStationSelects + totalAnalyses) > 0
    ? Number(((totalAnalyses / (totalStationSelects + totalAnalyses)) * 100).toFixed(1))
    : null;

  return res.status(200).json({
    ok: true,
    generated_at: new Date().toISOString(),
    totals: {
      sessions: sessions.size,
      analysis_complete: totalAnalyses,
      conversion_pct: overallConversionPct
    },
    success_thresholds: {
      sessions_per_day:  THRESHOLDS.sessions_per_day,
      analyses_per_day:  THRESHOLDS.analyses_per_day,
      conversion_pct:    THRESHOLDS.conversion_pct
    },
    top_5_stations: top5Stations,
    country_distribution: countryDist,
    fishing_mode_split: modeSplit,
    daily_log: dailyLog
  });
};
