# Regression Results

> **Status:** Output area for future captures — currently empty.  
> **Do not commit production responses containing sensitive data without review.**

---

## 1. How Outputs Should Be Stored

### Directory layout (recommended)

```text
results/
  README.md
  <stable-tag>/
    <scenario-id>/
      golden.json          ← approved baseline
      candidate-<git-sha>.json
      diff-<git-sha>.md    ← human-readable summary
```

### `golden.json` contents (public fields only)

| Section | Include? |
|---------|----------|
| `_capture_meta` | tag, commit, timestamp, endpoint URL |
| `http_status` | yes |
| `fishing.fish_recommendations` | names, scores, reason_ar (optional truncate) |
| `fishing.species_activity` | yes |
| `fishing.confidence_score` | yes |
| `public_navidur_summary` | selected keys |
| `decision.label` / `decision.score` | if stable |
| Internal dur traits | **no** |

> **TODO:** Add JSON schema file when first golden is captured.

---

## 2. Compare-Mode Philosophy

Compare-mode is **read-only diff**, not automatic promotion.

| Step | Owner |
|------|--------|
| Run scenario input from `../scenarios/` | Engineer |
| Save raw response to `candidate-*.json` | Engineer |
| Diff against `golden.json` | Tool or manual |
| Classify diffs: expected / investigate / block | Reviewer |
| Approve deploy or rollback | Operator |

Candidate code must run from `experimental/` or a git worktree — not silent edits on `main`.

---

## 3. Expected vs Actual

Document each diff with:

| Field | Description |
|-------|-------------|
| `path` | JSON path (e.g. `fishing.fish_recommendations[0].fish_name_ar`) |
| `expected` | From golden |
| `actual` | From candidate |
| `classification` | `ok` \| `expected_change` \| `regression` \| `unknown` |
| `notes` | Ticket link or reason |

**Score drift:** compare numeric `score` / `confidence` with tolerance band defined in `regression-verification.md` (TBD per scenario).

**Ordering drift:** species order may change without score change — classify separately from score drift.

---

## 4. Safe Review Process Before Deploy

1. All P0 scenarios have an approved `golden.json` for the releasing tag (or explicit waiver).
2. Candidate diff reviewed by someone other than the author (when possible).
3. KV/data releases documented if JSON reference files changed.
4. `docs/architecture/production-checklist.md` completed after deploy.
5. Waivers documented in release notes (why diff was accepted).

> **TODO:** Define waiver template.

---

## 5. Rollback Triggers

Consider rollback (see `versioning-and-rollbacks.md`) when:

| Trigger | Severity |
|---------|----------|
| Analysis 5xx on P0 scenario | Critical |
| Missing `public_navidur_summary` | Critical |
| New field on public recommendation objects | Critical |
| `fish_recommendations` empty when prior golden was non-empty (same fixture) | High |
| `confidence_score` drift beyond approved band | Medium (policy TBD) |
| Species set change without approved data/engine release | Medium |

Rollback does **not** require every score point to match — policy is set per release type (engine vs data).

---

## 6. Git and Privacy

- Prefer **not** committing raw `results/` until redaction policy exists.
- `.gitignore` for `results/**/candidate-*.json` may be added in a future PR.
- Never store API keys or auth headers in result files.

---

## 7. Related Documents

- `../baselines/README.md`
- `../scenarios/`
- `docs/architecture/regression-verification.md`
- `docs/architecture/testing-strategy.md`
