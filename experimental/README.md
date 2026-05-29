# experimental/

> **This folder is NOT part of production runtime.**

---

## Purpose

Isolated space for:

- Spikes and prototypes
- Compare-mode scripts (baseline vs candidate)
- One-off operator utilities
- Documentation drafts tied to experiments

---

## Rules

1. **No production imports** — `api/index.js` and serverless handlers must not `require()` from here.
2. **No direct replacement** — winning experiments merge into `shared/` or `serverless_api/` via reviewed PR only.
3. **No secrets** — do not commit tokens; use local `.env.local` (gitignored).
4. **Compare, don’t overwrite** — side-by-side diffs against tagged baselines (`stable-phase-a`, `stable-phase-a-data`).

---

## Compare-Mode Philosophy

| Step | Action |
|------|--------|
| 1 | Fix inputs (station, date, environment fixture) |
| 2 | Run production baseline (tag or live read-only smoke) |
| 3 | Run candidate locally |
| 4 | Diff recommendations and public fields only |
| 5 | Promote only after checklist + tag |

See `docs/architecture/testing-strategy.md`.

---

## Related

- `shared/intelligence-v2/` — versioned shared modules (also non-production until integrated)
- `docs/architecture/runtime-safety-rules.md`
