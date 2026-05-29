# NAVIDUR — Runtime Protection Strategy

> **Status:** Phase 4 — strategy document only.  
> **Important:** This phase does **not** implement runtime guards, middleware, or feature flags in code.

---

## 1. Purpose

Runtime protection keeps **production behavior predictable** while allowing **safe evolution** in isolated areas. This document defines principles and categories of risk — enforcement today is **process + review**, not automated blocks.

**Related:** `runtime-safety-rules.md`, `compare-mode-design.md`, `versioning-and-rollbacks.md`

---

## 2. Runtime Isolation Principles

```text
┌─────────────────────────────────────────────────────────┐
│  PRODUCTION RUNTIME (user traffic)                       │
│  api/index.js → serverless_api → shared (live paths)     │
└─────────────────────────────────────────────────────────┘
         ▲                          │
         │ explicit integration     │ never require()
         │ PR + tag + deploy        ▼
┌─────────────────────────────────────────────────────────┐
│  ISOLATED (no user traffic)                              │
│  experimental/ · shared/intelligence-v2/ · scripts/tests │
└─────────────────────────────────────────────────────────┘
```

| Principle | Detail |
|-----------|--------|
| **One live path** | Public analysis flows through documented handlers only (`system-overview.md`) |
| **No shadow imports** | Production must not load experimental modules at cold start |
| **Side-effect clarity** | Cron and admin routes documented before enable |
| **DTO boundary** | Internal computation ≠ public JSON (`navidur-public-dto.js`) |

---

## 3. API Stability Rules

Public clients and cached frontends depend on stable analysis JSON.

| Rule | Rationale |
|------|-----------|
| **Additive by default** | New optional fields are safer than renames |
| **No silent removals** | Breaking clients without coordinated UI release |
| **Sanitize always** | Internal ranking/display keys stay server-side |
| **Route stability** | `?route=` names are contracts; new routes need docs |
| **Error shape consistency** | Unexpected 500s are ops incidents; document expected 4xx |

Breaking changes require either a **new route/version** or a **flagged UI migration** — not a same-day swap.

---

## 4. Backwards Compatibility Philosophy

| Layer | Compatibility expectation |
|-------|---------------------------|
| **Bundled JSON** | Older app versions may still run until redeploy; new fields should not break parsers that ignore unknown keys |
| **KV payloads** | Readers must tolerate missing keys; writers must not destroy unknown fields without migration plan |
| **Engine output** | Species lists may grow; order may change only via documented ranking rules |
| **Admin vs public** | Admin may expose more fields; public DTO remains minimal |

**Rule:** Prefer **tolerant readers** and **explicit migrations** over in-place destructive edits.

---

## 5. Compare-Before-Enable Strategy

No candidate intelligence path may **replace** production until:

1. Same scenarios run against **golden** baseline (`scripts/tests/golden/`)
2. Candidate output stored and reviewed (`scripts/tests/candidates/`)
3. Diffs classified per `compare-mode-design.md` (acceptable / review / block)
4. Staging smoke when staging exists (`staging-environment.md`)
5. Stable tag updated after prod verification (`versioning-and-rollbacks.md`)

**Compare-before-enable** applies to engines, reference data, and DTO shaping — not to pure documentation.

---

## 6. Shadow Execution Rules

**Shadow** = candidate runs **alongside** production mentally and operationally, **not in place of** it.

| Allowed shadow | Forbidden shadow |
|----------------|------------------|
| Local/preview POST with same station ID | Percentage traffic split to candidate in prod |
| Read-only prod capture for golden files | KV writes from candidate code against prod |
| Diff tools under `scripts/tests/` | `require('experimental/...')` from `api/index.js` |

Users always receive **current production** responses until explicit integration and deploy.

---

## 7. Production Rollback-First Mentality

When production behavior is wrong:

| Priority | Action |
|----------|--------|
| 1 | Stop bleeding — freeze merges/deploys (`engineering-governance.md`) |
| 2 | Roll back to last Vercel deployment or git tag |
| 3 | If data issue — KV restore from backup, not forward-fix in prod |
| 4 | Root cause and golden update **after** stability restored |

**Do not** stack untested fixes on a broken release. Rollback is success, not failure.

Code rollback and KV rollback are **independent** — see `versioning-and-rollbacks.md`.

---

## 8. High-Risk Change Categories

Treat these as **maximum scrutiny** (compare + staging + checklist):

| Category | Risk |
|----------|------|
| Fish scoring / ranking / `minScore` | Wrong species shown to fishers |
| Gulf fish DB schema or mass edits | Widespread recommendation errors |
| Analysis input resolution (station, Dur, env) | Wrong context for entire session |
| Public DTO field add/remove/rename | Client/UI breakage |
| KV bootstrap or key rename | Prod diverges from repo bundle |
| Cron jobs mutating reference data | Silent overnight drift |
| Auth middleware changes | Admin exposure or lockout |
| `vercel.json` / routing | Total API outage |

Low-risk: architecture markdown, governance docs, README in `experimental/` with no imports.

---

## 9. What This Phase Does Not Do

| Not in Phase 4 | Future possibility |
|----------------|-------------------|
| Runtime feature flags | Could gate candidate paths when designed |
| Automated diff CI gate | Could enforce golden compare on PR |
| Circuit breakers on analysis | Could degrade gracefully on upstream failure |
| Schema validation middleware | Could reject bad KV payloads at read time |

Any implementation of guards requires its own phase, design note, and regression plan.

---

## 10. Open Questions / TODO

- [ ] List all cron routes and mutation side effects in `system-overview.md`
- [ ] Define “acceptable diff” taxonomy in compare-mode when first golden set is committed
- [ ] Staging URL policy when preview environment is live
