'use strict';

/**
 * Batch-only generator: updates `dur_windows` from `dur_sequence_map` + `star_events`.
 * No public surface. Run: `node serverless_api/dur-generator.js` (local) or require `runDurGeneration`.
 */

const { readJsonFile, writeJsonFile, nowIso } = require('./_lib/data-store');
const { buildWindowsFromAnchor } = require('./_lib/dur-generation-core');

const DEFAULT_STAR = 'suhail';

/**
 * @param {{ year?: number, dryRun?: boolean }} options
 */
async function runDurGeneration(options) {
  options = options || {};
  const defaultYear = new Date().getUTCFullYear();
  const targetYear = options.year != null ? Number(options.year) : defaultYear;

  const sequenceDoc = await readJsonFile('dur_sequence_map', { version: 0, rules: [] });
  const starDoc = await readJsonFile('star_events', { version: 0, events: [] });
  const outDoc = await readJsonFile('dur_windows', { version: 0, bands: {} });
  const auditDoc = await readJsonFile('dur_generation_audit', { version: 0, runs: [] });

  const rules = Array.isArray(sequenceDoc.rules) ? sequenceDoc.rules : [];
  const events = Array.isArray(starDoc.events) ? starDoc.events : [];
  const defaultStar = String(starDoc.star_key_default || starDoc.default_star || DEFAULT_STAR).toLowerCase();

  const hasAllOffsets = rules.length > 0 && rules.every(function (r) {
    return r && r.offset_days_from_anchor != null && r.duration_days != null;
  });

  var bandsGenerated = [];
  var bandsSkipped = [];

  /** @type {Record<string, object>} */
  var bandsOut = {};

  var existingBands = outDoc.bands && typeof outDoc.bands === 'object' ? outDoc.bands : {};

  Object.keys(existingBands).forEach(function (bk) {
    bandsOut[bk] = JSON.parse(JSON.stringify(existingBands[bk]));
  });

  if (!rules.length || !hasAllOffsets) {
    bandsSkipped.push({
      scope: 'sequence_map',
      reason: rules.length ? 'null_offsets_in_rules' : 'empty_rules'
    });
  } else {
    /** @type {Map<string, { anchor_date: string, verified: boolean, source: string }>} */
    var anchorMap = new Map();

    events.forEach(function (ev) {
      if (!ev || !ev.latitude_band_key || !ev.event_date) return;
      var sk = String(ev.star_key || defaultStar).toLowerCase();
      if (sk !== DEFAULT_STAR) return;
      var y = ev.year != null ? Number(ev.year) : targetYear;
      if (!Number.isFinite(y)) return;
      var key = String(ev.latitude_band_key).trim() + '|' + String(y);
      anchorMap.set(key, {
        anchor_date: String(ev.event_date).trim(),
        verified: !!ev.is_verified,
        source: String(ev.source || 'unspecified')
      });
    });

    anchorMap.forEach(function (meta, key) {
      var parts = key.split('|');
      var bandKey = parts[0];
      var yearStr = parts[1];
      var built = buildWindowsFromAnchor(meta.anchor_date, rules);
      if (!built.ok) {
        bandsSkipped.push({
          latitude_band_key: bandKey,
          year: Number(yearStr),
          reason: built.reason || 'build_failed'
        });
        if (!bandsOut[bandKey]) {
          bandsOut[bandKey] = { latitude_band_key: bandKey, incomplete: true, skip_reason: built.reason };
        }
        return;
      }

      if (!bandsOut[bandKey]) {
        bandsOut[bandKey] = {
          latitude_band_key: bandKey,
          incomplete: false,
          years: {}
        };
      }
      var bandPayload = bandsOut[bandKey];
      if (!bandPayload.years || typeof bandPayload.years !== 'object') bandPayload.years = {};
      bandPayload.incomplete = false;
      bandPayload.years[yearStr] = {
        anchor_date: meta.anchor_date,
        anchor_verified: meta.verified,
        anchor_source: meta.source,
        windows: built.windows,
        generated_at: nowIso()
      };
      bandsGenerated.push({ latitude_band_key: bandKey, year: Number(yearStr) });
    });

    if (!bandsGenerated.length) {
      bandsSkipped.push({
        scope: 'star_events',
        reason: 'no_usable_suhail_event_date_rows'
      });
    }
  }

  var globalIncomplete =
    bandsSkipped.some(function (s) {
      return s.scope === 'sequence_map';
    }) || !bandsGenerated.length;

  var nextDurWindows = Object.assign({}, outDoc, {
    version: typeof outDoc.version === 'number' ? outDoc.version : 1,
    incomplete: globalIncomplete,
    incomplete_reason: globalIncomplete ? 'missing_sequence_offsets_or_star_anchors' : null,
    message_ar: globalIncomplete
      ? 'لم يُولَّد أي نافذة كاملة — أكمل الخريطة الزمنية والمراسي ثم أعد التشغيل.'
      : 'تم توليد نوافذ لخطوط عرض ذات مرسى سهيل مُعرّف.',
    generated_at: nowIso(),
    bands: bandsOut
  });

  var runEntry = {
    id: 'gen_' + Date.now().toString(36),
    started_at: nowIso(),
    default_year_hint: targetYear,
    bands_generated_ok: bandsGenerated.length,
    bands_generated: bandsGenerated,
    bands_skipped: bandsSkipped,
    dry_run: !!options.dryRun
  };

  runEntry.finished_at = nowIso();

  var nextAudit = Object.assign({}, auditDoc, {
    version: typeof auditDoc.version === 'number' ? auditDoc.version : 1,
    runs: Array.isArray(auditDoc.runs) ? auditDoc.runs.concat([runEntry]).slice(-50) : [runEntry]
  });

  if (!options.dryRun) {
    await writeJsonFile('dur_windows', nextDurWindows);
    await writeJsonFile('dur_generation_audit', nextAudit);
  }

  return {
    ok: true,
    dur_windows: nextDurWindows,
    audit: runEntry
  };
}

/**
 * HTTP entry (optional): POST with admin JWT — not wired by default.
 */
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const result = await runDurGeneration({ dryRun: false });
    return res.status(200).json({ ok: true, audit: result.audit });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : 'dur_generation_failed' });
  }
}

if (require.main === module) {
  runDurGeneration({})
    .then(function (r) {
      console.log(JSON.stringify(r.audit, null, 2));
      process.exit(0);
    })
    .catch(function (e) {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { runDurGeneration, handler };
