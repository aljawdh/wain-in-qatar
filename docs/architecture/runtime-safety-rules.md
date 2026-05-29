# NAVIDUR — Runtime Safety Rules

> **Status:** Phase 2 — mandatory discipline for anyone touching the repo.  
> **These rules protect production behavior; they are not enforced by code in this phase.**

---

## 1. Forbidden Production Modifications (Without Release Process)

Do **not** change the following in a hurry or “quick fix” on `main`:

| Area | Paths (indicative) |
|------|---------------------|
| Fish scoring / ranking | `shared/navidur-fish-recommendation-engine.js` |
| Analysis orchestration | `shared/navidur-analysis-engine.js` |
| Gulf DB shaping | `shared/navidur-fish-database.js` |
| Public DTO shape | `serverless_api/_lib/navidur-public-dto.js` |
| KV read/write semantics | `serverless_api/_lib/data-store.js` |
| API routing | `api/index.js`, `vercel.json` rewrites |
| Production UI behavior | `main.js`, `index.html`, `public/` |

Each change requires: review, tagged baseline update, deploy, and `production-checklist.md`.

---

## 2. Shadow Development Philosophy

New behavior is built **beside** production, not inside it:

1. Prototype under `experimental/` or versioned folders (e.g. `shared/intelligence-v2/`).
2. Prove with fixtures and compare-mode (see `testing-strategy.md`).
3. Integrate only via explicit merge + tag + deploy.

**Shadow** = same inputs, different code path, no user traffic.

---

## 3. No-Direct-Production-Edit Policy

| Forbidden | Allowed |
|-----------|---------|
| Editing Upstash KV in production to “tune” one station | Approved runbook + backup |
| Patching live Vercel env vars without record | Documented change ticket |
| Hot-patching serverless code in dashboard | Redeploy from git |
| Sharing tokens in chat or commits | Secret manager / Vercel env only |

---

## 4. Experimental Folder Philosophy

| Folder | Purpose |
|--------|---------|
| `experimental/` | Scripts, spikes, compare tools — **not imported by production** |
| `shared/intelligence-v2/` | Next-gen modules — **not required by `api/index.js`** |

**Rules:**

- Nothing in these folders may be `require()`’d from production entrypoints without an explicit integration PR.
- README in each folder states isolation (see folder README files).
- Deletion or promotion is a deliberate product/engineering decision.

---

## 5. API Stability Rules

Public clients depend on stable JSON:

| Rule | Detail |
|------|--------|
| No rename | Existing `fishing.fish_recommendations[].*` field names |
| No leak | Internal fields (e.g. display-only ranking keys) |
| Additive only | New optional fields require client review |
| Sanitization | Internal traits stay server-side; public DTO passes through `sanitizePublicNavidurDto` |

Breaking changes require versioned API route or coordinated UI release.

---

## 6. Data Safety Rules

| Rule | Detail |
|------|--------|
| SSOT | `data/gulf_fish_database.json` for species reference (Phase A baseline) |
| KV awareness | Bundled JSON deploy ≠ KV update automatically |
| No secrets in data | JSON files must not contain API keys |
| Version field | Bump document `version` when operators need to detect drift |

---

## 7. Documentation Safety

Architecture docs must:

- Stay high-level (no algorithm constants, no weights, no tokens).
- Mark unknowns as TODO — not invented behavior.
- Point operators to checklists, not copy-paste secrets.

---

## 8. Escalation

If production behavior diverges from tagged baseline:

1. Stop further deploys.
2. Run `production-checklist.md`.
3. Roll back per `versioning-and-rollbacks.md`.
4. Root-cause in a ticket — fix forward only after verification.

---

## 9. Related Documents

- `versioning-and-rollbacks.md`
- `production-checklist.md`
- `testing-strategy.md`
- `secrets-and-kv.md`
