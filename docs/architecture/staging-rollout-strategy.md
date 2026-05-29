# NAVIDUR — Staging Rollout Strategy

> **Status:** Phase 3 operational strategy — no deployment config changes.**

---

## 1. Dev vs Staging vs Production

| Environment | Purpose | Data risk |
|-------------|---------|-----------|
| **Development** | Feature work; isolated modules under `experimental/` | Low — local `data/` or dev KV |
| **Staging** | Validate candidate before prod; compare-mode runs | Medium — must not corrupt prod KV |
| **Production** | https://navidur.app — user traffic | High |

**Principle:** Staging proves the release; production trusts only after checklist + approval.

> **TODO:** Record official staging hostname and KV instance (ops wiki).

---

## 2. Safe Deployment Order

Recommended sequence for releases that affect analysis or fish data:

| Order | Layer | Action |
|-------|--------|--------|
| 1 | Documentation / scenarios | Update scenario placeholders if inputs change |
| 2 | Code (engine) | Merge to `main` after compare + regression pass |
| 3 | Bundled `data/*.json` | Deploy with API bundle |
| 4 | KV reference data | Operator sync **after** deploy if keys changed |
| 5 | Golden snapshots | Refresh at new stable tag after prod smoke |

**Never** sync production KV before understanding bundled JSON changes (`secrets-and-kv.md`).

Split releases when possible:

- Engine-only → tag `stable-phase-a-*`
- Data-only → tag `stable-phase-a-data-*`

---

## 3. Regression Validation Sequence

Before staging or production:

1. Run scenarios against **candidate** (local/preview).
2. Diff vs **golden** (`scripts/tests/diffs/`).
3. Complete `regression-verification.md`.
4. Staging smoke on P0 stations.
5. Production approval gate.

Staging does not replace regression — it adds environment realism (KV, network, cold start).

---

## 4. Rollback Checkpoints

| Checkpoint | When | Record |
|------------|------|--------|
| CP-0 | Before deploy starts | Current prod deployment ID, git SHA |
| CP-1 | After staging pass | Staging deployment ID (if used) |
| CP-2 | Immediately post-prod deploy | New deployment ID |
| CP-3 | After smoke fail | Rollback target = CP-0 |

Rollback execution: `versioning-and-rollbacks.md` and `safe-rollout-workflow.md`.

---

## 5. KV Synchronization Precautions

Production uses Upstash for many `readJsonFile` keys. Bundled JSON deploy **does not** auto-update KV.

| Precaution | Rationale |
|------------|-----------|
| Backup before write | Restore path for data rollback |
| Write only approved keys | Avoid wiping unrelated stores |
| Verify version field after sync | e.g. `gulf_fish_database.version` |
| Re-run analysis smoke | Confirm species pool changed as expected |
| Never test sync against prod from unreviewed scripts | Use operator runbook |

> **TODO:** Publish approved KV refresh runbook outside public repo.

---

## 6. Production Freeze Rules

During incident or high-risk window:

| Rule | Detail |
|------|--------|
| Freeze | No prod deploys except hotfix with two approvers |
| Compare still allowed | Against staging/local only |
| Data freeze | No KV writes without incident commander approval |
| Tag discipline | No moving stable tags until smoke passes |

**Hotfix exception:** Minimal diff, immediate smoke, postmortem required.

---

## 7. Related Documents

| Document | Role |
|----------|--------|
| `staging-environment.md` | Staging concepts |
| `safe-rollout-workflow.md` | Step-by-step workflow |
| `compare-mode-design.md` | Compare philosophy |
| `production-checklist.md` | Post-deploy smoke |
| `deployment.md` | Vercel platform facts |
