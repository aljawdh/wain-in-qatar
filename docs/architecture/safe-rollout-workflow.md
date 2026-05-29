# NAVIDUR — Safe Rollout Workflow

> **Operational procedure for intelligence and data changes.**  
> **Does not modify runtime — documents how humans should release safely.**

---

## Overview

```text
① Local development
      ↓
② Compare-mode validation
      ↓
③ Regression review
      ↓
④ Staging verification
      ↓
⑤ Production approval
      ↓
⑥ Deploy
      ↓
⑦ Post-deploy smoke test
      ↓
⑧ Rollback (if needed)
```

---

## 1. Local Development

| Step | Action |
|------|--------|
| Branch | Work on feature branch from current `main` |
| Isolation | Use `experimental/` or `shared/intelligence-v2/` — not production entrypoints |
| Data | Edit `data/*.json` locally; KV optional via `.env.local` |
| Self-check | Run existing ad-hoc scripts if available — no new prod hooks |

**Exit criteria:** Change builds; author understands scope (engine / data / docs only).

> **TODO:** Standard local analysis command documented in team wiki.

---

## 2. Compare-Mode Validation

| Step | Action |
|------|--------|
| Scenarios | Pick from `scripts/tests/scenarios/` |
| Baseline | Load golden from `scripts/tests/golden/` (or tag checkout) |
| Candidate | Capture to `scripts/tests/candidates/` |
| Diff | Write review to `scripts/tests/diffs/` |

See `experimental/compare-mode/README.md` and `staging-environment.md`.

**Exit criteria:** Diffs classified; no unexplained critical regressions.

---

## 3. Regression Review

| Step | Action |
|------|--------|
| Checklist | Follow `regression-verification.md` |
| Reviewer | Second pair of eyes when possible |
| Waivers | Document intentional diffs in ticket / release notes |

**Exit criteria:** Pass or pass-with-waiver recorded.

---

## 4. Staging Verification

| Step | Action |
|------|--------|
| Deploy | Preview or dedicated staging environment (if available) |
| KV | Use sandbox KV or read-only policy — not prod writes |
| Smoke | Run P0 scenarios against staging URL |
| Compare | Optional second candidate capture from staging |

See `staging-environment.md`.

**Exit criteria:** Staging smoke pass; no 5xx on P0 paths.

> **TODO:** Document staging URL and KV policy when provisioned.

---

## 5. Production Approval

| Step | Action |
|------|--------|
| Snapshot | Record commit hash, prior Vercel deployment |
| Tags | Plan stable tag update if baseline changes |
| Approval | Named approver for engine/data releases |
| KV plan | If `data/*.json` changed, plan KV refresh per `secrets-and-kv.md` |

**Exit criteria:** Written approval to deploy.

---

## 6. Deploy

| Step | Action |
|------|--------|
| Command | Operator runs production deploy (e.g. Vercel) |
| Scope | Only approved commits on `main` |
| KV | Execute KV refresh if part of approved plan |
| No hotfix | No dashboard-only code patches |

**Exit criteria:** Deploy reports success.

---

## 7. Post-Deploy Smoke Test

Complete `production-checklist.md`:

- Analysis 200 for P0 station
- `fish_recommendations` shape stable
- `public_navidur_summary` present
- Spot-check species list if data release

Short observation window on logs/errors.

**Exit criteria:** Checklist signed off.

---

## 8. Rollback Process

Trigger when smoke fails or critical regression detected post-deploy.

| Step | Action |
|------|--------|
| 1 | Stop further deploys |
| 2 | Redeploy previous Vercel deployment or deploy rollback commit |
| 3 | Restore KV from backup if KV was changed |
| 4 | Re-run production checklist |
| 5 | Postmortem ticket |

Details: `versioning-and-rollbacks.md`.

**Exit criteria:** Production restored to last known-good behavior.

---

## 9. After Successful Release

| Step | Action |
|------|--------|
| Tags | Create/update stable tag if baseline changed |
| Golden | Refresh `scripts/tests/golden/` for affected scenarios |
| Docs | Update architecture docs if process changed |

---

## 10. What This Workflow Does Not Cover

- Feature flags (not in scope)
- Automated CI gates (future)
- UI-only releases (adapt checklist as needed)

---

## 11. Related Documents

| Document | Role |
|----------|------|
| `staging-environment.md` | Staging vs prod |
| `regression-verification.md` | Pre-deploy regression |
| `production-checklist.md` | Post-deploy smoke |
| `runtime-safety-rules.md` | Forbidden changes |
| `versioning-and-rollbacks.md` | Tags and rollback |
