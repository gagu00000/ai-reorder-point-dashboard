# Verification Log

Evidence that each part computes what it claims. Every number below comes from code in this repository:
`notebooks/` (Python reference) or `dashboard/tests/` (browser implementation, `npm test`).

---

## Part 1 — Data and forecasting models

| Check | Result |
|---|---|
| Lead times recovered from the inventory ledger | 28,831 / 28,893 orders matched (99.8%); browser and Python agree exactly |
| Leakage guard | `series.json` contains no Price / Competitor Pricing; test fails if one appears |
| Ridge (browser) vs scikit-learn | max coefficient difference 1.2e-14 |
| ETS recursions vs statsmodels | identical (difference 0.0); browser optimiser reaches statsmodels' SSE or better |
| LSTM: Keras → TensorFlow.js | predictions agree to < 1e-5 (scaled units); fine-tuning runs in the browser |

**Validation leaderboard (100 SKUs × 11 rolling origins × 14 days), notebook vs browser:**

| Model | WAPE (notebook) | WAPE (browser) |
|---|---|---|
| Ridge | 29.0115% | 29.0115% |
| LSTM | 29.3889% | 29.3889% |
| Static mean (baseline) | 33.2946% | 33.2946% |
| ETS | 33.6725% | 33.6718% |
| MA-28 | 35.4165% | 35.4165% |
| Naive | 41.0708% | 41.0708% |

**Holdout (never used for tuning), 1 day ahead:** Ridge 26.6% WAPE vs static mean 37.0% (Diebold–Mariano p < 0.001).

---

## Part 2 — Dynamic safety stock and Monte Carlo

### Slide formula: hand calculations reproduced

| Case | Safety stock | Reorder point |
|---|---|---|
| S001-P0001: D̄ 92.8145, σ_D 35.5362, L 2, σ_L 0.9727, 95% | **169.95** | **355.58** |
| Phase 1 worked example: D̄ 137.31, σ_D 108.19, L 7, σ_L 2, 95% | **652.46** | **1,613.60** |
| Special cases | σ_L = 0 → Z·σ_D·√L; σ_D = 0 → Z·D̄·σ_L (exact) | |

### Monte Carlo vs the formula (S001-P0001, S001 supplier pool, 200,000 trials)

| Quantity | Notebook (NumPy) | Browser (TypeScript) | Theory |
|---|---|---|---|
| Mean demand during lead time | 147.59 | within 1% | D̄·E[L] = 147.54 |
| Std. dev. | 100.66 | within 1% | √(σ_D²·E[L] + D̄²·Var L) = 100.78 |
| Skewness | 1.41 | 1.3–1.5 | (Normal assumes 0) |
| Safety stock for 95% | 224.4 | within ±4 | formula: 165.8 |
| Stockout probability at the formula's ROP | 9.5% | within ±0.4 pp | target 5% |

The formula's variance is exact. The tail is not: right-skewed lead times make the Normal approximation under-protect.

### Holdout replay: 100 SKUs × 60 unseen days (2023-12-02 → 2024-01-30)

Actual demand, stochastic lead times (Gamma with each SKU's L and its store's σ_L), 30 common-random-number
replications, target cycle service 95%, order quantity = EOQ for every policy, lost sales.
Regenerate with `npm run report:holdout` (writes `docs/results/holdout_replay.{md,json}`).

| Policy | Cycle service | Fill rate | Stockout days | Avg on-hand (all SKUs) | Shortage cost | Total cost |
|---|---|---|---|---|---|---|
| As-is (historical ordering) | n/a | 94.39% | 11.25% | 29,851 | 810,627 | 1,003,194 |
| Baseline formula (static history) | 76.9% | 96.12% | 5.34% | 49,675 | 665,461 | 845,065 |
| Baseline + Monte Carlo | 79.9% | 96.77% | 4.46% | 52,078 | 543,625 | 730,205 |
| AI formula (adaptive daily forecast) | 76.9% | 96.37% | 5.10% | 48,696 | 604,727 | 782,237 |
| **AI + Monte Carlo (adaptive)** | **79.3%** | **96.83%** | **4.45%** | **50,506** | **521,478** | **704,418** |

Reading:
- **Forecasting:** forecast-error σ_D averages 34.9 units/day vs 42.9 for raw history (−19%). With similar stock, the adaptive AI policy loses less demand than the static baseline.
- **Monte Carlo:** raises the reorder point where demand during lead time is skewed. It cuts shortage cost by 14–18% in both designs.
- **Combined:** AI + Monte Carlo costs 16.6% less than the baseline calculator and 29.8% less than the historical ordering, with stockout days down from 11.3% to 4.5%.
- **Limitation found:** no formula-based design reaches the 95% cycle target. The cause is reorder undershoot in a daily-review system. When an order triggers, the inventory position is on average **70.8 units below the reorder point**, about a third of the 208-unit mean safety stock. Adding the textbook undershoot correction only lifts service from 0.79 to 0.85, because holdout demand also differs from history. The formula sizes the buffer for demand during lead time only. **Step 3 handles this:** Bayesian optimisation tunes the reorder point against the full policy simulation, with service level as an explicit constraint.

