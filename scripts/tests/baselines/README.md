# Regression Baselines

> **Status:** Framework skeleton — no baselines captured yet.  
> **Not connected to production runtime.**

---

## 1. Purpose

Regression baselines are **frozen reference outputs** captured from a known-good system state (typically aligned with a stable git tag). They answer:

> “Did this deploy change public behavior in ways we did not intend?”

Baselines are used **before** production deploy, not as live monitoring.

---

## 2. Compare-Before-Deploy Philosophy

| Principle | Meaning |
|-----------|---------|
| Fix inputs | Same `station_id`, date, and scenario fixture every run |
| Diff outputs | Compare public fields only (recommendations, summary, decision labels) |
| Human approval | A diff does not auto-fail CI until policies are defined |
| Tag alignment | Baseline should record which stable tag it was taken against |

**Flow (future):**

1. Run scenario against **candidate** (local or preview).
2. Run same scenario against **baseline** snapshot (stored under `results/` or tagged commit).
3. Review diff → approve or block deploy.

See `docs/architecture/testing-strategy.md` and `docs/architecture/regression-verification.md`.

---

## 3. Non-Invasive Testing Philosophy

| Do | Do not |
|----|--------|
| Read-only `POST /api?route=analysis` smoke against preview/production when authorized | Mass KV writes during tests |
| Store snapshots on disk in `results/` | Mutate `data/*.json` in place during compare |
| Use fixtures in `scenarios/` | Require production secrets in public CI |
| Compare sanitized public JSON | Diff internal trait payloads |

Tests must never change production state.

---

## 4. Production Safety Philosophy

1. **Baselines are observational** — they do not tune scoring or ranking.
2. **No algorithm constants in baselines** — store outputs, not engine source.
3. **Drift is informational first** — operators decide if a change is acceptable.
4. **Rollback ready** — if regression fails, use `docs/architecture/versioning-and-rollbacks.md`.

---

## 5. Golden Snapshot Concept

A **golden snapshot** is a single JSON file per scenario + tag, containing only stable public fields, for example:

- `fishing.fish_recommendations[]` (names and scores)
- `fishing.species_activity`
- `public_navidur_summary` key strings
- `decision.label` (if present)
- HTTP status and timestamp metadata

**Not included in golden snapshots:**

- Internal Dur trait arrays
- `display_rank_score` or other non-public keys
- Secrets, tokens, full environment raw payloads (unless explicitly approved)

### File naming (convention — TODO)

```text
results/<tag>/<scenario-id>-<captured-at-iso>.json
```

Example (placeholder):

```text
results/stable-phase-a-data/katara-normal-TODO.json
```

> **TODO:** Capture first golden snapshot after operator approval.  
> **TODO:** Define diff tool (manual, script, or CI job) in `results/README.md`.

---

## 6. Folder Layout

| Path | Role |
|------|------|
| `../scenarios/` | Input definitions (station, tide, weather context) |
| `./README.md` | This file |
| `../results/` | Captured outputs and diff artifacts |

---

## 7. Related Documents

- `../README.md`
- `../results/README.md`
- `docs/architecture/regression-verification.md`
- `docs/architecture/production-checklist.md`
