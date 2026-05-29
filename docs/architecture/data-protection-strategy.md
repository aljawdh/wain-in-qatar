# NAVIDUR — Data Protection Strategy

> **Status:** Phase 3 — policy and architecture direction only.  
> **No file moves, encryption implementation, or runtime changes in this phase.**

---

## 1. Public vs Private Intelligence Separation

| Tier | Audience | Examples (indicative) |
|------|----------|------------------------|
| **Public** | Clients via sanitized DTO | `fishing.fish_recommendations`, `public_navidur_summary`, `decision` summary |
| **Private** | Server-side only | Internal Dur traits, trait bundles, learning adjustments, admin diagnostics |
| **Operational** | Trusted operators | KV contents, audit logs, field session reviews |

**Rule:** Public responses pass through `sanitizePublicNavidurDto` — internal signals must not leak by accident.

> **TODO:** Maintain field allowlist for public DTO per release review.

---

## 2. Future Protection of Behavioral Logic

Long-term goal: separate **what users see** from **how decisions are computed**.

| Direction | Notes |
|-----------|--------|
| Keep tuning logic server-side | No client-side scoring |
| Version behavioral modules | `shared/intelligence-v2/` for next-gen, isolated until integration |
| Avoid documenting algorithm constants in public docs | Architecture docs stay high-level |
| Access control on admin routes | JWT / role separation (document separately) |

No obfuscation commitment in this phase — only architectural boundaries.

---

## 3. Hidden Tuning Philosophy

Operational tuning (ranking boosts, coastal priorities, etc.) is **server-side configuration and code**, not user-editable parameters.

| Principle | Detail |
|-----------|--------|
| Users see outcomes | Scores, species names, reasons |
| Users do not see tuning knobs | No `display_rank_score`, no internal weights in API |
| Changes require release process | Compare-mode + regression + tag |
| Reasons stay environmental | No “because ops priority list” in `reason_ar` |

---

## 4. API Exposure Restrictions

| Allowed without major version | Requires review |
|------------------------------|-----------------|
| New optional fields on existing objects | Renaming fields |
| Same `route=analysis` contract | New routes replacing analysis |
| Additive species metadata in recommendations | Exposing internal trait arrays |

Breaking changes require coordinated UI release and golden refresh.

See `runtime-safety-rules.md`.

---

## 5. Dataset Versioning Principles

| Dataset | Versioning approach |
|---------|---------------------|
| `gulf_fish_database.json` | `version` field in document; tag `stable-phase-a-data` |
| Other `data/*.json` | Increment version or changelog entry when structure changes |
| KV copies | Treat as runtime truth — must match intentional release |

**Rule:** Data PRs state whether KV sync is required post-deploy.

---

## 6. Snapshot Strategy

| Snapshot type | Storage | Sensitivity |
|---------------|---------|-------------|
| Golden (public fields) | `scripts/tests/golden/` | Medium — no secrets; may include species lists |
| Candidate | `scripts/tests/candidates/` | Medium — often gitignored |
| Diff | `scripts/tests/diffs/` | Low — structured deltas |
| Full raw prod capture | Operator secure storage | High — minimize retention |

Redact before committing snapshots to git.

---

## 7. Encrypted Backup Recommendations

For production KV and critical JSON:

| Recommendation | Notes |
|----------------|--------|
| Use provider backup features | Upstash / Vercel per vendor guidance |
| Encrypt exports at rest | Team-managed keys, not in repo |
| Test restore quarterly | Rollback drill |
| Separate backup access from deploy access | Two-person rule for restore (policy TBD) |
| Do not store production KV dumps in public issue trackers | |

> **TODO:** Assign backup owner and retention period.

---

## 8. What This Phase Did Not Do

- No encryption code added
- No file relocations
- No change to `data-store.js` or sanitization logic

---

## 9. Related Documents

| Document | Topic |
|----------|--------|
| `secrets-and-kv.md` | KV model |
| `compare-mode-design.md` | Snapshot comparison |
| `marine-intelligence-roadmap.md` | Future data-heavy features |
| `runtime-safety-rules.md` | Change discipline |
