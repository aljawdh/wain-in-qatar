# compare-mode (experimental)

> **NOT connected to production runtime.**  
> **No compare engine is implemented in this phase.**

---

## 1. Future Compare-Engine Concept

A future compare-engine would:

1. Load a **scenario** from `scripts/tests/scenarios/`.
2. Execute **baseline** and **candidate** paths with identical inputs.
3. Extract **public-safe** fields from each response.
4. Emit a **diff artifact** under `scripts/tests/diffs/`.
5. Exit with a review status (pass / investigate / fail) — policy TBD.

The engine must live entirely under `experimental/` until an explicit integration release.

> **TODO:** Choose implementation language and CLI entrypoint name.

---

## 2. Production vs Candidate Comparison

| Aspect | Baseline (production-aligned) | Candidate |
|--------|----------------------------|-----------|
| Source | Golden file or checkout at stable tag | Local branch / preview build |
| Endpoint | Staging or authorized read-only prod smoke | Staging or local server |
| Purpose | Represent accepted behavior | Propose change |

**Never** label a candidate run as “production truth” until deployed and verified.

---

## 3. Shadow Execution

**Shadow** means:

- Candidate logic runs **beside** production, not **instead of** it.
- Users still receive production responses.
- Compare runs offline or against staging/preview only.

No shadow hooks may be added to `api/index.js` or live handlers without a reviewed integration PR.

---

## 4. Regression Validation

Compare-mode feeds regression validation:

| Input | Output |
|-------|--------|
| `scripts/tests/scenarios/*.json` | Structured test intent |
| `scripts/tests/golden/` | Expected public snapshot |
| `scripts/tests/candidates/` | Actual candidate capture |
| `scripts/tests/diffs/` | Review packet |

See `docs/architecture/regression-verification.md`.

---

## 5. API-Safe Comparison

Only compare fields intended for clients:

- `fishing.fish_recommendations[]` (selected keys)
- `fishing.species_activity`
- `fishing.confidence_score`
- `public_navidur_summary` (subset)
- `decision` summary fields
- HTTP status

**Exclude:**

- Internal Dur trait arrays
- Non-public ranking keys
- Raw secrets or env-dependent blobs

> **TODO:** Publish JSON schema for comparable subset.

---

## 6. Diff-Only Review Philosophy

| Principle | Meaning |
|-----------|---------|
| Diff does not deploy | Passing compare is necessary, not sufficient |
| Humans classify | `ok` / `expected_change` / `regression` / `unknown` |
| Waivers are explicit | Documented in release notes |
| No auto-merge on green | Policy may come later |

Compare-mode **informs**; operators **decide**.

---

## 7. Folder Boundaries

| Path | Role |
|------|------|
| `experimental/compare-mode/` | Tooling design + future scripts |
| `experimental/` (parent) | General spikes — see parent README |
| `shared/intelligence-v2/` | Future modules — not imported by prod |

---

## 8. Related Documents

- `docs/architecture/staging-environment.md`
- `docs/architecture/safe-rollout-workflow.md`
- `scripts/tests/golden/README.md`
- `scripts/tests/candidates/README.md`
- `scripts/tests/diffs/README.md`
