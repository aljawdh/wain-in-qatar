# NAVIDUR Intelligence — Architecture (Phase 2+)

This document describes the current **Intelligence Preview** PoC, why it is constrained, and how full intelligence should evolve without breaking the existing NAVIDUR analysis stack.

---

## A) What is NAVIDUR Intelligence Preview today?

**Intelligence Preview** is an admin-only, read-only HTTP endpoint:

- `GET /api?route=intelligence-preview&station_id={id}` — single station report
- `GET /api?route=intelligence-preview&all=1&limit={1..10}` — batched preview (default `limit=5`, max `10`)

It reuses the live analysis path (`loadReferenceData`, weather/marine inputs, `analyzeLiveStation`) and adds a thin intelligence layer:

- environmental zone classification (`coast`, `shallow`, `island_coast`, `reef_or_rock`, `open_water`, `deep_future`, `unknown`)
- derived scores/labels (marine condition, activity, risk, trends, Gulf traditional signals where applicable)
- historical comparison from existing snapshots (read-only)

Response mode is always `preview_read_only`. No persistence, no cron, no public UI coupling.

---

## B) Why is it read-only?

Preview is intentionally **non-mutating**:

- No writes to Upstash KV or `navidur_store_*` keys
- No validation log append, no hotspot side effects
- No change to `/api?route=analysis` or public pages

This isolates experimentation: admins can validate intelligence shape and latency before any storage or scheduling commitment.

---

## C) Why we do not run all stations inside one HTTP request

A full fleet run (40+ eligible stations) implies:

- sequential or parallel calls to external weather/marine providers per station
- multi-second analysis per station
- risk of serverless timeout (typically 10–60s depending on plan)
- thundering herd on Stormglass and reference loaders

The preview batch endpoint therefore caps work per request:

| Parameter | Behavior |
|-----------|----------|
| `all=1` without `limit` | `applied_limit = 5` |
| `limit` | clamped to `1..10` |
| response | `limited: true`, `requested_limit`, `applied_limit`, explanatory `note` |

Only the first *N* eligible stations (by `sort_order`) are analyzed in that request.

---

## D) Why full intelligence must run via background/cron later

Production-grade intelligence requires:

- **Completeness** — every eligible station, every scheduled hour
- **Reliability** — retries, partial failure isolation, run audit trail
- **Cost control** — rate-limited provider calls, deduplicated fetches
- **Freshness** — `latest` and hourly snapshots without blocking an admin browser

HTTP preview remains a **spot-check tool**; cron/queue workers own fleet-scale computation and KV writes.

---

## E) Preview vs Storage vs Cron vs Dashboard vs Predictive ML

| Layer | Role | Mutates KV? | Audience |
|-------|------|-------------|----------|
| **Intelligence Preview** | On-demand admin spot check; capped batch | No | Admins |
| **Intelligence Storage** | Persist snapshots, latest pointers, daily/region rollups | Yes (dedicated `navidur_intel_*` keys only) | Backend |
| **Intelligence Cron** | Scheduled runner: fetch → analyze → store → anomaly hooks | Yes (via storage layer) | System |
| **Intelligence Dashboard** | Admin UI over stored intel + live preview drill-down | No (reads) | Admins |
| **Predictive ML (later)** | Models on accumulated intel + catches + weather history | Maybe (model artifacts) | System + selective admin views |

Preview proves the **DTO and scoring contract**. Storage and cron operationalize it. Dashboard visualizes stored truth. ML is a later phase after sufficient labeled history.

---

## F) Proposed intelligence layers

1. **Environmental Intelligence** — zone classification, exposure, wind/wave/current context per coordinates.
2. **Traditional Gulf Intelligence** — hamal/fasad, seasonal and lunar cues from approved reference tables (not ad-hoc `durur.json` timing).
3. **Marine Ecosystem Intelligence** — multi-group fish signals (coastal, bottom, pelagic, reef); never single-species lock-in.
4. **Marine Risk Intelligence** — boating, shore, diving, combined risk with explicit reasons.
5. **Historical Intelligence** — deltas vs stored snapshots and daily baselines.
6. **Predictive Intelligence (later)** — forecasts and anomaly scoring after data volume and quality gates are met.

Layers compose into station and regional reports; each layer should degrade gracefully with `unknown` labels when inputs are missing.

---

## G) Future storage key design (not implemented)

Dedicated namespace — **do not reuse or overwrite `navidur_store_*`**.

| Key pattern | Purpose |
|-------------|---------|
| `navidur_intel_snapshot:{station_id}:{date}:{hour}` | Point-in-time intel blob |
| `navidur_intel_latest:{station_id}` | Fast read of newest intel |
| `navidur_intel_daily_report:{date}` | Fleet daily rollup |
| `navidur_intel_region_report:{region}:{date}` | Regional aggregation |
| `navidur_intel_anomalies:{date}` | Detected outliers for review |
| `navidur_intel_run:{id}` | Cron run metadata (status, counts, errors) |

Writers: intelligence cron only. Readers: admin dashboard, internal APIs. Preview endpoint remains read-only and may optionally read `latest` once storage exists.

---

## H) Hard rules

- **Do not touch `navidur_store_*`** — catches, snapshots, validation, and existing indices stay on their current contracts.
- **Do not duplicate drawer logic** — timing and reference station mapping stay in `true_final_station_reference` + `durur_master`; analysis engine remains single source of truth.
- **Do not use `durur.json` for timing** — it is not the operational drawer schedule source.
- **Do not bind the product to one fish species** — intelligence targets groups and zones, not a single commercial species narrative.
- **Geographic scope** — coast, islands, fashat/shallow banks, open water, and deep water (future) are first-class zone targets.
- **ML is later** — only after sustained intel snapshots, catch correlation, and data-quality monitoring justify model training.

---

## Security note (current phase)

`route=intelligence-preview` is **admin-only** (`getAuthUser` + minimum role `admin`). Unauthenticated calls receive HTTP `401` with `{ "ok": false, "error": "admin_auth_required" }`.

---

## Related code (reference)

| Path | Responsibility |
|------|----------------|
| `serverless_api/navidur-intelligence-preview.js` | HTTP handler, auth gate |
| `serverless_api/_lib/navidur-intelligence-preview/` | Preview orchestration, DTO, scoring |
| `shared/navidur-analysis-engine.js` | Core `analyzeLiveStation` (unchanged by preview) |
| `api/index.js` | Route dispatch |

---

*Last updated: PoC hardening phase — preview secured, storage/cron not yet implemented.*
