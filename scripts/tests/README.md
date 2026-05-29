# NAVIDUR — Testing Infrastructure (Skeleton)

> **Status:** Phase 1–2 — philosophy and structure only.  
> **Strategy:** See `docs/architecture/testing-strategy.md`.  
> **No automated test suite is required in this phase.**

---

## 1. Testing Philosophy

1. **Protect production behavior first** — regression tests for public API shape and stable stations before refactors.
2. **Separate concerns** — unit tests for pure engines (`shared/`), integration tests for `POST /api?route=analysis`, data tests for `gulf_fish_database.json`.
3. **Deterministic inputs** — fixed environment/tide/Dur fixtures; avoid live weather in CI when possible.
4. **Tags as baselines** — compare against `stable-phase-a` and `stable-phase-a-data` when validating intentional changes.
5. **KV awareness** — local tests read `data/`; production parity may require explicit KV seed/sync steps (documented, not automated here).

---

## 2. Critical Stations

| Station ID | Name | Why critical |
|--------------|------|----------------|
| `st_mpbxjqft2xgor1ew` | كتارا | Phase A / A-Data validation; coastal reef; Qatar |
| TODO | TODO | Add primary reference stations from `true_final_station_reference` |
| TODO | TODO | Add offshore vs coastal contrast station |

> **TODO:** Fill station list from operations team and FIELD review coverage.

---

## 3. Important Marine Scenarios

| Scenario | Tide | Notes |
|----------|------|--------|
| Coastal reef / LOAD | `LOAD` | Katara default scenario used in Phase A tuning |
| Coastal reef / FASAD | `FASAD` | TODO: expected species shift |
| High wave / wind | — | TODO: thresholds from live environment |
| Missing marine data | — | `no_marine_data_for_date` public summary path |
| Min score boundary | `minScore: 60` | Species just above/below qualification |
| Ranking diversity | — | No duplicate Safi in Top 8; no cephalopod/scorpion in general Top 8 |
| Fallback path | Empty Gulf pool | Deprecated `FISH_PROFILES` — should remain rare |

> **TODO:** Add seasonal Dur windows (e.g. الشرطين) with expected trait bundles.

---

## 4. Directory Structure

```text
scripts/tests/
  README.md                 ← this file
  baselines/                ← golden snapshot philosophy (see baselines/README.md)
  scenarios/                ← placeholder scenario JSON (no runner yet)
  golden/                   ← approved baseline captures (empty until ops capture)
  candidates/               ← candidate run outputs (working copies)
  diffs/                    ← review artifacts (expected vs actual)
  results/                  ← legacy/alternate output area (see results/README.md)
  fixtures/                 ← TODO: shared environment fixtures
  unit/                     ← TODO: fish engine, database loader
  integration/              ← TODO: analysis route, public DTO shape
```

**Not in scope yet:**

- Playwright / E2E UI tests
- Load tests
- KV mutation tests against production

---

## 5. Existing Ad-Hoc Scripts (Reference)

Some verification scripts may exist at repo root `scripts/` (e.g. Phase A reports). These are **operator tools**, not CI tests.

> **TODO:** Inventory `scripts/test-*.js` and classify (keep / move / document).

---

## 6. Definition of Done (Future Test Phase)

- [ ] `node scripts/tests/unit/...` runs in CI without secrets
- [ ] Katara regression asserts API keys, no `display_rank_score`, Safi dedupe
- [ ] Gulf DB schema validation (65+ species, required fields)
- [ ] Document KV sync smoke step for data-only releases

---

## 7. Open Questions

- [ ] Choose test runner (Node assert only vs. a minimal framework).
- [ ] Whether to snapshot full DTOs or only `fishing.fish_recommendations` + summary fields.
