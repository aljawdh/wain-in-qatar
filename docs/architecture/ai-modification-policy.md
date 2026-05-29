# NAVIDUR — AI Modification Policy

> **Status:** Phase 4 — policy only. No runtime enforcement in this phase.  
> **Principle:** AI tools are **execution assistants**, not **architectural decision makers**.

---

## 1. Purpose

NAVIDUR uses AI coding assistants for speed. Unchecked AI changes are a top risk for:

- Silent scoring/ranking drift
- Accidental API contract breaks
- Cross-folder coupling (`experimental/` → production)
- Large refactors that bypass compare-mode and regression review

This policy defines **safe use**, **forbidden behaviors**, and **mandatory human review**.

---

## 2. Role of AI Assistants

| AI is | AI is not |
|-------|-----------|
| A drafter for docs, tests, and small patches | The owner of system architecture |
| A navigator for codebase exploration | Authorized to deploy or push without human request |
| A helper for repetitive boilerplate | A substitute for marine/operations judgment |
| A tool to run local commands when asked | Free to “improve” production engines opportunistically |

**Decision rule:** If the answer affects **what fish users see**, **how stations are ranked**, or **what JSON clients parse**, a **human** decides — AI may only implement after explicit instruction.

---

## 3. Small-Task Execution Philosophy

Prefer **small, reviewable units** over sweeping changes:

| Good task size | Bad task size |
|----------------|---------------|
| One doc file or one function with clear spec | “Refactor the entire fish engine for clarity” |
| Fix a typo in `docs/architecture/` | Rename public API fields across repo |
| Add a scenario placeholder under `scripts/tests/` | Rewire `api/index.js` and three handlers |
| Explain diff between golden and candidate | Auto-merge 20 files without diff review |

**Batching rule:** Group only changes that share one intent (e.g. “Phase 4 governance docs”). Never mix governance docs with production engine edits in the same session unless explicitly requested and reviewed.

---

## 4. Safe Use Patterns

| Pattern | Example |
|---------|---------|
| **Docs-first** | Architecture, governance, runbooks under `docs/architecture/` |
| **Isolated spikes** | Code under `experimental/` or `shared/intelligence-v2/` |
| **Test artifacts** | Golden/candidate JSON, scenario stubs under `scripts/tests/` |
| **Read-only investigation** | Trace analysis path, explain KV load order |
| **Explicit scope** | User says “only `engineering-governance.md`, no runtime” — AI obeys |

Always state what was **not** changed when the user imposes boundaries (runtime, API, deploy, commit).

---

## 5. Forbidden AI Behaviors

AI assistants must **not** (unless a human explicitly requests each item in the same task):

| Forbidden behavior | Why |
|--------------------|-----|
| Autonomous multi-file refactors on `shared/`, `serverless_api/`, `api/` | High regression risk |
| Changing scoring weights, `minScore`, ranking order logic | User-facing intelligence drift |
| Modifying `sanitizePublicNavidurDto` or public field names | Client contract break |
| `require()` from production into `experimental/` | Breaks isolation |
| Commit, push, deploy, or production KV writes | Operational authority is human |
| “Cleanup” or “optimization” of production code without task | Scope creep |
| Inventing commit SHAs, API responses, or test results | Must use real commands/output |
| Adding secrets to repo, docs, or chat | Security violation |

If asked to do something forbidden, AI should **refuse**, explain which policy applies, and offer a safe alternative (e.g. design doc first).

---

## 6. Mandatory Human Review Areas

Human review is **required** before merge/deploy for any AI touch in:

| Area | Review focus |
|------|----------------|
| Fish recommendation engine | Species list, scores, thresholds, Arabic names |
| Analysis engine | Station inputs, Dur logic, recommendation attachment |
| Gulf fish database | Schema, species entries, trait fields |
| Public DTO / API responses | Field presence, no internal leak |
| KV and data-store | Read/write keys, bootstrap vs prod |
| Admin auth and cron | Side effects, scheduled mutations |
| UI (`main.js`, `public/`) | User-visible behavior |

**Review method:** Diff review + compare-mode where applicable + staging smoke per `regression-verification.md`.

---

## 7. Prohibited Autonomous Refactors

These are **never** “drive-by” AI improvements:

- Renaming modules for “consistency” across `shared/` and `serverless_api/`
- Extracting abstractions that change import graph in production
- Reformatting entire directories in the same change as logic edits
- Merging duplicate logic between production and `experimental/`
- “Modernizing” error handling in hot paths without tests

Refactors need a **written goal**, **scope limit**, **rollback plan**, and **golden baseline** update plan.

---

## 8. Production Safety Restrictions

When working near production paths, AI must:

1. **Read** `runtime-safety-rules.md` and relevant architecture doc first
2. **Avoid** editing files listed in forbidden categories unless task explicitly includes them
3. **Never** assume deploy updates KV — refer to `secrets-and-kv.md`
4. **Never** connect experimental code to live routes
5. **Report** `git status` and diff summary after doc-only or code tasks when asked

Default for stabilization phases: **documentation and governance only**, zero runtime diff.

---

## 9. Documentation-Before-Refactor Policy

Before non-trivial production refactors:

| Step | Output |
|------|--------|
| 1. Problem statement | Issue or architecture note — why change is needed |
| 2. Scope boundary | Files in / files out |
| 3. Compatibility | API additive vs breaking; KV impact |
| 4. Verification | Compare scenarios, stations, rollback tag |
| 5. Implement | Small PRs only after 1–4 exist |

AI may **draft** step 1–4; a **human** approves before step 5.

---

## 10. Session Boundaries (Practical)

At start of a task, humans should specify:

- Allowed folders (e.g. `docs/architecture/` only)
- Forbidden actions (commit, deploy, push, runtime)
- Success criteria (files created, tests run, no prod diff)

At end, AI should confirm compliance with those boundaries.

---

## 11. Related Documents

| Document | Relevance |
|----------|-----------|
| `engineering-governance.md` | Authority and approval |
| `runtime-protection-strategy.md` | API stability, shadow execution |
| `compare-mode-design.md` | Pre-enable validation |
| `safe-rollout-workflow.md` | Release order |
| `runtime-safety-rules.md` | Forbidden production edits |

---

## 12. Open Questions / TODO

- [ ] Add PR template checkbox: “AI-assisted; human reviewed scoring/API”
- [ ] Define allowed AI models/tools per environment (local vs CI)