---

## Part 3 — Bayesian optimisation

### Engine checks

| Check | Result |
|---|---|
| Sobol sequence | standard 2-D points reproduced; 256 points split evenly into quarters on every axis |
| Gaussian process (Matérn 5/2 ARD) vs scikit-learn, fixed kernel | posterior mean to 1e-8, sd to 1e-7, log marginal likelihood to 1e-7 |
| Expected improvement / probability of feasibility | closed-form values (σ·φ(0) at the incumbent; Φ(−μ/σ)) |
| Branin benchmark (global minimum 0.397887) | < 0.45 within 40 evaluations, better than random search with the same budget |
| Constrained toy problem: min (x − 0.8)² s.t. x ≤ 0.5 | converges to the constraint boundary (x ∈ (0.47, 0.5]) |

### BO vs the manual parameter sweep

Optimising reorder point r and order quantity Q for annual cost, each candidate scored by the daily
simulation (365 days × 8 demand scenarios, common random numbers), subject to cycle service ≥ 95%.
Measured on 10 SKUs × 2 seeds against an exhaustive 30 × 30 grid (900 simulations):

| Budget (simulations) | Share of grid effort | BO gap to grid best: median / 90th pct / max | Random search, same budget: median |
|---|---|---|---|
| 25 | 2.8% | 1.47% / 3.51% / 4.76% | 7.94% |
| 35 | 3.9% | 0.85% / 2.38% / 3.51% | 4.12% |
| **45 (default)** | **5.0%** | **0.00% / 1.47% / 3.51%** | 4.12% |
| 60 | 6.7% | 0.00% / 1.47% / 2.98% | 3.10% |

The grid itself is coarse: its 5th-best point is typically 1.7% above its best. A BO gap of about 1% is
therefore within the grid's own resolution.

Constraint behaviour (tested on S001-P0001):
- At default costs the cost-optimal policy already exceeds 95% service: lost margin (40% of price per unit) is far dearer than holding (25% of price per unit per *year*).
- With shortage cost cut to 2%, the service constraint binds: service lands between 95% and 98.5%.
- A storage cap at 85% of the unconstrained peak is respected.
- One-dimensional mode (Q fixed) works.

Sensitivity views:
- The GP surrogate surface and the acquisition slice are instant (no new simulations).
- The policy tornado re-simulates the recommendation with each input ±20%, ranked by swing.
- The service-target curve reuses earlier simulations: each extra target costs only 12 new ones, and cost rises monotonically with the target.

### Holdout replay with optimised policies (100 SKUs × 60 unseen days)

From `docs/results/holdout_replay.md` (`npm run report:holdout`, 175 s). BO is planned at the end of the validation
window (budget 45, constraint: cycle service ≥ 95%). Nothing was tuned on the holdout.

| Policy | Cycle service | Fill rate | Stockout days | Avg on-hand | Total cost | vs baseline |
|---|---|---|---|---|---|---|
| As-is (historical) | n/a | 94.4% | 11.2% | 29,851 | 1,003,194 | +18.7% |
| Baseline formula | 76.9% | 96.1% | 5.3% | 49,675 | 845,065 | — |
| Baseline + MC | 79.9% | 96.8% | 4.5% | 52,078 | 730,205 | −13.6% |
| AI formula (adaptive) | 76.9% | 96.4% | 5.1% | 48,696 | 782,237 | −7.4% |
| AI + MC (adaptive) | 79.3% | 96.8% | 4.4% | 50,506 | 704,418 | −16.6% |
| BO on baseline demand | **93.0%** | **98.7%** | **1.7%** | 73,539 | **438,541** | **−48.1%** |
| BO on AI demand | 91.8% | 98.5% | 2.0% | 71,718 | 466,461 | −44.8% |
| AI adaptive + BO (full) | 90.2% | 98.3% | 2.2% | 68,317 | 484,340 | −42.7% |

Reading:
- **BO delivers the largest gain.** It prices in what the formula ignores (reorder undershoot, lost sales and the cost trade-off). Its reorder points average 1.55× the formula's, with Q close to EOQ (1.02×). The extra holding cost is repaid many times over in avoided shortages. It beats the baseline formula on 96 of 100 SKUs.
- **Forecasting's contribution depends on the period.** With formula and Monte Carlo policies, the adaptive forecast lowers cost: AI formula −7.4% vs the baseline formula, and AI + MC −16.6% vs −13.6% for baseline + MC. With BO, planning on static history did slightly better on this holdout. The forecast's tighter error band led BO to a smaller buffer, and the holdout contains a regime shift: the December peak, then the epidemic from 27 December, which forecasts made on 1 December could not anticipate. The static-history noise includes past epidemics and promotions, so it buffers more robustly against such shocks.
- **Planned vs realised service.** BO planned about 98.9% median cycle service but realised 90–93% under that shift. That is still far closer to target than the formula policies (77–80%), but below 95%. In the dashboard, re-optimising as new data arrives (Part 5) is the intended remedy.
