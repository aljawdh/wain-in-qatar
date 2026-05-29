# NAVIDUR — Engineering Governance

> **Status:** Phase 4 — governance and engineering safety only.  
> **Scope:** Human process and authority boundaries. **Not** enforced by runtime code in this phase.  
> **Related:** `runtime-safety-rules.md`, `safe-rollout-workflow.md`, `versioning-and-rollbacks.md`, `ai-modification-policy.md`

---

## 1. Purpose

NAVIDUR serves live marine decision support in production. Engineering governance exists to:

- Prevent accidental regressions in analysis and fish recommendations
- Keep architectural decisions human-owned and documented
- Require explicit approval before production-impacting changes
- Preserve rollback capability when releases go wrong

This document defines **who may change what**, **what requires review**, and **when production must freeze**.

---

## 2. Development Authority Boundaries

| Authority | May decide | May not decide alone |
|-----------|------------|----------------------|
| **Product / operations owner** | Release timing, production freeze, rollback invocation, KV data restore approval | Engine scoring formulas, API contract breaks |
| **Lead engineer / maintainer** | Architecture within documented boundaries, merge to `main`, stable tag creation | Unilateral production KV edits without runbook |
| **Contributor** | Feature branches, docs, experimental spikes | Direct production deploy, routing changes, DTO shape changes |
| **AI assistant** | Drafts, tests, documentation, isolated experimental code | Production merges, architectural direction, autonomous refactors |

**Default rule:** If a change affects what users see at `https://navidur.app` or what `POST /api?route=analysis` returns, it is **not** a casual contribution — it follows the release process in `safe-rollout-workflow.md`.

---

## 3. Architectural Ownership Principles

| Principle | Meaning |
|-----------|---------|
| **Documented paths are sacred** | Core paths in `system-overview.md` are the contract; changes need explicit intent |
| **Single source of truth** | Gulf fish reference data flows from documented SSOT (`data/gulf_fish_database.json` + KV sync rules in `secrets-and-kv.md`) |
| **Isolation before integration** | New intelligence lives in `experimental/` or `shared/intelligence-v2/` until compare + regression pass |
| **Tags mark baselines** | `stable-phase-*` tags are human-verified checkpoints, not decoration |
| **No silent coupling** | Production entrypoints (`api/index.js`, `serverless_api/`) must not import experimental folders without integration review |

Architectural changes (new layers, new persistence models, new public API routes) require a short design note in `docs/architecture/` **before** implementation on `main`.

---

## 4. AI Assistant Usage Policy (Summary)

AI tools are **execution assistants**, not owners of architecture. Full policy: `ai-modification-policy.md`.

| Allowed | Forbidden |
|---------|-----------|
| Docs, tests, scripts under `scripts/tests/` | Autonomous multi-file refactors on production paths |
| Small, scoped edits with human review | Changing scoring, ranking, or DTO without explicit request |
| Explaining and drafting compare-mode artifacts | Connecting `experimental/` to `api/index.js` without PR |
| Local verification commands | Deploy, push, commit, or KV writes unless explicitly requested |

Every AI-assisted production change must be **reviewed by a human** who understands marine/ops impact.

---

## 5. Prohibited Modification Categories

Without the full release process (`safe-rollout-workflow.md` + `production-checklist.md`):

| Category | Examples |
|----------|----------|
| **Scoring / ranking** | `shared/navidur-fish-recommendation-engine.js`, ranking weights, `minScore` defaults |
| **Analysis orchestration** | `shared/navidur-analysis-engine.js`, live station pipeline |
| **Public API contract** | Field renames, removed keys, unsanitized internal fields |
| **Routing / platform** | `api/index.js`, `vercel.json` rewrites, cron definitions |
| **Persistence semantics** | `serverless_api/_lib/data-store.js`, KV key shapes |
| **Production UI behavior** | `main.js`, `index.html`, `public/` user-facing flows |
| **Direct production data surgery** | Ad-hoc Upstash edits, env var changes without record |

Documentation-only phases (architecture, governance) must **not** be used as cover for sneaking runtime changes into the same commit.

---

## 6. Approval Requirements Before Production Changes

Production change = merge to `main` that will be deployed to Vercel **or** operator action on production KV/env.

| Change type | Minimum approval |
|-------------|------------------|
| Docs / governance only | Maintainer review (no deploy required) |
| Reference JSON (`data/*.json`) | Maintainer + regression/compare review; KV sync plan if applicable |
| Shared engines / API | Maintainer + regression verification + staging when available |
| KV restore / migration | Operations owner + documented backup + rollback plan |
| Emergency hotfix | Operations owner verbal approval + post-incident write-up within 48h |

**Checklist gate:** `production-checklist.md` must be completed for any deploy touching analysis or fish data.

---

## 7. Regression Review Requirements

Before production deploy of intelligence or data changes:

1. **Identify scope** — engine, bundled data, KV, UI, or API
2. **Run compare-mode** — golden vs candidate per `compare-mode-design.md` and `regression-verification.md`
3. **Record diffs** — store under `scripts/tests/candidates/` when policy allows (redact PII/tokens)
4. **Station smoke** — at least one known station (e.g. Katara) on preview/staging before prod
5. **Tag update** — new `stable-phase-*` only after prod verification per `versioning-and-rollbacks.md`

Skipping regression review is only acceptable for **pure documentation** commits with zero runtime diff.

---

## 8. Rollback Authority

| Situation | Who may invoke rollback | Mechanism |
|-----------|-------------------------|-----------|
| Bad deploy (code/UI) | Operations owner or maintainer | Vercel redeploy prior deployment or revert commit |
| Bad reference data in bundle | Maintainer | Redeploy known-good commit; verify bundle |
| Bad KV state | Operations owner | Restore from backup per `secrets-and-kv.md` — **not** guesswork |
| Partial incident | Operations owner | Freeze (below) then choose code vs data rollback independently |

**Rollback-first mentality:** When user-facing behavior is wrong, restore last known-good state before experimenting in production. See `versioning-and-rollbacks.md` and `runtime-protection-strategy.md`.

---

## 9. Production Freeze Conditions

Declare a **production freeze** when any of the following apply:

- Active incident affecting recommendations or station analysis for real users
- Unverified KV or reference data state after a failed deploy
- Missing rollback target (no recent stable tag or Vercel deployment ID recorded)
- Compare-mode / regression artifacts missing for a pending intelligence release
- Two or more conflicting changes queued on `main` without staging verification

**During freeze:**

- No merges to `main` except rollback or docs
- No KV edits except documented restore
- No “quick fixes” to scoring or ranking in production paths
- Resume only after root cause note and updated golden/candidate baseline plan

---

## 10. Governance Document Map (Phase 4)

| Document | Topic |
|----------|--------|
| `engineering-governance.md` | This file — authority and approval |
| `ai-modification-policy.md` | Safe AI usage |
| `runtime-protection-strategy.md` | Runtime isolation and compatibility |
| `knowledge-preservation.md` | Marine/tuning/ops knowledge lifecycle |
| `team-scaling-strategy.md` | Lightweight team growth |

---

## 11. Open Questions / TODO

- [ ] Name formal roles (maintainer, ops owner) in repo `CODEOWNERS` when team grows
- [ ] Link governance to CI gates when compare-mode automation exists
- [ ] Define incident severity levels and freeze communication channel
