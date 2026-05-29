# NAVIDUR — Regression Verification

> **Status:** Phase 2 — process document.  
> **Companion:** `scripts/tests/` baseline framework (skeleton only).

---

## 1. Purpose

Define **what must be verified before deploy** using regression discipline — without changing production code in this document.

Regression verification supplements `production-checklist.md` (post-deploy smoke). Ideally, **pre-deploy** compare-mode runs catch drift early.

---

## 2. Pre-Deploy Checklist (Regression)

| # | Check | Reference |
|---|--------|-----------|
| 1 | Release scoped and tagged intent clear (engine / data / UI) | `versioning-and-rollbacks.md` |
| 2 | Scenario fixtures updated if station IDs or API body changed | `scripts/tests/scenarios/` |
| 3 | Golden snapshots exist for P0 scenarios OR explicit waiver | `scripts/tests/results/` |
| 4 | Candidate diff reviewed (expected vs actual) | `scripts/tests/results/README.md` |
| 5 | No new public API fields without client approval | `runtime-safety-rules.md` |
| 6 | KV impact assessed for data releases | `secrets-and-kv.md` |

> **TODO:** Automate diff in CI (future).

---

## 3. Fish Recommendation Stability

Verify against golden snapshots (public fields only):

| Check | Pass criteria (policy) |
|-------|------------------------|
| Array present | `fish_recommendations` exists when fishing path active |
| Length bounds | Within min/max recorded in scenario `expected_stability_notes` (after first capture) |
| Score integrity | `score` === `confidence` on sampled items |
| No internal leaks | No `display_rank_score` or similar |
| Diversity policy | Manual spot-check: no unintended duplicate families in Top N (when applicable) |
| Side-catch species | No unexpected cephalopod/scorpion in Top N for coastal P0 (when applicable) |

**Engine vs data releases:**

| Release type | Expectation |
|--------------|-------------|
| Data-only (`stable-phase-a-data`) | Species names/scores may change — update golden with approval |
| Engine-only (`stable-phase-a`) | Smaller drift expected — stricter diff |

> **TODO:** Do not document numeric thresholds here until captured in golden baselines.

---

## 4. API Shape Stability

| Field group | Rule |
|-------------|------|
| Top-level keys | `station`, `environment`, `tide`, `dur`, `fishing`, `decision`, `public_navidur_summary` remain |
| Recommendation item keys | No renames; additive fields need review |
| Removed keys | Treat as breaking |
| Sanitization | Internal traits not exposed on public `dur` |

Diff tool should flag **key added / removed / type changed** before comparing values.

---

## 5. Station Behavior Stability

Per scenario in `scripts/tests/scenarios/`:

| Check | Notes |
|-------|--------|
| Correct station resolved | `station.name_ar` / id matches fixture |
| Country filter | Oman/Bahrain scenarios reflect regional pool |
| Dur block present | High-level presence — not full trait parity |
| Reference resolution | TODO: document when reference-station chain matters |

Station IDs are maintained in scenario files — update scenarios when ops changes P0 list.

---

## 6. Confidence-Score Drift Checks

`fishing.confidence_score` is a single summary metric — treat separately from per-species scores.

| Step | Action |
|------|--------|
| 1 | Record golden `confidence_score` per scenario |
| 2 | Define drift band (TODO: e.g. ±5 points — operator approval required) |
| 3 | Classify drift: environmental input change vs logic change |
| 4 | Block deploy if drift exceeds band without waiver |

Environmental drift: live weather differs from fixture — use **fixed fixture runs** for deterministic CI; live smoke is supplementary.

---

## 7. Regression Approval Workflow

```text
Author → run compare-mode → save candidate under results/
       → diff vs golden
       → classify diffs in ticket
Reviewer → approve / request changes / block
Operator → deploy → production-checklist.md
       → optional: refresh golden for new tag
```

| Outcome | Action |
|---------|--------|
| **Pass** | Proceed to deploy |
| **Pass with waiver** | Document in release notes; schedule golden update |
| **Fail** | No deploy; fix or rollback plan |

---

## 8. Rollback Triggers (Regression Context)

Same as `scripts/tests/results/README.md` — rollback when critical regression triggers fire on preview or immediately post-deploy smoke.

---

## 9. What This Phase Did **Not** Do

- No test runner implemented
- No golden files generated
- No production or KV changes

---

## 10. Related Documents

| Document | Role |
|----------|------|
| `production-checklist.md` | Post-deploy smoke |
| `testing-strategy.md` | Overall test philosophy |
| `versioning-and-rollbacks.md` | Tags and rollback |
| `scripts/tests/baselines/README.md` | Golden snapshot concept |
