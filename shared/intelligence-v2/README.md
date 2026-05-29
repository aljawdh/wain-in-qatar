# shared/intelligence-v2/

> **This folder is NOT wired to production API routes.**

---

## Purpose

Hold **next-generation** shared modules (intelligence, scoring experiments, trait logic) without disturbing:

- `shared/navidur-analysis-engine.js`
- `shared/navidur-fish-recommendation-engine.js`
- Current production analysis path

---

## Rules

1. **Isolation** — Nothing here is imported by `api/index.js` or live handlers until an explicit integration release.
2. **No silent drift** — Do not copy-paste production files and edit in place; fork with clear naming.
3. **Promotion path** — Integration = PR + new stable tag + `production-checklist.md`.
4. **Compare-mode** — Validate against `stable-phase-a` outputs before merge.

---

## What Belongs Here

- Experimental engines
- Alternative ranking or intelligence layers
- Draft DTO mappers (not used in `navidur-public-dto.js` until approved)

## What Does NOT Belong Here

- Production hotfixes (use tagged release on main production paths instead)
- Secrets or environment-specific config

---

## Related

- `experimental/` — scripts and tooling
- `docs/architecture/runtime-safety-rules.md`
- `docs/architecture/testing-strategy.md`
