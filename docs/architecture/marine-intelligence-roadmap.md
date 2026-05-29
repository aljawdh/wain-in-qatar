# NAVIDUR — Marine Intelligence Roadmap

> **Status:** Future architecture vision only — **not implemented**, not scheduled in this document.  
> **Purpose:** Guide safe evolution without binding production behavior.

---

## 1. Roadmap Principles

| Principle | Meaning |
|-----------|---------|
| Isolation first | Prototype under `experimental/` or `shared/intelligence-v2/` |
| Compare before merge | Golden snapshots + diff review |
| Public minimalism | Expand API only deliberately |
| Station truth | FIELD and production observations inform models — with consent and retention policy |
| No silent prod swap | Each capability integrates via tagged release |

---

## 2. Station Memory

**Vision:** Per-station historical context (conditions, outcomes, operator notes) improves recommendations over time.

| Aspect | Future consideration |
|--------|-------------------|
| Storage | Separate KV namespace or dedicated store — not mixed with reference JSON |
| Privacy | FIELD session data governance |
| Use | Bias explanations, not opaque score manipulation |

> **TODO:** Define data model and retention when scoped.

---

## 3. Regional Adaptation

**Vision:** Gulf sub-regions (Qatar coastal, Oman open coast, etc.) adapt priorities without forking entire engine.

| Aspect | Future consideration |
|--------|-------------------|
| Config | Region profiles in data layer, not hardcoded in UI |
| Validation | Regional scenario fixtures in `scripts/tests/scenarios/` |
| Release | Data tags + optional engine tags |

---

## 4. Field Learning

**Vision:** Structured FIELD captures refine trait validation and species activity signals.

| Aspect | Future consideration |
|--------|-------------------|
| Current state | Learning layer flags exist in reference data — production effect TBD per audit |
| Direction | Offline aggregation → reviewed promotions to reference data |
| Safety | No automatic prod write without operator approval |

> **TODO:** Reconcile roadmap with `learning_layer_enabled` behavior when product defines scope.

---

## 5. Species Behavior Graph

**Vision:** Relate species by ecology, co-occurrence, and substitution — supports diversity and explainability.

| Aspect | Future consideration |
|--------|-------------------|
| Source | `gulf_fish_database.json` + future edges table |
| Runtime | Graph informs ranking diversity, not user-visible graph API initially |
| Validation | Compare-mode ensures Top-N stability policies |

---

## 6. Environmental Correlation

**Vision:** Correlate tide, temperature, wave, and seasonal Dur with observed catch patterns.

| Aspect | Future consideration |
|--------|-------------------|
| Data | Intel history, snapshots, cron outputs |
| Output | Confidence adjustments, not deterministic guarantees |
| Docs | High-level public summary only |

---

## 7. Predictive Intelligence

**Vision:** Short-horizon forecasts (e.g. 24–48h) for go/no-go fishing guidance.

| Aspect | Future consideration |
|--------|-------------------|
| Separation | Distinct from live `analyzeLiveStation` — preview/intel routes already partially exist |
| Liability | Clear uncertainty in `public_navidur_summary` |
| Evaluation | Backtest against stored snapshots |

> **TODO:** Reference `navidur-intelligence-preview` boundaries in dedicated doc when scoped.

---

## 8. Satellite / Ocean Integrations

**Vision:** Optional enrichment from satellite SST, chlorophyll, or ocean models (e.g. CMEMS-class sources).

| Aspect | Future consideration |
|--------|-------------------|
| Keys | Environment variables only — never in repo |
| Fallback | System degrades gracefully when marine data missing (existing pattern — verify in audit) |
| Cost | Rate limits and caching strategy |

---

## 9. Suggested Phasing (Indicative)

| Phase | Focus | Production impact |
|-------|--------|-------------------|
| **Current** | Phase A engine + data baselines | Live |
| **Next** | Compare-mode tooling + golden capture | None until used for gate |
| **Future A** | Regional profiles + behavior graph (data-heavy) | Data releases + KV |
| **Future B** | Station memory + field learning loop | New stores + admin |
| **Future C** | Predictive + satellite enrichment | New intel surfaces |

Dates and ownership: **TODO** (product/engineering).

---

## 10. Related Documents

| Document | Role |
|----------|--------|
| `compare-mode-design.md` | Safe validation path |
| `data-protection-strategy.md` | Public/private split |
| `staging-rollout-strategy.md` | How releases roll out |
| `shared/intelligence-v2/README.md` | Isolation folder for prototypes |
