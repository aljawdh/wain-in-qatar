# NAVIDUR — Staging Environment

> **Status:** Architecture safety document (non-production).  
> **Scope:** Process and discipline — not a live staging URL unless operators provision one.

---

## 1. Purpose of Staging

Staging exists to **validate candidate behavior** before it reaches production users. It is a controlled layer where:

- Analysis responses can be exercised with real or fixture inputs.
- Outputs can be compared to approved baselines without mutating production KV.
- Operators can reject a release before `vercel --prod`.

Staging is **optional infrastructure** — the repository supports local compare-mode and documentation-first workflows even when no dedicated staging host exists.

> **TODO:** Record official staging URL (if any) in team ops wiki — not in this repo.

---

## 2. Dev vs Staging vs Production

| Layer | Typical use | Data | Risk |
|-------|-------------|------|------|
| **Development** | Engineer machine; `data/*.json` read directly when KV absent | Local seeds, optional `.env.local` | Low (isolated) |
| **Staging** | Preview deploy or dedicated Vercel env; read-only or isolated KV | Copy/sandbox KV or bundled seeds | Medium (must not point at prod KV for writes) |
| **Production** | https://navidur.app | Production KV + bundled deploy artifact | High |

**Rules:**

- Never use production KV credentials for destructive experiments.
- Staging must not be the only place golden baselines are captured without version control.
- Production deploys follow `safe-rollout-workflow.md` and `production-checklist.md`.

---

## 3. Compare-Mode Philosophy

Compare-mode means running **two paths on the same inputs** and reviewing diffs only:

| Path | Description |
|------|-------------|
| **Baseline** | Known-good output (golden snapshot or stable tag) |
| **Candidate** | Proposed engine/data build under test |

Compare-mode is:

- **Read-only** toward production state.
- **Diff-first** — humans approve changes; no auto-promote from diff tools.
- **Public-field only** — no internal trait dumps in diff artifacts.

Implementation sketch: `experimental/compare-mode/` (documentation only in this phase).

See also `testing-strategy.md` and `regression-verification.md`.

---

## 4. Safe Rollout Process (Summary)

Full procedure: `safe-rollout-workflow.md`.

```text
Local dev → compare-mode → regression review → staging verify → approval → prod deploy → smoke → monitor
```

Rollback is planned **before** deploy (identify previous tag/deployment/KV backup).

---

## 5. Non-Invasive Testing Rules

| Rule | Rationale |
|------|-----------|
| No production KV writes from tests | Prevents accidental data corruption |
| No scoring tweaks during compare | Compare observes; it does not tune |
| Fixed scenario fixtures | Deterministic diffs (`scripts/tests/scenarios/`) |
| Golden in `scripts/tests/golden/` | Version-controlled approved outputs |
| Candidates in `scripts/tests/candidates/` | Ephemeral or gitignored until reviewed |
| Diffs in `scripts/tests/diffs/` | Human-readable review artifacts |

---

## 6. Rollback-First Mentality

Before any production change, answer:

1. What is the rollback target (tag, deployment ID, KV snapshot)?
2. What triggers rollback (see `regression-verification.md`)?
3. Who approves waivers when diff is intentional?

Deploy proceeds only when rollback is **actionable**, not theoretical.

See `versioning-and-rollbacks.md`.

---

## 7. Relationship to Stable Tags

| Tag | Role in staging/compare |
|-----|-------------------------|
| `stable-phase-a` | Engine baseline reference |
| `stable-phase-a-data` | Reference data baseline |

New capabilities should aim for new stable tags after staging verification — not silent drift on `main`.

---

## 8. Open Questions / TODO

- [ ] Define whether Vercel preview deployments qualify as staging.
- [ ] Define KV sandbox strategy (separate Upstash instance vs read-only prod).
- [ ] Assign owner for golden snapshot refresh per release.
- [ ] Link staging checklist to P0 station list (ops doc).

---

## 9. Related Documents

| Document | Topic |
|----------|--------|
| `safe-rollout-workflow.md` | End-to-end rollout steps |
| `secrets-and-kv.md` | KV bootstrap behavior |
| `production-checklist.md` | Post-deploy smoke |
| `experimental/compare-mode/README.md` | Compare framework skeleton |
