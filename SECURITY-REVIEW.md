# NAVIDUR Authentication and Storage Security Review

**Scope:** Read-only source review of route authentication/authorization, prediction snapshot persistence, catch submission, and storage idempotency. Production configuration and deployed behavior were not inspected.

## Findings

| # | Severity | File | Lines | Finding | Confidence |
|---|----------|------|-------|---------|------------|
| 1 | HIGH | `serverless_api/tracking.js` | 198-218 | `GET /api?route=catch-data` returns catch-log records without authentication or field-level redaction. Records may include coordinates, operator identifiers, notes, timestamps, and catch details. Origin checks are not authorization. | 9/10 |
| 2 | MEDIUM | `serverless_api/tracking.js` | 13-31, 72-89, 103-115, 160-181 | `POST /api?route=log-catch` does not authenticate callers. `source=field_app` and operator identity are client-supplied, so unauthenticated submissions can be attributed to the field app and an asserted operator. | 9/10 |
| 3 | MEDIUM | `serverless_api/tracking.js`, `serverless_api/_lib/data-store.js`, `field/index.html` | `tracking.js:103-115,181`; `data-store.js:169-181,366-375`; `field/index.html:4123` | Catch deduplication reserves a short-lived marker before persistence. Persistence failure can make retry return 409, which the client treats as synced; the marker does not reference the original catch and is not durable idempotency. | 9/10 |

### Evidence and impact

1. **Unauthenticated catch-log disclosure.** `handleCatchData` calls `getCatchLogs(stationId, 100)` and returns the records. The API wrapper sets wildcard CORS headers (`api/index.js:45-52`), while `isAllowedOrigin` uses prefix/substring matching and accepts requests without an Origin when Host is present (`serverless_api/_lib/security.js:8-22`). This is not a reliable access boundary. Require authenticated authorization for full records, or return an explicitly public, redacted response; use exact parsed-origin matching for browser policy.

2. **Unauthenticated catch submissions and spoofable attribution.** `handleLogCatch` checks origin/method and rate limits but does not call `getAuthUser` or `requireRole`. It classifies a report as field-app data from the request body (`body.source`) and copies operator identifiers from that body. Field review later selects records based on `source === 'field_app'` (`serverless_api/admin/[...path].js:2085-2094`). The field client sends an Authorization header (`field/index.html:4114-4123`), but this handler does not validate it. Authenticate the submission and derive attribution/source from verified server-side identity.

3. **Lossy, non-durable duplicate handling.** `handleLogCatch` calls `checkAndSetDedup(..., 120)` before `appendCatchLog`. The helper uses `SET NX EX`, stores only `'1'`, expires after the TTL, and fails open if KV is absent or errors. `appendCatchLog` separately performs record `SET`, index `LPUSH`, and `LTRIM`. If persistence fails after reservation, a retry can receive 409 without an existing record. The field client marks 200 or 409 as synced. Use a durable idempotency mapping to the original catch and only acknowledge retries when the persisted original is confirmed.

## Confirmed route authorization behavior

- `POST /api?route=analysis` dispatches to `navidur-analysis.js` (`api/index.js:96`). Its handler allows GET/POST and checks origin, but does not authenticate or apply a route-level rate limit (`navidur-analysis.js:258-268`). It appends validation records and can update trait-cycle state (`navidur-analysis.js:361-379`); it is therefore not strictly read-only.
- `POST /api?route=snapshot-capture` / `capture-snapshot` dispatches to `navidur-snapshot.js` (`api/index.js:142`). The handler does not authenticate and uses a 60-per-minute in-memory rate limit (`navidur-snapshot.js:120-125`). It analyzes and persists a station snapshot and validation data.
- Admin station-snapshot, validation-log and snapshot-run-log read routes, plus field review and review-write routes, are guarded by `requireRole('admin')` in the admin handler (`serverless_api/admin/[...path].js:935-940,1871-1925,2085-2237`). `requireRole` is implemented in `serverless_api/_lib/auth.js:193`. The admin summary handler also requires the admin role (`serverless_api/admin/summary.js:160-164`).
- `source: 'field_app'`, client-supplied operator fields, and a browser-provided token are not proof of identity unless validated server-side. Origin controls and rate limits do not replace authentication or authorization. The origin helper accepts absent Origin/Referer when Host is present, and its rate limits are process-local or fail open under KV errors (`security.js:20-22,55-67`; `data-store.js:349-360`).

