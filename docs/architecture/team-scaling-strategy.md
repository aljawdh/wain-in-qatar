# NAVIDUR — Team Scaling Strategy

> **Status:** Phase 4 — lightweight, scalable team practices.  
> **Assumption:** Small team today (1–3 engineers + operations); not a large-company org chart.

---

## 1. Purpose

As NAVIDUR grows, work must split without **losing safety** or **blurring ownership** of fish intelligence, field data, and runtime. This document sketches a **minimal structure** that scales to a small engineering team — not a bureaucracy.

---

## 2. Future Engineering Team Structure (Lightweight)

| Role (can be part-time / combined) | Focus |
|-----------------------------------|--------|
| **Runtime maintainer** | `api/`, `serverless_api/`, deploy, API stability, cron |
| **Intelligence engineer** | `shared/` engines, Gulf DB, compare-mode, regression |
| **Data / field liaison** | `data/*.json`, station catalog, field UI feedback, species accuracy |
| **Operations** | Production smoke, KV sync, freeze/rollback, checklist |

One person may wear multiple hats; hats must still be **named** in release notes (“runtime + data reviewed by X”).

---

## 3. Separation of Responsibilities

```text
Field / domain          Data / reference           Runtime / API
(observations,          (JSON, KV sync,            (handlers, DTO,
 station reality)        species DB)                deploy, auth)
      │                        │                          │
      └────────── compare-mode / regression ─────────────┘
```

| Responsibility | Typical paths | Handoff artifact |
|----------------|---------------|------------------|
| **Field / domain** | Field UI feedback, species names, station behavior | Issue or data PR with species/station context |
| **Data / reference** | `data/*.json`, KV migration plans | Version bump + sync runbook |
| **Runtime** | `serverless_api/`, `api/index.js`, DTO | PR + staging smoke + checklist |

**Rule:** Field/domain changes that affect recommendations must pass through **data + intelligence review**, not direct KV edits.

---

## 4. Code Ownership Philosophy

| Pattern | Detail |
|---------|--------|
| **Directory ownership** | Each major folder has a default reviewer (future `CODEOWNERS`) |
| **No silent shared edits** | Two people editing `navidur-fish-recommendation-engine.js` without coordination → freeze risk |
| **Experimental is owned** | `experimental/` has a named curator; stale spikes deleted or promoted |
| **Docs follow code** | Architecture doc update is part of integration PR when behavior changes |

Ownership means **accountability for review**, not solo dictatorship.

---

## 5. Review Processes

| Change size | Review |
|-------------|--------|
| Docs / governance only | One maintainer skim |
| Reference data | Intelligence + data reviewer; compare if output changes |
| Engine / API | Two-person rule when available: author + maintainer |
| Production deploy | Operations sign-off on checklist |

**PR expectations:**

- Clear scope (what folders, what forbidden areas untouched)
- Link to compare diff or “N/A — docs only”
- Rollback note (tag or deployment to revert to)

---

## 6. Staging Gatekeeping

When staging/preview exists (`staging-environment.md`):

| Gate | Owner |
|------|--------|
| Preview deploy from branch | Author |
| Staging smoke (Katara or agreed stations) | Intelligence or ops |
| Promotion to `main` | Runtime maintainer |
| Production deploy | Operations + checklist |

**No bypass:** Staging is not optional for engine+data releases once available — only for pure documentation.

---

## 7. Safe Onboarding Principles

New contributors should:

1. Read `system-overview.md` and `runtime-safety-rules.md` first
2. Run local app read-only; no production KV on day one
3. First contributions: docs, tests, `experimental/` — not hot path engines
4. Pair on first fish DB or analysis PR
5. Learn rollback: `versioning-and-rollbacks.md` + where stable tags live

**Onboarding anti-pattern:** “Fix production scoring” as first task without golden baseline.

---

## 8. Communication Norms (Small Team)

| Norm | Why |
|------|-----|
| **Freeze broadcast** | One channel message when prod freeze active |
| **Release note one-liner** | Tag + commit + “stations smoked” |
| **AI-assisted PR label** | Triggers extra review per `ai-modification-policy.md` |
| **No drive-by deploy** | Deploy only from agreed `main` commit |

---

## 9. Growth Triggers (When to Formalize More)

| Trigger | Action |
|---------|--------|
| 2nd engineer on engines | Add `CODEOWNERS`, mandatory compare on PR |
| Regular field data updates | Data liaison role + wiki runbook |
| Frequent incidents | Incident template + blameless postmortem doc |
| 5+ contributors | Scheduled release train; staging always on |

Until triggers fire, keep process **minimal** — governance docs over meetings.

---

## 10. Related Documents

| Document | Topic |
|----------|--------|
| `engineering-governance.md` | Authority and freeze |
| `safe-rollout-workflow.md` | Release steps |
| `ai-modification-policy.md` | AI review expectations |
| `knowledge-preservation.md` | Wiki and snapshots |

---

## 11. Open Questions / TODO

- [ ] Assign named owners when team roster is known
- [ ] Add `CODEOWNERS` with paths: `shared/`, `serverless_api/`, `data/`
- [ ] Define office hours or on-call rotation only when incident rate warrants it
