# Golden Snapshots

> **Approved baselines only.** No golden files are committed in the initial framework phase unless operators capture and approve them.

---

## 1. Purpose

Golden snapshots record **accepted public behavior** for a scenario at a specific stable tag. They are the “expected” side of compare-mode and regression review.

---

## 2. Naming Convention

```text
golden/<stable-tag>/<scenario-id>.json
```

Examples (placeholder):

```text
golden/stable-phase-a-data/katara-normal.json
golden/stable-phase-a/katara-normal.json
```

Optional metadata file:

```text
golden/<stable-tag>/<scenario-id>.meta.json   ← capture time, commit, author
```

> **TODO:** Adopt schema version field inside each golden file.

---

## 3. Snapshot Lifecycle

| Stage | Action |
|-------|--------|
| **Capture** | Authorized smoke against staging or read-only prod; save public fields |
| **Review** | Second person approves golden content |
| **Commit** | Add to git when redaction policy allows |
| **Use** | Compare candidate runs in `../candidates/` |
| **Retire** | Move to `golden/_archive/<tag>/` when superseded |

Do not overwrite golden files without a release note and tag update.

---

## 4. Rollback Relationship

Golden snapshots align with **stable tags**, not with “whatever is live right now.”

If production is rolled back:

1. Roll back deployment/KV per `versioning-and-rollbacks.md`.
2. Ensure golden files match the rolled-back tag (or re-capture).
3. Re-run compare-mode before next deploy.

---

## 5. Contents (Public Fields Only)

See `../baselines/README.md` — same golden snapshot concept.

> **TODO:** Add first golden after operator sign-off on P0 scenario.

---

## 6. Related

- `../scenarios/`
- `../candidates/README.md`
- `../diffs/README.md`
- `docs/architecture/regression-verification.md`
