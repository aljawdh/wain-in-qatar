# NAVIDUR — Knowledge Preservation Strategy

> **Status:** Phase 4 — long-term maintainability and knowledge safety.  
> **Scope:** How NAVIDUR preserves marine intelligence, tuning decisions, and operational experience over time.

---

## 1. Purpose

NAVIDUR’s value is not only code — it is **accumulated marine intelligence**, **tuning judgment**, and **operational know-how** (stations, seasons, Gulf species, Qatar coastal context). Loss of this knowledge causes repeated mistakes and unsafe re-tuning.

This strategy defines **what to preserve**, **where it lives**, and **how it evolves** without dumping secrets into docs.

---

## 2. Categories of Knowledge

| Category | Examples | Primary home (today) |
|----------|----------|----------------------|
| **Marine intelligence** | Species traits, Gulf DB entries, Dur calendars, habitat notes | `data/gulf_fish_database.json`, `data/*.json`, architecture docs |
| **Tuning knowledge** | Score weights, thresholds, ranking rationale, “why Katara differs” | Commit messages, stable tags, compare diffs, future runbooks |
| **Operational experience** | Station IDs, smoke stations, deploy/KV lessons, incident notes | `production-checklist.md`, audit docs, operator memory → wiki |
| **Engineering structure** | Paths, DTO rules, isolation folders | `docs/architecture/*.md` |
| **Verification baselines** | Golden snapshots, scenario definitions | `scripts/tests/golden/`, `scripts/tests/scenarios/` |

---

## 3. Protecting Marine Intelligence Knowledge

| Practice | Detail |
|----------|--------|
| **SSOT discipline** | Gulf fish data changes go through `data/gulf_fish_database.json` with version field bumped intentionally |
| **No orphan spreadsheets** | Species changes should land in repo or documented KV sync runbook — not private files only |
| **Trait meaning documented** | When adding traits or fields, note semantics in architecture or data README (not secret values) |
| **Arabic / local names** | Preserve local naming consistency; breaking renames need compare review |
| **Roadmap separation** | Future ideas live in `marine-intelligence-roadmap.md` — not mixed into live engine without integration |

Marine knowledge is **data + docs + verified behavior**, not chat history.

---

## 4. Preserving Tuning Knowledge

Tuning changes are the highest regression risk.

| Preserve | How |
|----------|-----|
| **Before/after rationale** | PR description or commit body: what changed and expected station impact |
| **Stable tags** | `stable-phase-a`, `stable-phase-a-data` mark verified combinations |
| **Compare artifacts** | Golden vs candidate diffs for representative stations |
| **Threshold defaults** | Document default `minScore` and when ops may override (admin-only, if applicable) |

**Anti-pattern:** “We tweaked it in KV last Tuesday” with no commit, tag, or diff.

---

## 5. Preserving Operational Experience

| Practice | Detail |
|----------|--------|
| **Post-deploy notes** | Short note after prod verify: deployment ID, commit, stations smoked |
| **Incident write-ups** | What broke, rollback taken, KV vs code cause |
| **KV lessons** | Document that deploy ≠ KV update (`secrets-and-kv.md`) — repeat until wiki |
| **Checklist usage** | `production-checklist.md` is the template for repeatable ops memory |

Operational knowledge should become **searchable docs**, not tribal chat.

---

## 6. Documentation Lifecycle

```text
Idea → architecture note (docs/architecture/)
     → experimental spike (optional)
     → compare + regression
     → integration + tag
     → system-overview / fish-engine update
     → golden refresh (when policy allows)
```

| Stage | Document type |
|-------|----------------|
| Exploration | Roadmap, compare-mode design, TODO sections |
| Stabilization | Governance, safety rules, workflows |
| Release | Versioning doc, checklist completion, tag |
| Deprecation | Mark doc status “superseded”; link replacement |

**Status headers** (`> **Status:** Phase N`) help readers know if a doc is policy, design-only, or live.

---

## 7. Snapshot Discipline

| Snapshot type | When | Storage |
|---------------|------|---------|
| **Git stable tag** | After verified production release | Remote tags on `main` |
| **Golden analysis JSON** | After approved public output shape | `scripts/tests/golden/` |
| **Vercel deployment ID** | Before risky deploy | Ops log / checklist |
| **KV backup** | Before reference data migration | Operator-controlled backup store |
| **Bundled data version** | Gulf DB bump | `version` field in JSON + commit |

Snapshots are **recovery points**, not archives of every experiment.

---

## 8. Future Internal Wiki Recommendations

When the team outgrows markdown-only ops memory, add a lightweight wiki (GitHub Wiki, Notion, or docs site) for:

| Wiki section | Content |
|--------------|---------|
| **Runbooks** | KV sync, rollback, cron enable/disable |
| **Station catalog** | IDs, names, who verified last |
| **Release log** | Tag → deploy → smoke result |
| **Incidents** | Timeline, root cause, prevention |
| **Glossary** | Dur, species local names, internal codenames |

**Do not** store API tokens, Redis URLs, or admin passwords in wiki — link to secret manager only.

Until wiki exists, `docs/architecture/` remains the canonical engineering knowledge base.

---

## 9. Long-Term Maintainability Principles

| Principle | Application |
|-----------|-------------|
| **Prefer explicit over clever** | Readable engines beat opaque ML hooks without docs |
| **Small modules with clear owners** | See `team-scaling-strategy.md` |
| **Tests as specifications** | Golden files document expected public shape |
| **Delete dead experiments** | `experimental/` should not become a landfill |
| **Align docs with tags** | When `stable-phase-*` moves, update related architecture refs |

---

## 10. Related Documents

| Document | Topic |
|----------|--------|
| `data-protection-strategy.md` | Public vs private data |
| `secrets-and-kv.md` | Persistence boundaries |
| `compare-mode-design.md` | Golden/candidate lifecycle |
| `marine-intelligence-roadmap.md` | Future capabilities |
| `engineering-governance.md` | Approval and freeze |

---

## 11. Open Questions / TODO

- [ ] Redaction policy for golden JSON committed to repo
- [ ] Owner for periodic golden refresh per stable tag
- [ ] Wiki platform choice when second engineer joins
