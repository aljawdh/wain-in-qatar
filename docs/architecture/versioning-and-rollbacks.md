# NAVIDUR — Versioning and Rollbacks

> **Status:** Phase 2 operational documentation.  
> **Scope:** Process and safety — not automated tooling in this phase.

---

## 1. Stable Tags Philosophy

Stable tags mark **known-good baselines** on `main`. They are pointers for humans and CI, not automatic deploy triggers.

| Tag | Typical use |
|-----|-------------|
| `stable-phase-a` | Fish recommendation engine + analysis integration |
| `stable-phase-a-data` | Gulf fish reference database (`data/gulf_fish_database.json`) |

**Rules:**

- Create a new stable tag only after production verification (see `production-checklist.md`).
- Tag names describe **capability phases**, not calendar dates.
- Document what changed in the commit message or release note (outside this file).

```text
git show stable-phase-a --stat
git show stable-phase-a-data --stat
```

---

## 2. Rollback Philosophy

Rollback means **returning production to a previously verified state**, not “fix forward” under pressure.

| Layer | Rollback lever | Notes |
|-------|----------------|-------|
| Application code | Redeploy prior Vercel deployment or git commit | Engine/UI/API must match tested baseline |
| Bundled `data/*.json` | Redeploy commit that contained prior JSON | Bundle ships with API on Vercel |
| KV-stored JSON | Operator restore of prior KV payload | Deploy alone may **not** revert KV (see `secrets-and-kv.md`) |

**Principle:** Code rollback and data rollback are **independent** operations.

---

## 3. Deployment Snapshots

Before any production deploy that touches analysis or fish data:

1. Note current Vercel deployment ID / URL (Vercel dashboard).
2. Note current git commit on `main`.
3. Note whether `data/gulf_fish_database.json` (or other reference JSON) changed.
4. If KV-backed keys changed, record current KV document version field (if present) or export backup per operator procedure.

> **TODO:** Define where the team stores deployment snapshot records (ticket, changelog, internal doc).

---

## 4. Safe Deployment Sequence

Recommended order for changes that affect live recommendations:

| Step | Action |
|------|--------|
| 1 | Merge to `main` only after review |
| 2 | Tag stable baseline **after** verification on preview or controlled test (if available) |
| 3 | `vercel --prod` (operators) |
| 4 | If reference JSON changed: execute KV refresh per runbook (when applicable) |
| 5 | Run `production-checklist.md` |
| 6 | Monitor errors/logs for a short observation window |

**Split releases (recommended):**

- **Engine release** → tag `stable-phase-a-*` (new tag name when baseline changes).
- **Data-only release** → tag `stable-phase-a-data-*` and KV step as needed.

---

## 5. Production Verification Checklist (Summary)

Full checklist: `production-checklist.md`.

Minimum after deploy:

- [ ] `POST /api?route=analysis` returns 200 for a known coastal station.
- [ ] `fishing.fish_recommendations` is a non-empty array when conditions allow.
- [ ] `public_navidur_summary` is present.
- [ ] No new fields leaked on recommendation items (API stability).
- [ ] If data release: spot-check species count / version in operator tooling.

---

## 6. Rollback Execution (High Level)

**Application rollback:**

1. Identify last good Vercel deployment or git tag.
2. Redeploy that deployment (or deploy that commit).
3. Re-run production checklist.

**Data rollback (KV):**

1. Restore previous KV document from backup or re-write from prior git tag’s bundled JSON.
2. Re-run production checklist.

> **TODO:** Document backup retention policy for Upstash.

---

## 7. Related Documents

- `deployment.md` — platform and crons
- `secrets-and-kv.md` — persistence model
- `runtime-safety-rules.md` — what must not be changed casually
- `testing-strategy.md` — pre-release verification
