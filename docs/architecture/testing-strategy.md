# NAVIDUR — Testing Strategy

> **Status:** Phase 2 — strategy only.  
> **Implementation:** See `scripts/tests/README.md` (skeleton).

---

## 1. Goals

1. Detect regressions in **public API shape** before production deploy.
2. Validate **critical stations** under representative marine conditions.
3. Keep tests **deterministic** where possible (fixtures over live weather).
4. Never require production secrets in public CI (use local `data/` or mocked inputs).

---

## 2. Critical Station Testing

Maintain a small set of stations that represent real operational risk:

| Priority | Criterion | Example (documented in ops) |
|----------|-----------|------------------------------|
| P0 | Coastal reef, high traffic | Operator-designated Qatar coastal station |
| P1 | Different country / zone | TODO |
| P1 | Reference-station Dur chain | TODO |

**Per station, record (outside git if needed):**

- Expected analysis HTTP 200
- Expected presence of `fish_recommendations` when fishing is recommended
- Spot-check species names are plausible (manual or snapshot diff)

> **TODO:** Formalize station list with station IDs in `scripts/tests/fixtures/` when tests exist.

---

## 3. Tide Scenarios

Test analysis under distinct tide states when fixtures allow:

| Scenario | Intent |
|----------|--------|
| LOAD (حمل) | Default coastal activity path |
| FASAD (فساد) | Bottom / alternate species behavior |
| Unknown / partial tide | Graceful degradation, no 500 |

**Approach:** Fixed `tideState` + environment fixture in unit/integration tests — not live tide API in CI.

---

## 4. Weather Scenarios

| Scenario | Intent |
|----------|--------|
| Calm sea | Typical recommendation count and scores in range |
| Elevated wave/wind | Decision caution; no crash |
| Missing marine fields | `public_navidur_summary` alert path if applicable |

> **TODO:** Define fixture JSON for environment block per scenario.

---

## 5. Regression Philosophy

1. **Baseline tags** — Compare behavior against `stable-phase-a` / `stable-phase-a-data` when intentional change is unclear.
2. **Snapshot discipline** — Store only stable public fields (species names, scores, summary text patterns), not full internal DTOs.
3. **Fail on shape** — New keys on public recommendation objects require explicit approval.
4. **Fail on status** — Analysis route must not return 5xx for P0 stations under fixtures.

---

## 6. Compare-Mode Philosophy

Compare-mode means running **candidate logic or data side-by-side with production baseline** without serving candidates to users.

| Rule | Description |
|------|-------------|
| Isolation | Candidate code lives under `experimental/` or `shared/intelligence-v2/` (not wired to `api/index.js`) |
| Same inputs | Use identical station_id, date, and environment fixture |
| Diff output | Report differences in recommendations, scores, or ordering — do not auto-approve |
| No production write | Compare scripts must not call production KV write APIs |

> **TODO:** Add a CLI compare script in `experimental/` when needed.

---

## 7. Production Safety Testing

**Never** run destructive tests against production:

- No load tests on `navidur.app` without approval.
- No mass KV overwrites from development machines without runbook.
- Smoke tests after deploy only: read-only analysis POST, checklist in `production-checklist.md`.

Preview deployments (if used) should run the same checklist before promoting to production.

---

## 8. Test Layers (Future)

| Layer | Location (planned) | Scope |
|-------|-------------------|--------|
| Unit | `scripts/tests/unit/` | Database loader, pure helpers |
| Integration | `scripts/tests/integration/` | `analyzeLiveStation` with fixtures |
| Regression | `scripts/tests/regression/` | P0 station snapshots |
| Manual | Operator scripts | Pre-release spot checks |

---

## 9. Related Documents

- `scripts/tests/README.md`
- `production-checklist.md`
- `runtime-safety-rules.md`
- `fish-engine.md`