## Snapshot persistence and verification

- The regular analysis handler calls `analyzeLiveStation` once and produces a DTO (`serverless_api/navidur-analysis.js:307` onward). It does not persist a station snapshot; it appends validation data instead.
- `captureSnapshotInternal` analyzes separately, creates `snapshot_*` and `validation_*` IDs, persists the snapshot and validation record, and returns a DTO (`serverless_api/navidur-snapshot.js:25-110,120-136`). It cannot be called after normal analysis to capture that earlier result without re-running analysis.
- `buildSnapshotRecord` stores a projection of the DTO—environment/recommendation/validation-related summary fields—not the full DTO (`shared/navidur-snapshot-validation.js:326-359`). It derives `analysis_date` from `dto.analysis_timestamp`, while the snapshot `timestamp` is the capture time.
- Existing indexed KV conventions can persist a snapshot through `appendStationSnapshot` and retrieve it with `getStationSnapshots` (`serverless_api/_lib/data-store.js:288-305`). The smallest insertion point for same-execution capture would be after the normal handler's existing analysis result is built, reusing `buildSnapshotRecord` and `appendStationSnapshot`; however, adding this write to the currently unauthenticated analysis route would create an additional unauthenticated persistence path.
- The field app instead generates a client-side `fsnap_*` ID (`field/index.html:2993`) and sends it to catch submission. The catch handler stores it but does not resolve it against canonical snapshot storage. No mapping for historical `fsnap_*` IDs was found.

## Storage and concurrency capabilities

- `data-store.js` uses `@upstash/redis` and supports `get`, `set`, `lpush`, `ltrim`, `lrange`, `mget`, `incr`, `expire`, and the conditional `SET NX EX` pattern (`data-store.js:3,74-88,151-189,366-375`).
- Catch records are individual KV keys indexed by a Redis list. Snapshot records use the same indexed-record convention. `appendCatchLog` is **not** a transaction: record write, list insertion, and trim are separate operations.
- The repository demonstrates an atomic conditional key creation for short-lived dedup reservation, but no implemented compare-and-set, transaction, or atomic multi-key record/index/idempotency operation was established in the reviewed code. Adapter-specific transaction support was not verified.
- No durable idempotency mapping to a catch record exists. `checkAndSetDedup` is TTL-limited, does not return an original record, and fails open.
- Consequently, source code does not establish a durable, failure-safe idempotency guarantee for a catch record plus index plus idempotency mapping. Do not claim one based on `SET NX` alone.

## Smallest safe implementation approach

1. Protect complete catch-log reads and catch submissions with verified authentication/authorization. Derive field-app source and operator identity from the authenticated principal. Apply exact origin matching separately as a browser control.
2. Decide whether field analysis is allowed for anonymous callers. If canonical snapshot persistence is added to analysis, first add an appropriate server-enforced authorization or make persistence an explicitly authenticated field workflow. Persist the already-computed DTO's approved snapshot projection without a second analysis execution; return its canonical ID only when persistence succeeds.
3. At catch submission, resolve the canonical snapshot and validate station and analysis timestamp. Preserve legacy/unmatched records for review, but do not silently associate them with a canonical prediction.
4. Introduce a stable idempotency key and a record-to-result lookup using existing KV storage. Handle the write sequence so retry responses confirm the original persisted catch; conflicting payload reuse must produce an explicit conflict. Do not treat 409 as successful sync unless the server confirms the original record exists.
5. Preserve the existing snapshot/catch stores and admin role guard; no second database is indicated by this source review.

## Unverified deployment/configuration questions

- Whether production configures durable Upstash KV and whether deployment-level controls add authentication, route restrictions, or CORS policy.
- Whether production uses the same environment flags and storage setup as local source.
- Whether any deployed field client or external caller follows a different authentication or ID contract.
- Whether the deployed KV adapter exposes transaction/script support not used or documented by this repository code.

No credentials, tokens, environment values, or private user records were accessed or included.
