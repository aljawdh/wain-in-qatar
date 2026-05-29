# NAVIDUR — Fish Recommendation Engine (Phase A)

> **Status:** Documented baseline aligned with tag `stable-phase-a`.  
> **Do not change scoring/ranking behavior without a new tagged release.**

---

## 1. Purpose

Provide species-level fishing recommendations for a station using unified rows from `data/gulf_fish_database.json` (SSOT for species attributes and scoring profiles).

---

## 2. Primary Modules

| Module | Path |
|--------|------|
| Gulf fish database loader | `shared/navidur-fish-database.js` |
| Recommendation engine | `shared/navidur-fish-recommendation-engine.js` |
| Analysis orchestration | `shared/navidur-analysis-engine.js` (`buildFishingDecision`) |
| Public DTO sanitization | `serverless_api/_lib/navidur-public-dto.js` |

---

## 3. Data SSOT

- **File:** `data/gulf_fish_database.json`
- **Loader:** `loadGulfFishDatabaseFromDisk()` / `getUnifiedSpeciesList()`
- **Row shaping:** `unifySpeciesRow()` + `buildScoringProfile()`

> **TODO:** Document required JSON fields per species row and validation rules (if any).

---

## 4. Scoring Pipeline (High Level)

1. Build context from station, environment, tide, Dur, and analysis time.
2. Filter species pool (e.g. by country).
3. Score each species → numeric `final_score`.
4. Drop species below configured minimum threshold.
5. Apply a separate display ordering step (does not change published scores).
6. Return top N recommendations.

Published `score` / `confidence` reflect the scoring result, not the display ordering key.

> **TODO:** Document threshold and top-N defaults in a future schema note (not in this architecture layer).

---

## 5. Ranking Layer (Display Only)

A ranking layer may reorder qualified species for presentation. It must not change API field names or expose internal ranking fields to clients.

> **TODO:** Confirm public DTO fields remain stable across releases (`production-checklist.md`).

---

## 6. Fallback Paths (Order)

1. **Primary:** Gulf DB scoring (`gulf_fish_database` path).
2. If no qualified species: unlock `pickSpeciesActivity` in analysis engine (legacy trait-based list).
3. If Gulf pool empty: deprecated hardcoded profile list (legacy emergency path).

> **TODO:** Confirm production frequency of fallback paths from logs/monitoring.

---

## 7. Separate System: Hotspot / Grid Engine

`serverless_api/fishing-engine.js` serves hotspot/grid analysis and is **not** the Phase A species recommendation path.

> **TODO:** Add sequence diagram showing when UI calls `fishing-engine` vs `analysis`.

---

## 8. Stable Reference

```text
git show stable-phase-a:shared/navidur-fish-recommendation-engine.js
```

---

## 9. Open Questions / TODO

- [ ] Document learning layer hooks (`learning_layer_enabled`) and whether they affect live recommendations today.
- [ ] Document `reason_ar` template rules and forbidden operational text.
- [ ] List deprecated `FISH_PROFILES` retirement criteria.
