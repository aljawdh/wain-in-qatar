'use strict';

const { readJsonFile, writeJsonFile, getDurValidationLogs } = require('./data-store');

const MAX_VALIDATION_SCAN = 20000;

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const out = [];
  toArray(values).forEach((value) => {
    const clean = normalizeString(value);
    if (clean && !out.includes(clean)) out.push(clean);
  });
  return out;
}

function toRate(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function normalizeValidationRecord(record) {
  const item = record || {};
  return {
    dur_id: normalizeString(item.dur_id),
    dur_name: normalizeString(item.dur_name),
    phase_id: normalizeString(item.phase_id || item.active_phase_id) || null,
    station_id: normalizeString(item.station_id),
    validation_score: toNumber(item.validation_score),
    validation_status: normalizeString(item.validation_status) || 'needs_review',
    matched_traits: uniqueStrings(item.matched_traits),
    failed_traits: uniqueStrings(item.failed_traits),
    extra_traits: uniqueStrings(item.extra_traits),
    timestamp: normalizeString(item.timestamp)
  };
}

function sortTraitCounts(map) {
  return Object.keys(map).sort((a, b) => {
    if (map[b] !== map[a]) return map[b] - map[a];
    return a.localeCompare(b, 'ar');
  });
}

function collectTopTraits(records, key) {
  const counts = {};
  records.forEach((record) => {
    uniqueStrings(record && record[key]).forEach((trait) => {
      counts[trait] = (counts[trait] || 0) + 1;
    });
  });
  return sortTraitCounts(counts).slice(0, 3);
}

function buildSummary(records, durId, phaseId, durName) {
  const rows = toArray(records);
  const totalRuns = rows.length;
  const successCount = rows.filter((item) => item.validation_status === 'matched').length;
  const partialCount = rows.filter((item) => item.validation_status === 'partial').length;
  const failureCount = rows.filter((item) => item.validation_status !== 'matched' && item.validation_status !== 'partial').length;
  const latestTimestamp = rows.reduce((latest, item) => {
    if (!item.timestamp) return latest;
    if (!latest) return item.timestamp;
    return item.timestamp > latest ? item.timestamp : latest;
  }, '');
  const avgScore = totalRuns
    ? Number((rows.reduce((sum, item) => sum + toNumber(item.validation_score), 0) / totalRuns).toFixed(1))
    : 0;
  return {
    dur_id: durId,
    dur_name: durName || '',
    phase_id: phaseId || null,
    total_runs: totalRuns,
    avg_score: avgScore,
    success_rate: toRate(successCount, totalRuns),
    partial_rate: toRate(partialCount, totalRuns),
    failure_rate: toRate(failureCount, totalRuns),
    most_failed_traits: collectTopTraits(rows, 'failed_traits'),
    most_extra_traits: collectTopTraits(rows, 'extra_traits'),
    last_updated: latestTimestamp || null
  };
}

function aggregateValidationRecords(records) {
  const normalized = toArray(records)
    .map(normalizeValidationRecord)
    .filter((item) => item.dur_id);
  const byDur = new Map();
  const byDurPhase = new Map();
  normalized.forEach((item) => {
    const durKey = item.dur_id;
    const phaseKey = item.dur_id + '::' + String(item.phase_id || '');
    if (!byDur.has(durKey)) byDur.set(durKey, []);
    if (!byDurPhase.has(phaseKey)) byDurPhase.set(phaseKey, []);
    byDur.get(durKey).push(item);
    if (item.phase_id) byDurPhase.get(phaseKey).push(item);
  });

  const durSummaries = Array.from(byDur.entries()).map(([durId, rows]) => {
    return buildSummary(rows, durId, null, rows[0] && rows[0].dur_name);
  });
  const phaseSummaries = Array.from(byDurPhase.entries()).map(([key, rows]) => {
    if (!rows.length) return null;
    return buildSummary(rows, rows[0].dur_id, rows[0].phase_id, rows[0].dur_name);
  }).filter(Boolean);

  const items = durSummaries.concat(phaseSummaries).sort((a, b) => {
    if (a.dur_id !== b.dur_id) return a.dur_id.localeCompare(b.dur_id, 'ar');
    if (a.phase_id == null && b.phase_id != null) return -1;
    if (a.phase_id != null && b.phase_id == null) return 1;
    return String(a.phase_id || '').localeCompare(String(b.phase_id || ''), 'ar');
  });

  const grouped = durSummaries.map((summary) => {
    return {
      dur_id: summary.dur_id,
      dur_name: summary.dur_name,
      summary: summary,
      phases: phaseSummaries.filter((item) => item.dur_id === summary.dur_id)
    };
  });

  return { items, grouped };
}

function getLatestSummaryTimestamp(items) {
  return toArray(items).reduce((latest, item) => {
    const value = normalizeString(item && item.last_updated);
    if (!value) return latest;
    if (!latest) return value;
    return value > latest ? value : latest;
  }, '');
}

function groupStoredSummaryRows(rows) {
  const items = toArray(rows).map((item) => ({
    dur_id: normalizeString(item.dur_id),
    dur_name: '',
    phase_id: normalizeString(item.phase_id) || null,
    total_runs: toNumber(item.total_runs),
    avg_score: toNumber(item.avg_score),
    success_rate: toNumber(item.success_rate),
    partial_rate: toNumber(item.partial_rate),
    failure_rate: toNumber(item.failure_rate),
    most_failed_traits: uniqueStrings(item.most_failed_traits),
    most_extra_traits: uniqueStrings(item.most_extra_traits),
    last_updated: normalizeString(item.last_updated) || null
  })).filter((item) => item.dur_id);
  const groupedMap = new Map();
  items.forEach((item) => {
    if (!groupedMap.has(item.dur_id)) {
      groupedMap.set(item.dur_id, {
        dur_id: item.dur_id,
        dur_name: '',
        summary: null,
        phases: []
      });
    }
    const entry = groupedMap.get(item.dur_id);
    if (item.phase_id == null) entry.summary = item;
    else entry.phases.push(item);
  });
  return {
    items: items,
    grouped: Array.from(groupedMap.values()).sort((a, b) => a.dur_id.localeCompare(b.dur_id, 'ar'))
  };
}

async function recomputeGlobalSummary() {
  const logs = await getDurValidationLogs({ limit: MAX_VALIDATION_SCAN });
  const aggregated = aggregateValidationRecords(logs);
  const stored = aggregated.items.map((item) => ({
    dur_id: item.dur_id,
    phase_id: item.phase_id || null,
    total_runs: item.total_runs,
    avg_score: item.avg_score,
    success_rate: item.success_rate,
    partial_rate: item.partial_rate,
    failure_rate: item.failure_rate,
    most_failed_traits: item.most_failed_traits,
    most_extra_traits: item.most_extra_traits,
    last_updated: item.last_updated
  }));
  await writeJsonFile('dur_intelligence_summary', stored);
  return aggregated;
}

async function ensureGlobalSummaryFresh() {
  const summaryRows = await readJsonFile('dur_intelligence_summary', []);
  const latestValidation = await getDurValidationLogs({ limit: 1 });
  const latestValidationTimestamp = normalizeString(latestValidation[0] && latestValidation[0].timestamp);
  const latestStoredTimestamp = getLatestSummaryTimestamp(summaryRows);
  if (!summaryRows.length || (latestValidationTimestamp && latestValidationTimestamp > latestStoredTimestamp)) {
    return recomputeGlobalSummary();
  }
  return groupStoredSummaryRows(summaryRows);
}

async function getDurIntelligenceSummary(options) {
  const query = Object.assign({ durId: '', stationId: '' }, options || {});
  if (query.stationId) {
    const filteredLogs = await getDurValidationLogs({
      stationId: query.stationId,
      durId: query.durId || '',
      limit: MAX_VALIDATION_SCAN
    });
    return aggregateValidationRecords(filteredLogs);
  }
  const aggregated = await ensureGlobalSummaryFresh();
  if (!query.durId) return aggregated;
  return {
    items: aggregated.items.filter((item) => item.dur_id === query.durId),
    grouped: aggregated.grouped.filter((item) => item.dur_id === query.durId)
  };
}

module.exports = {
  normalizeValidationRecord,
  aggregateValidationRecords,
  recomputeGlobalSummary,
  getDurIntelligenceSummary
};
