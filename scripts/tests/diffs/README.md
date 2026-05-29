# Diff Artifacts

> **Human-readable compare output — not source of truth for production.**

---

## 1. Purpose

Record **differences** between a golden snapshot and a candidate snapshot for review before deploy. Supports diff-only review philosophy (no automatic promotion).

---

## 2. Naming Convention

```text
diffs/<git-short-sha>/<scenario-id>.md
diffs/<git-short-sha>/<scenario-id>.json     ← optional machine-readable
diffs/<git-short-sha>/summary.md             ← all scenarios rollup
```

Pairing:

```text
golden/stable-phase-a-data/katara-normal.json
candidates/a1b2c3d/katara-normal.json
diffs/a1b2c3d/katara-normal.md
```

---

## 3. Snapshot Lifecycle

| Stage | Action |
|-------|--------|
| **Create** | Compare tool or manual diff after candidate run |
| **Review** | Reviewer marks classifications in ticket |
| **Attach** | Link diff path in PR / release notes |
| **Archive** | Keep for audit window; delete per retention policy |

---

## 4. Suggested Diff Document Sections

1. Scenario ID and input summary  
2. Baseline tag / golden path  
3. Candidate commit / preview URL  
4. Table: path | expected | actual | classification  
5. Rollback recommendation (if any)  
6. Waiver notes (if accepted)

> **TODO:** Provide markdown template file `diff-template.md`.

---

## 5. Rollback Relationship

| Diff signal | Typical response |
|-------------|------------------|
| Critical API shape break | Block deploy; rollback not needed if not deployed |
| Post-deploy smoke failure | Execute rollback per `versioning-and-rollbacks.md` |
| Intentional data release diff | Update golden after prod verification + new tag |

Diffs **trigger** decisions; they do not execute rollback.

---

## 6. Related

- `../golden/README.md`
- `../candidates/README.md`
- `docs/architecture/safe-rollout-workflow.md`
- `docs/architecture/regression-verification.md`
