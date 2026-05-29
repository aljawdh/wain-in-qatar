# NAVIDUR — System Overview

> **Status:** Architecture documentation (Phase 1–2).  
> **Purpose:** High-level system shape only — not an implementation spec.  
> **Stable tags:** `stable-phase-a` (engine), `stable-phase-a-data` (fish database). See `versioning-and-rollbacks.md`.

---

## 1. What NAVIDUR Is

NAVIDUR is a marine decision-support application focused on Gulf stations, seasonal “Dur” periods, live environment inputs, and fishing recommendations.

- **Production URL:** https://navidur.app  
- **Repository:** `wain-in-qatar` (monorepo-style layout: static UI + serverless API)

---

## 2. Major Layers

| Layer | Location (indicative) | Role |
|--------|------------------------|------|
| Public UI | `public/`, `index.html`, `main.js` | Station selection, analysis display |
| Admin UI | `admin.html`, `admin.js` | Operations, monitoring, reference data |
| Field UI | `field/index.html` | Field session capture |
| API router | `api/index.js` | Single Vercel function; routes via `?route=` |
| Serverless handlers | `serverless_api/` | Per-route handlers |
| Shared engines | `shared/` | Analysis, fish recommendations, validation |
| Reference data | `data/*.json` | Bundled seeds; some keys mirrored in KV on Vercel |
| Runtime persistence | `serverless_api/_lib/data-store.js` | Upstash Redis when configured |

---

## 3. Core Runtime Paths (Public)

### 3.1 Live station analysis

```
Client → POST /api?route=analysis
      → serverless_api/navidur-analysis.js
      → shared/navidur-analysis-engine.js (analyzeLiveStation)
      → shared/navidur-fish-recommendation-engine.js (getGulfFishRecommendations)
      → serverless_api/_lib/navidur-public-dto.js (sanitizePublicNavidurDto)
```

### 3.2 Fishing engine (hotspots / grid — separate from species list)

```
Client → /api?route=fishing-engine (or compute-decision)
      → serverless_api/fishing-engine.js
```

> **TODO:** Document exact client call sites in `main.js` / `public/js` and when each path is used.

---

## 4. Reference Data Loading

`serverless_api/_lib/navidur-analysis-runtime.js` loads reference bundles via `readJsonFile` (stations, durur, fish species, **gulf_fish_database**, learning settings, etc.).

> **TODO:** Confirm full list of keys loaded per request and caching behavior inside `loadReferenceData`.

---

## 5. Phase A Baseline (Frozen by Tag)

| Tag | Scope (summary) |
|-----|-----------------|
| `stable-phase-a` | Fish recommendation engine baseline (Gulf DB SSOT path) |
| `stable-phase-a-data` | Gulf fish reference database release |

---

## 6. Explicit Non-Goals (This Document)

- Does not describe future features (learning layer, genome review UI, etc.) in detail.
- Does not replace `docs/NAVIDUR-Engineering-Audit-2026-05-18.md` (engineering audit).

---

## 7. Related Architecture Docs (Phase 2)

| Document | Topic |
|----------|--------|
| `fish-engine.md` | Fish recommendation path |
| `data-flow.md` | Request/data flow |
| `deployment.md` | Vercel platform |
| `secrets-and-kv.md` | Persistence |
| `versioning-and-rollbacks.md` | Tags and rollback |
| `testing-strategy.md` | Verification approach |
| `runtime-safety-rules.md` | Change discipline |
| `production-checklist.md` | Post-deploy checklist |
| `regression-verification.md` | Pre-deploy regression workflow |

---

## 8. Open Questions / TODO

- [ ] Document authentication model for admin vs public routes.
- [ ] Document intelligence-preview vs production analysis boundaries.
- [ ] Map all cron jobs and their side effects.
- [ ] Document station KV vs bundled `data/stations.json` resolution order.
