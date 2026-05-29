# Candidate Snapshots

> **Working outputs from compare runs — not approved baselines.**

---

## 1. Purpose

Store **actual responses** produced by a candidate build (branch, preview deploy, or local server) when executing a scenario. Used only for diffing against `../golden/`.

---

## 2. Naming Convention

```text
candidates/<git-short-sha>/<scenario-id>.json
```

Optional variants:

```text
candidates/<branch-name>/<scenario-id>-<timestamp>.json
candidates/preview-<deployment-id>/<scenario-id>.json
```

> **TODO:** Add `.gitignore` rule for `candidates/**` when team policy is set (may stay local-only).

---

## 3. Snapshot Lifecycle

| Stage | Action |
|-------|--------|
| **Generate** | Run compare-mode (future) or manual authorized POST |
| **Diff** | Produce artifact in `../diffs/` |
| **Review** | Classify changes; link to ticket |
| **Discard** | Delete after merge or reject |
| **Promote** | On approval, refresh `../golden/` at new stable tag — not by renaming candidate |

Candidates are **never** copied directly to production.

---

## 4. Rollback Relationship

Candidates do not affect rollback. If a candidate promoted to production fails:

- Roll back deployment — golden for previous tag remains authoritative.
- Preserve failed candidate file only if needed for postmortem (redacted).

---

## 5. Privacy and Safety

- Strip auth headers before save.
- Do not store KV write payloads.
- Redact PII if present in responses.

---

## 6. Related

- `../golden/README.md`
- `../diffs/README.md`
- `experimental/compare-mode/README.md`
