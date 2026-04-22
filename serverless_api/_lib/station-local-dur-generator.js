'use strict';

const { parseIsoDate, formatIsoDate, addUtcDays } = require('./dur-generation-core');

function normalizeDurNameAr(s) {
  return String(s || '')
    .trim()
    .normalize('NFC');
}

/**
 * @param {string} anchorIso YYYY-MM-DD — calendar day matching the manual anchor (in-cycle)
 * @param {{ anchor_dur_name_ar: string, anchor_day_in_dur: number }} anchorRule
 * @param {{ rules: object[] }} sequenceDoc from dur_sequence_map.json
 * @returns {{ ok: boolean, reason?: string, windows?: object[] }}
 */
function buildFullStationCycleFromInCycleAnchor(anchorIso, anchorRule, sequenceDoc) {
  const rawRules = Array.isArray(sequenceDoc && sequenceDoc.rules) ? sequenceDoc.rules : [];
  const rules = rawRules.slice().sort(function (a, b) {
    return Number(a.sequence_index || 0) - Number(b.sequence_index || 0);
  });
  if (!rules.length) return { ok: false, reason: 'empty_sequence' };

  const targetName = normalizeDurNameAr(anchorRule.anchor_dur_name_ar);
  const anchorIdx = rules.findIndex(function (r) {
    return normalizeDurNameAr(r && r.dur_name_ar) === targetName;
  });
  if (anchorIdx < 0) return { ok: false, reason: 'anchor_dur_not_in_sequence' };

  const dayIn = Number(anchorRule.anchor_day_in_dur);
  const anchorDurDays = Number(rules[anchorIdx].duration_days);
  if (!Number.isFinite(dayIn) || dayIn < 1) return { ok: false, reason: 'invalid_anchor_day' };
  if (!Number.isFinite(anchorDurDays) || anchorDurDays < 1) return { ok: false, reason: 'invalid_duration' };
  if (dayIn > anchorDurDays) return { ok: false, reason: 'anchor_day_out_of_range' };

  const anchorDate = parseIsoDate(anchorIso);
  if (!anchorDate) return { ok: false, reason: 'bad_anchor_date' };

  const anchorDurStart = addUtcDays(anchorDate, -(dayIn - 1));
  const n = rules.length;
  const starts = new Array(n);
  const ends = new Array(n);

  starts[anchorIdx] = anchorDurStart;
  ends[anchorIdx] = addUtcDays(anchorDurStart, anchorDurDays - 1);

  var i;
  for (i = anchorIdx + 1; i < n; i += 1) {
    const dur = Number(rules[i].duration_days);
    if (!Number.isFinite(dur) || dur < 1) return { ok: false, reason: 'invalid_duration_at_' + (rules[i].dur_id || i) };
    starts[i] = addUtcDays(ends[i - 1], 1);
    ends[i] = addUtcDays(starts[i], dur - 1);
  }
  for (i = anchorIdx - 1; i >= 0; i -= 1) {
    const dur = Number(rules[i].duration_days);
    if (!Number.isFinite(dur) || dur < 1) return { ok: false, reason: 'invalid_duration_at_' + (rules[i].dur_id || i) };
    ends[i] = addUtcDays(starts[i + 1], -1);
    starts[i] = addUtcDays(ends[i], -(dur - 1));
  }

  const windows = [];
  for (i = 0; i < n; i += 1) {
    const r = rules[i];
    windows.push({
      dur_id: r.dur_id,
      dur_name_ar: r.dur_name_ar != null ? r.dur_name_ar : null,
      sequence_index: r.sequence_index != null ? r.sequence_index : i + 1,
      start_date: formatIsoDate(starts[i]),
      end_date: formatIsoDate(ends[i]),
      days: Number(r.duration_days),
      source_mode: 'manual_in_cycle_anchor'
    });
  }

  return { ok: true, windows: windows };
}

module.exports = {
  buildFullStationCycleFromInCycleAnchor,
  normalizeDurNameAr
};
