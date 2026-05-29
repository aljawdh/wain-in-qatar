# NAVIDUR — Secrets and KV (Upstash)

> **Status:** Phase 1 documentation.  
> **Warning:** Do not commit secrets. Do not change `data-store.js` behavior in this phase.

---

## 1. Persistence Model

`serverless_api/_lib/data-store.js`:

| Environment | Read behavior |
|---------------|---------------|
| **KV configured** (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) | Read/write `navidur_store_{key}` in Upstash |
| **KV absent (local)** | Read bundled `data/{file}.json` directly |

---

## 2. KV Bootstrap Behavior (Known)

When KV is enabled and a key is **missing**:

1. Seed is read once from bundled `data/*.json`.
2. Value is written to KV.
3. Subsequent reads use KV only (seed file not re-read for that key).

**Implication:** Deploying updated `data/gulf_fish_database.json` does **not** automatically update production KV.

> **TODO:** Document official operator procedure for refreshing KV after data releases (script name, auth, audit log).

---

## 3. Environment Variables

Production uses Vercel project environment variables (names vary by integration).

**Rules:**

- Never document or commit secret values in this repository.
- Operators manage values only in Vercel / secure stores.

> **TODO:** Maintain a redacted inventory outside git (team password manager or internal wiki).

---

## 4. Keys Touching Fish Recommendations

| Store key | Seed file | Used by |
|-----------|-----------|---------|
| `gulf_fish_database` | `data/gulf_fish_database.json` | `loadReferenceData` → `analyzeLiveStation` |
| `stations` | `data/stations.json` | Station metadata |
| `live_weather_cache` | `data/live_weather_cache.json` | Weather cache |

**Data releases:** Bundled JSON updates may require a separate operator step to refresh KV. See `production-checklist.md` and `versioning-and-rollbacks.md`.

> **TODO:** Define approved KV refresh procedure (future operational runbook — not implemented in code).

---

## 5. Local Development

- Without KV: edits to `data/*.json` are read directly.
- With KV (e.g. after `vercel env pull`): local behavior mirrors production KV reads/writes.

> **TODO:** Document `.env.local` handling and gitignore policy.

---

## 6. Security Rules

- Never commit `.env`, `.env.local`, or tokens.
- Runtime store (`/api?route=runtime-store`) requires `x-navidur-store-secret` header.

> **TODO:** Document admin auth (JWT/cookie) flow separately.

---

## 7. Open Questions / TODO

- [ ] List all KV keys (catch logs, snapshots, audits) and retention.
- [ ] Document backup/export procedure for Upstash.
- [ ] Clarify read-only token (`KV_REST_API_READ_ONLY_TOKEN`) usage if any.
