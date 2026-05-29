# NAVIDUR — Compare-Mode Design

> **Status:** Phase 3 architecture — design document only.  
> **Implementation:** None in this phase. See `experimental/compare-mode/README.md`.

---

## 1. Purpose of Compare Mode

Compare mode answers one question before production deploy:

> **Given the same station and scenario inputs, does the candidate behave acceptably relative to an approved baseline?**

It is a **governance tool**, not a user-facing feature. Outputs are diffs and review packets for operators and reviewers.

| In scope | Out of scope |
|----------|--------------|
| Public JSON field comparison | Live traffic splitting |
| Golden vs candidate snapshots | Automatic production rollout |
| Classification of diffs | Scoring or ranking tuning in prod |

---

## 2. Shadow Execution Philosophy

**Shadow** execution means the candidate path runs **parallel to** production mentally and operationally — never **in place of** production until approved.

| Rule | Detail |
|------|--------|
| Users | Always receive current production responses |
| Candidate | Runs locally, on preview, or in staging only |
| No hooks | No `require()` from `api/index.js` to `experimental/` without integration PR |
| Read-only prod smoke | Authorized POST for capture only — no KV writes |

Shadow does not imply “silent percentage rollout” in this phase.

> **TODO:** Define preview URL and auth policy when staging is provisioned (`staging-environment.md`).

---

## 3. Candidate vs Golden Snapshots

| Artifact | Location | Role |
|----------|----------|------|
| **Golden** | `scripts/tests/golden/` | Approved baseline at a stable tag |
| **Candidate** | `scripts/tests/candidates/` | Output from branch/preview/local run |
| **Scenario** | `scripts/tests/scenarios/` | Shared input definition (placeholder today) |

**Lifecycle:**

1. Capture golden after verified release → commit when redaction policy allows.
2. Run candidate against same scenario.
3. Store candidate file under `candidates/<sha>/`.
4. Never rename candidate to golden without review + tag update.

See `scripts/tests/golden/README.md` and `scripts/tests/candidates/README.md`.

---

## 4. Diff Review Workflow

```text
Scenario → Run baseline (golden) + Run candidate → Generate diff → Classify → Approve / Waiver / Block
```

| Classification | Meaning |
|----------------|---------|
| `ok` | No meaningful change |
| `expected_change` | Intentional; documented in release notes |
| `regression` | Unintended; block deploy |
| `unknown` | Needs expert review |

**Review packet** lives in `scripts/tests/diffs/` (markdown + optional JSON).

**Approvers:** At least one reviewer besides author for engine/data releases (policy TBD).

Full regression gates: `regression-verification.md`.

---

## 5. Non-Invasive Testing Rules

| Do | Do not |
|----|--------|
| Compare public API fields only | Diff internal Dur trait arrays in CI without policy |
| Use fixed scenario fixtures | Rely on live weather for deterministic CI |
| Keep candidates local or gitignored until reviewed | Commit raw prod responses with secrets |
| Document waivers | Auto-deploy on “green” diff (future policy undefined) |

Compare mode **observes** behavior; it does not **change** production state.

---

## 6. Rollback-First Strategy

Before compare mode approves a deploy:

1. **Rollback target identified** — prior Vercel deployment, git tag, KV backup (`versioning-and-rollbacks.md`).
2. **Triggers defined** — critical shape break, 5xx, missing summary (`regression-verification.md`).
3. **Golden alignment** — after rollback, golden files must match rolled-back tag or be re-captured.

Compare failure → block deploy.  
Post-deploy smoke failure → execute rollback, then refresh compare baselines.

---

## 7. Future Tooling (Not Built)

Planned location: `experimental/compare-mode/` — CLI or script that:

- Loads scenario JSON
- Fetches or invokes analysis (staging/local)
- Writes candidate + diff artifacts

> **TODO:** Spec CLI flags, exit codes, and CI integration.

---

## 8. Related Documents

| Document | Topic |
|----------|--------|
| `staging-environment.md` | Staging layer |
| `safe-rollout-workflow.md` | End-to-end rollout |
| `regression-verification.md` | Pre-deploy checks |
| `data-protection-strategy.md` | What may appear in snapshots |
| `experimental/compare-mode/README.md` | Skeleton folder |
