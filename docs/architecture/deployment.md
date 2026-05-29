# NAVIDUR — Deployment

> **Status:** Phase 1–2 documentation. Procedures live in `versioning-and-rollbacks.md` and `production-checklist.md`.

---

## 1. Platform

- **Host:** Vercel
- **Production alias:** https://navidur.app
- **Entry:** `api/index.js` (serverless function router)
- **Config:** `vercel.json`

---

## 2. Build / Bundle

- `vercel.json` includes `data/*.json` in the API function bundle (`includeFiles`).
- Static assets served via rewrites to `public/`, `admin.html`, `field/`, etc.

> **TODO:** Document build command, Node version, and environment variable requirements from Vercel project settings.

---

## 3. Cron Jobs (Configured)

| Path | Schedule (vercel.json) |
|------|-------------------------|
| `/api/run-snapshots` | `0 0 * * *` (daily) |
| `/api/run-intelligence-memory-cron` | `0 * * * *` (hourly) |

> **TODO:** Document auth/secrets required for cron invocations and idempotency expectations.

---

## 4. Release Tags (Stability)

| Tag | Intended baseline |
|-----|-------------------|
| `stable-phase-a` | Fish engine + analysis integration commit |
| `stable-phase-a-data` | Gulf fish database JSON expansion commit |

**Rollback / verification:** See `versioning-and-rollbacks.md` and `production-checklist.md`.

---

## 5. Deploy Commands (Reference Only)

Operators use the project’s standard Vercel production deploy flow. Exact commands are not duplicated here.

---

## 6. Post-Deploy Verification

Use `production-checklist.md` (authoritative checklist for operators).

---

## 7. What Documentation Phases Did **Not** Change

- No changes to `vercel.json`, CI, or deploy hooks in this stabilization pass.
- No automatic KV reseed on deploy (current behavior).

---

## 8. Open Questions / TODO

- [ ] Document staging/preview environments if used.
- [ ] Document cache headers (`setNoCache`) policy per route.
- [ ] Link to Vercel project ID and team ownership.
