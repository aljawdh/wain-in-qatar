# NAVIDUR — Monitoring and seasonal validation

## Authoritative definitions and scope

- The existing `durur_master` reference loaded by `loadReferenceData()` is the source of the heritage DUR names and traits. The seasonal framework is a monitoring mirror; it must not rewrite the master definitions.
- The default framework generated from `durur_master` initializes `expected_range` to `{}`. A trait without an explicit, non-empty range is unsupported for seasonal scoring. Arabic word overlap is not a verification rule.
- The framework range matcher only produces a match or a confirmed mismatch when all fields required by the range are present and the input is explicitly marked `measurement_kind: observation`. Partial matching is not inferred from text. Conflicting source pairs, unsupported rules, and insufficient observations are excluded from the score denominator.
- The daily snapshot validator retains its existing explicit numeric thresholds for temperature, wind, waves, current, and tide state. `جو حار وجاف` is not treated as supported because the current rule only checks temperature and has no defensible humidity condition. As with seasonal scoring, the daily validator requires explicit observation provenance.
- The current Open-Meteo monitoring path does not set `measurement_kind`; the dashboard therefore identifies that field as unspecified, and the normal monitoring path reports insufficient evidence instead of a verification score. Provider values must not be presented as field observations or trusted labels without that metadata.

## Results and score semantics

- `matched` and `failed` are reserved for rule-backed, explicitly observed, sufficiently complete evidence.
- Missing/unclassified measurement provenance is `insufficient_evidence`; a missing value is never a confirmed mismatch.
- Traits without a usable rule are listed in `unsupported_traits`. Conflicting source values are listed separately. Neither group is scored.
- `trait_match_score` is `null` when the evaluable denominator is zero. Otherwise it is the matched count divided by matched plus confirmed mismatches. Responses include evaluable count, total trait count, and coverage.
- Historical summaries do not count insufficient/no-reference runs as successes or failures and do not replace unavailable scores with zero.

## Dashboard and history

- `/admin/monitoring` remains the existing dashboard. Its saved-record search sends date/time, month/year, station, region, trait, data-category, status, and page filters to the existing `station-snapshots` admin route.
- The daily panel shows provider values and available provenance. Historical snapshots created before provenance fields existed cannot identify provider observation time, measurement kind, or freshness; the evidence reader deliberately reports these as unknown.
- Same-calendar-day comparisons are built from retained entries for the selected station and DUR. Years without a matching retained record are shown as missing; years are discovered from history rather than hard-coded.
- New seasonal entries are stored as individual `navidur_seasonal_validation:<validation_id>` records and indexed newest-first in `navidur_seasonal_validation_index`. Snapshot and validation records also remain individual keys; their indexes are no longer trimmed to a fixed number of IDs. Indexed reads fetch bounded batches and the existing admin routes expose continuation cursors, with offsets retained for compatibility.
- `navidur_seasonal_validation_history` remains readable as the legacy JSON document. New seasonal writes do not rewrite or migrate it; the legacy entries are served after indexed entries in pages. The legacy document had a 2,500-entry application cap, so entries already removed by earlier writes cannot be recovered by this change.
- The legacy single-document append fallback retains its 2,500-entry cap because rewriting a growing JSON value is not a safe unbounded persistence strategy. The production seasonal-validation route uses the indexed-record path.
- On Upstash, index trimming previously removed IDs only: snapshot and validation record keys were not deleted. Those orphaned records are undiscoverable through historical pagination; a direct ID lookup can still read one if its ID is already known. In local JSON mode, the previous append helper also sliced the file arrays, so entries beyond those limits were physically removed from the local files. This implementation does not scan or rewrite production data to recover records lost or orphaned before the change.
- Repeated seasonal runs with identical rule, evidence, and outcome are deduplicated across both the legacy document and indexed records. Changed evidence is stored as a revision that links to its predecessor; corrections do not automatically recompute historical framework learning aggregates.
- The Upstash design uses one `SET` for each record followed by `LPUSH` for its index ID; these are separate REST operations, not a transaction. A failure between them can leave an unindexed record. Removing application-level count trimming does not remove Upstash plan storage quotas, request/command limits, per-value limits, service availability constraints, or the possibility of operator deletion. It is not a guarantee of unlimited or permanent durability.
- Local development still uses JSON files rather than the Upstash indexed-record path. Those files are read and rewritten as whole documents and grow without a record-count cap; they are suitable for local development, not unbounded history volumes. Vercel writes still require configured `KV_REST_API_URL` and `KV_REST_API_TOKEN`; bundled seed files are not durable storage.
- The raw snapshot and validation-log admin routes now page through indexed history. Separate aggregate/review paths still use their existing 20,000-record analysis window; this is a reporting limit, not a deletion or retention limit, and those paths can omit older evidence from their aggregate results.

## Intelligence and accuracy limitations

- Existing intelligence-memory snapshots are generated by the current preview workflow and stored by station/date/hour. The memory indices are bounded (up to 744 station entries and 500 daily entries). The field-log insight engine is analysis for administrative review; it does not automatically train a forecasting model.
- The seasonal framework may accumulate evidence from evaluable observations, but this is not multi-year model training, and unverified forecasts are not ground truth. Temporally held-out evaluation and model-version comparisons are not currently established by this workflow.
- The local seed files inspected for this change contain no station snapshots, daily validation logs, or seasonal-history entries. The reference seed contains 28 DUR records and the station seed 36 stations. Production Upstash data was not queried or written.
- No trusted independent labels, measurement provenance, or sufficient retained historical sample were available to establish verification accuracy or marine forecast accuracy. A 99% objective has not been independently demonstrated and is not guaranteed.
