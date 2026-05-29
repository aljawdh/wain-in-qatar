# NAVIDUR — Production Checklist

> **Use after every production deploy** that may affect analysis, fish recommendations, or reference data.  
> **Duration:** ~10–15 minutes for a standard release.

---

## Pre-Deploy

- [ ] Change reviewed on `main` (scope documented: engine / data / UI / API).
- [ ] Deployment snapshot recorded (commit hash, prior Vercel deployment ID).
- [ ] If `data/*.json` changed: KV impact assessed (`secrets-and-kv.md`).
- [ ] Rollback target identified (previous tag or deployment).
- [ ] No secrets in commit diff.

---

## Deploy

- [ ] Production deploy completed (Vercel).
- [ ] If reference JSON changed: KV refresh executed per operator runbook (when KV is enabled).
- [ ] Cron jobs still configured (`deployment.md`) — no accidental disable.

---

## KV Verification (When Data Keys Changed)

- [ ] Confirm production reads expected document version (e.g. `gulf_fish_database.version` via operator tool or test analysis).
- [ ] Species count / key fields spot-check matches release notes.
- [ ] No unintended overwrite of unrelated KV keys.

> **TODO:** Attach approved KV refresh steps to internal runbook (not in public repo).

---

## Station Verification

Run `POST https://navidur.app/api?route=analysis` with body:

```json
{ "station_id": "<P0_STATION_ID>" }
```

- [ ] HTTP 200
- [ ] `station` block present
- [ ] `fishing` block present
- [ ] `decision` block present

> **TODO:** Maintain P0 station ID list in team ops doc.

---

## Regression Checks (Fish Recommendations)

- [ ] `fishing.fish_recommendations` is an array (length ≤ configured max, typically 8).
- [ ] Each item has `fish_name_ar`, `score`, `confidence`, `reason_ar`.
- [ ] `score` equals `confidence` on sampled items.
- [ ] No `display_rank_score` (or other internal-only keys) on items.
- [ ] No duplicate highly similar species in Top N when diversity rules expect dedupe (manual spot-check).
- [ ] No cephalopod/scorpion species in Top N for general coastal smoke test (if applicable to P0 station).

---

## API Response Verification

- [ ] `public_navidur_summary` present with `sea_state_ar` and `fishing_recommendation_ar`.
- [ ] Internal trait arrays not exposed on public `dur` blocks.
- [ ] Response shape matches prior release (no removed required fields).

---

## Rollback Readiness

- [ ] Previous Vercel deployment still available for instant rollback.
- [ ] If KV was modified: backup or prior JSON payload identified.
- [ ] Team notified of deploy completion and checklist result.

---

## Post-Deploy Observation

- [ ] Error rate / logs normal (short window).
- [ ] No user-reported analysis failures on P0 stations.

---

## Sign-Off

| Field | Value |
|-------|--------|
| Date | |
| Deployer | |
| Commit | |
| Tags updated? | |
| Result | Pass / Fail |
| Notes | |

---

## Related Documents

- `versioning-and-rollbacks.md`
- `testing-strategy.md`
- `runtime-safety-rules.md`
