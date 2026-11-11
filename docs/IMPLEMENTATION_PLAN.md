# AI-Enhanced Reorder Point & Inventory Management — Phase 2

**Course:** AI in Operations (MAIB, SP Jain) · **Exercise:** Session II — AI Applications in Reorder Point & Inventory Management
**Status:** Plan for approval. No development code has been written.
**Dataset:** `sales_data.csv` — [Retail Store Inventory and Demand Forecasting (atomicd)](https://www.kaggle.com/datasets/atomicd/retail-store-inventory-and-demand-forecasting), Apache 2.0, version 8 (May 2025).

---

## Part A — Dataset Inspection Report

### A0. Why not the original file

`retail_store_inventory.csv` (the original anirudhchauhan release) was audited first and **rejected**:

- Season, category, region and weather labels are random per row.
- Demand shows no autocorrelation and no promotion effect (136.42 vs 136.51 units).
- Its Demand Forecast column is built from actual sales (r = 0.997).
- Inventory and orders are independent random numbers.

No model could learn anything from it. It stays in the folder (git-ignored) only as an audit record.

### A1. Structure

| Item | Finding |
|---|---|
| Shape | 76,000 rows × 16 columns |
| Grain | Daily × 5 stores × 20 products = **100 SKU series × 760 days each** |
| Dates | 2022-01-01 → 2024-01-30, no missing days |
| Missing values / duplicates | None / none (no duplicate Date–Store–Product keys) |
| Stores → region | S001 North, S002 South, S003 East, S004 West, S005 North |
| Columns | Date, Store ID, Product ID, Category, Region, Inventory Level, Units Sold, Units Ordered, Price, Discount, Weather Condition, Promotion, Competitor Pricing, Seasonality, Epidemic, **Demand** |
| Demand | Mean 104.3 units/day (range 4–430). Per-SKU mean 72–125. Per-SKU coefficient of variation 0.35–0.52 |

### A2. Consistency checks (all pass)

| Check | Result |
|---|---|
| Category and Region per SKU | Exactly 1 each (consistent) |
| Weather | One value per store per day; varies across regions |
| `Seasonality` vs calendar | Exact Northern-hemisphere seasons (Dec–Feb Winter, Mar–May Spring…) |
| `Epidemic` | One value per day for all SKUs; **6 episodes** (13–33 days, 152 days in total) |
| Negative values | None |

### A3. Demand drivers (what the models can learn)

Measured with a log-demand regression with SKU fixed effects (Price excluded; see A4). These are average multiplicative effects:

| Driver | Effect on demand | Evidence |
|---|---|---|
| **Epidemic** | **−44%** (log coefficient −0.575) | Raw mean 112.9 → 70.2 units |
| **Promotion** | **+30%** (log coefficient +0.260) | Within-SKU uplift 23.5–37.3% |
| **Weather** | Sunny +10%; Rainy/Snowy −10% (vs Cloudy) | Raw means 115.2 vs 94.1 |
| **Month (seasonality)** | Summer (Jun–Aug) +5–7% | Month ANOVA p = 3e-44 |
| **Category** | Groceries 121 vs Furniture 74 units/day | Captured by SKU level |
| Day of week | **None** (ANOVA p = 0.996) | No weekly cycle |
| Autocorrelation | Aggregate lag-1 0.83 (driven by epidemic and season regimes); per SKU lag-1 0.24, lag-7 0.17 | Moderate persistence |
| Discount | **Redundant with Promotion**: every discount ≥ 15% is a promotion, and promotions always carry ≥ 10%. No effect beyond Promotion | Use Promotion; show discount depth as information only |

### A4. Data problems found, and how they are handled

| Problem | Evidence | Handling |
|---|---|---|
| **Price is computed from same-day demand (target leakage)** | Within-SKU corr(Price, Demand) = +0.80, at monthly level +0.98. Adding log(Price) doubles R² (0.41 → 0.82), collapses the epidemic effect (−0.58 → −0.19) and implies a price "elasticity" of +2.7 (economically backwards). Price tracks same-day demand (0.80) far more than next-day demand (0.22, explained by demand's own autocorrelation) | **Excluded from forecasting features.** The per-SKU median price is still used as a cost parameter (holding cost, margin) |
| **Competitor Pricing is a near-copy of Price** | r = 0.977 | Excluded for the same reason |
| Note on published results | The [192cm project](https://192cm.github.io/en/projects/retail-demand-forecasting.html) (10% MAPE) relied heavily on price features | Their accuracy is likely inflated by this leakage. We report honest, leakage-free accuracy |
| **Units Sold is censored by stock** | Sold = Inventory on 11.4% of days (stockouts); Demand > Inventory on 10,394 rows | **Forecast target = `Demand`** (uncensored), not Units Sold |
| `Demand` vs `Units Sold` don't reconcile exactly | Sold = min(Demand, Inventory) on only 12% of rows; Demand − Sold = 15.5 ± 26.4 | Treated as a synthetic-data artefact; documented. `Demand` is the planning signal |
| Future exogenous values aren't truly known ahead | — | **Promotion:** planned, so known ahead (legitimate). **Weather:** actuals used as a stand-in for a short-range forecast (stated). **Epidemic:** persistence (yesterday's state) in backtests, plus a scenario toggle on the dashboard |

### A5. Lead time recovered from the data

Inventory closes exactly as: opening stock[t+1] = opening stock[t] − Units Sold[t] + receipts.

Matching every order to the first later receipt of the **same quantity**:

| Result | Value |
|---|---|
| Orders matched | **28,831 of 28,893 (99.8%)**; no unexplained receipts |
| Lead-time distribution (days) | 1: 56% · 2: 19% · 3: 15% · 4: 10%. Mean 1.79, sd 1.03 |
| Per SKU | **Fixed** (sd = 0 within each SKU): each SKU has its own 1–4 day lead time |
| Per store (pooled across its SKUs) | S001 1.59 ± 0.97 · S002 2.07 ± 1.10 · S003 1.89 ± 1.10 · S004 1.76 ± 1.01 · S005 1.73 ± 0.94 |
| Over time | Stable (2022: 1.80, 2023: 1.79, 2024: 1.76); no epidemic effect |
| Historical (as-is) ordering | An order every 2.6 days on average (median order 159 units); stockouts on 11.4% of SKU-days |

**Modelling decision:**
- **L** = the SKU's empirical lead time.
- **σ_L** = the SKU's store-level pooled sd (0.94–1.10 days).
- **Why σ_L comes from the store pool:** within a single SKU the generator uses a constant lead time, which would give σ_L = 0 and switch off half of the slide's formula. The store pool is the observed variability of that store's supplier lanes. This is an **explicit, documented assumption**, and σ_L stays adjustable with a slider.
- The Monte Carlo lead-time distribution keeps the store pool's right-skewed shape, centred on the SKU's L.

### A6. Hand calculation of the slide formula

SKU S001-P0001, full history, 95% cycle service level:

| Quantity | Value |
|---|---|
| D̄ (units/day) | 92.8145 |
| σ_D (units/day) | 35.5362 |
| L (days, from data) | 2 |
| σ_L (days, S001 pool) | 0.9727 |
| Z = Φ⁻¹(0.95) | 1.644854 |
| σ_D² · L | 1,262.82 × 2 = 2,525.65 |
| D̄² · σ_L² | 8,614.53 × 0.94614 = 8,150.43 |
| √(sum) | √10,676.08 = 103.3251 |
| **Safety Stock** | 1.644854 × 103.3251 = **169.95 units** |
| **ROP = D̄·L + SS** | 185.63 + 169.95 = **355.58 units** |

Lead-time uncertainty is **76% of the variance** here. A calculator that ignores σ_L would hold only 82 units of safety stock instead of 170.

**Monte Carlo cross-check** (200,000 trials; daily demand bootstrapped from history; L drawn from the S001 empirical pool, mean 1.59):
- Demand during lead time: simulated mean 147.59 against 147.54 in theory. Simulated sd 100.66 against 100.78 from the formula. **The formula's variance term is exactly right.**
- Demand during lead time is strongly right-skewed (skewness 1.41, because of 4-day lead times). The simulated 95% quantile needs SS = **224**, while the formula gives **166**. At the formula's ROP the simulated stockout probability is **9.5%, not 5%**.

**This is the central reason for Monte Carlo:** the formula gets the variance right but assumes a Normal tail, and with lumpy lead times it under-protects by roughly 2×.

### A7. Preliminary forecastability check

Last 60 days held out (2023-12-02 → 2024-01-30, which includes a 13-day epidemic), all 100 SKUs, one day ahead, WAPE:

| Model | WAPE |
|---|---|
| Static historical mean (baseline calculator) | 33.7% |
| Naive (yesterday's demand) | 40.7% |
| 28-day moving average | 34.4% |
| **Ridge** (promotion, weather, epidemic persistence, lags, month, SKU) — no price | **27.8%** |

Forecast-error sd is **15% lower** than the baseline's (36.4 vs 42.9). This lowers σ_D in the AI-enhanced safety stock, so the same service level needs less stock.

Per-SKU daily noise is high (it's synthetic data), so a realistic target is about **25–28% WAPE**. Claims of 10% are not credible without leakage.

### A8. Preparation pipeline

1. Sort by SKU and date. SKU = Store × Product (100 series).
2. **Target = `Demand`.** Keep `Units Sold` and the stockout flag for the as-is policy replay.
3. Features:
   - Promotion; Epidemic (as-is, plus lag-1 persistence variant); weather one-hot.
   - Month and yearly Fourier terms.
   - Lags 1, 7, 14; rolling means 7 and 28 (all shifted, so no look-ahead).
   - SKU, store and category identity.
   - **Price and Competitor Pricing are dropped from the features.**
4. Lead-time table: per-SKU L and per-store pooled empirical distribution (from A5).
5. Cost table: per-SKU median price → holding cost and margin.
6. **Time-ordered split:**
   - Train: up to 2023-09-02.
   - Validation: 2023-09-03 → 2023-12-01 (rolling-origin backtests).
   - Holdout: 2023-12-02 → 2024-01-30 (60 days), **withheld and replayed as "new data arriving"** in the dashboard.
7. **Units:** demand in units/day, lead time in days, costs per unit per year (converted to daily inside simulations). Never mixed.

---

## Part B — Implementation Plan

### B1. System architecture: where each computation runs

**Decision: a 100% client-side application. Static Vite build on Netlify, all heavy computation in browser Web Workers, no serverless functions.**

```
┌──────────────────────────── Browser ──────────────────────────────┐
│  Main thread (React UI)                                            │
│   • renders charts, handles controls, never computes heavy stuff   │
│        │  Comlink RPC (typed, cancellable job IDs)                 │
│        ▼                                                           │
│  forecast.worker ── ETS, Ridge regression, LSTM (TF.js),           │
│                     backtests, incremental updates on new data     │
│  sim.worker ─────── Monte Carlo (lead-time demand, inventory sim)  │
│  optimize.worker ── Bayesian optimization (GP + constrained EI)    │
│                                                                    │
│  IndexedDB ── user-added data + model state (persists per browser) │
└────────────────────────────────────────────────────────────────────┘
         ▲ static assets only (JS, CSS, compact data JSON, LSTM weights)
   Netlify CDN (free tier)
```

| Computation | Runs where | Why |
|---|---|---|
| Cleaning, feature build, lead-time extraction | Offline Python script → compact JSON (build time). Feature logic is re-implemented in TS for newly added rows | Small bundle; added rows go through identical feature code (parity-tested) |
| Baselines, ETS, Ridge regression | **Browser worker**, fully trained in-browser | Closed-form or O(n) fits on ≤ 760 points take milliseconds |
| LSTM — initial training | **Offline** in a Python notebook (Keras, TF 2.21 installed). One global model across all 100 SKUs; weights exported to JSON | Training a global LSTM takes minutes and should not run on every page load. **This is the only precomputed part** |
| LSTM — updating on new data | **Browser worker**, TensorFlow.js (WebGL backend, WASM/CPU fallback): fine-tunes for a few epochs on the latest windows | A genuine on-arrival update: the model in the browser changes as data arrives |
| Monte Carlo (10k–50k trials) | **Browser worker**, typed arrays, seeded PRNG | About 50 ms for 20k trials. Results stream progressively (2k quick pass, then 20k refined) |
| Bayesian optimization (30–40 evaluations, each a 365-day simulation × K replications) | **Browser worker** | 2-dimensional problem; GP on ≤ 40 points; a few seconds |

**Why not Netlify Functions:**
- The free tier has a 10-second timeout and invocation limits, plus cold starts.
- None of this workload needs a server.
- Keeping everything in the browser also means **user-added data never leaves the user's machine**, which fits "No sharing of data with peers".

**Honest trade-offs:**
1. The LSTM's starting weights are precomputed offline. In the browser it is fine-tuned, not retrained from scratch.
2. Data added by one visitor persists only in that visitor's browser (IndexedDB). There is no shared database, by design.
3. LSTM fine-tuning is slower on low-end phones. It runs in a worker with a progress indicator, so the UI never freezes.

**Data deployment (the "no sharing" note):**
- The GitHub repo is **private** (Netlify's free tier supports private repos).
- Raw CSVs are **git-ignored**.
- The deployed site ships only a compact derived JSON (Demand plus non-leaky features for 100 SKUs, lead-time and cost tables, about 1 MB gzipped) so the demo works immediately.
- A "Load your own CSV" option runs everything on data loaded locally. A build flag (`VITE_BUNDLE_DATA=false`) produces a deployment that ships **no data at all**, if you prefer that.

### B2. Demand forecasting (Step 1)

**Models compared (per SKU, same non-leaky features, same backtest):**

| # | Model | Type (slide wording) | Purpose |
|---|---|---|---|
| 0 | Static historical mean | — | **Baseline calculator** input |
| 1 | Naive (yesterday's demand) and 28-day moving average | Time series | Naive benchmarks; MASE is scaled against these |
| 2 | Exponential smoothing (ETS): simple / Holt damped, chosen by AIC | **Time series** | Classical statistical model. A weekly season is tested but expected to be dropped, since the audit found no weekday effect |
| 3 | Ridge regression on lags (1, 7, 14), rolling means (7, 28), month and Fourier terms, promotion, weather, epidemic | **Regression** | Captures promotions and external factors. Its coefficients become plain-language drivers ("a promotion adds ~30%") |
| 4 | Global LSTM (28-day window + exogenous features → 14-day horizon) | **LSTM** | Deep learning across all SKUs |
| 5 | Inverse-error weighted ensemble of models 2–4 | — | Usually the most robust choice |

**Evaluation:**
- Rolling-origin backtest over the validation window (refit at each origin; horizons of 1, 7 and 14 days).
- Metrics:
  - MAE and RMSE (units).
  - **WAPE** (headline metric; MAPE is also shown but is unstable when demand is low).
  - sMAPE.
  - MASE (below 1 beats naive).
  - Bias (systematic over- or under-forecasting).
- A leaderboard on the dashboard ranks the models. A Diebold-Mariano test shows whether the best model is significantly better than the runner-up.
- **Expected outcome (from A7):** about 28% WAPE for the regression and AI models against about 34% for the static mean. Reported as measured, not rounded up.

**Uncertainty bands:**
- Empirical (conformal-style) 80% and 95% intervals from backtest residuals, per horizon. They widen honestly as the horizon grows.
- **The standard deviation of forecast errors over the lead time becomes σ_D for the AI-enhanced safety stock.** This links Steps 1 and 2: a better forecast means a smaller σ_D, which means less safety stock for the same service level.

**Adding new data, and continuous updates:**
- Three ways to add data:
  - A **single-day entry form** (date, demand, units sold, promotion, weather, epidemic; price optional, cost use only).
  - **CSV append** (schema-validated with zod, previewed before committing).
  - **"Stream next day"** and **"Auto-stream"** buttons that replay the 60-day holdout one day at a time, as if it were arriving live. The holdout includes the Dec 2023 epidemic shock, which shows how quickly each model adapts.
- On each arrival, in the worker:
  1. Validate the row and append it. Persist to IndexedDB.
  2. Score each model's *previous* forecast for that day. This is genuine out-of-sample accuracy, tracked over time.
  3. Update ETS state (incremental), refit Ridge (milliseconds), fine-tune the LSTM (3 epochs on recent windows), and re-weight the ensemble.
  4. Recompute forecasts and bands, then safety stock, ROP and Monte Carlo. Bayesian optimization re-runs on demand, or automatically if enabled.
- A visible **update log** ("Forecast v14 · 3 s ago · WAPE 28.4% → 27.9%") and a chart of rolling accuracy against the number of points added.
- A "Reset to original data" button.
- **Scenario inputs for the future:** a planned promotion calendar, weather outlook, and epidemic on/off. Managers can ask "what if we promote next week?"

### B3. Dynamic safety stock and Monte Carlo (Step 2)

**Formula, implemented exactly as on the slide:** `SS = Z · √(σ_D² · L + D̄² · σ_L²)` and `ROP = D̄ · L + SS`.

| Input | Historical (as-is) policy | Baseline calculator | AI-enhanced |
|---|---|---|---|
| Source | Replayed from the data's own orders | Slide formula, static inputs | Slide formula + Monte Carlo + Bayesian optimization |
| D̄ | — | Mean of all history | Mean of the **forecast** over the next L days (moves with promotions, season, epidemic, weather) |
| σ_D | — | Std dev of all history | Std dev of **forecast errors** (rolling, updated as data arrives) |
| L | Actual (from data) | SKU lead time (from data) | SKU lead time (from data) |
| σ_L | — | Store pool sd (from data) | Store pool sd, with the full empirical distribution used in Monte Carlo |
| ROP | — | Formula | Monte Carlo-corrected formula, then cost-optimal ROP from Bayesian optimization |

**Lead-time model:**
- From data (A5): per-SKU L, and the store's empirical lead-time distribution shifted to centre on the SKU's L (truncated at ≥ 1 day).
- The **realised mean and sd of the distribution actually sampled** are what feed the formula, so formula and Monte Carlo are always compared on identical inputs.
- What-if mode: sliders switch to a parametric **Gamma(L, σ_L)** distribution, discretised to whole days.

**Monte Carlo engine:**
- **Demand during lead time** (default 20,000 trials): sample L; sum daily demand over L days. Each day's demand is the forecast mean plus a residual **bootstrapped from recent forecast errors** (keeps real skew), floored at 0. A Normal-residual toggle is available for comparison.
- **Outputs:**
  - Histogram of demand during lead time, with the ROP line and the stockout tail shaded.
  - P(stockout per cycle).
  - Expected units short per cycle.
  - Fill rate.
  - Monte Carlo safety stock = (service-level quantile − mean).
  - **Formula SS vs Monte Carlo SS**, with an automatic explanation of the gap (as in A6: 166 vs 224).
- **Variance decomposition bar:** how much of the buffer is due to demand uncertainty and how much to lead-time uncertainty (76% lead time for S001-P0001).
- **Inventory-level simulation** (daily, continuous review (s, Q) policy, stochastic lead times, **lost sales**, matching the data's censoring):
  - Replays the holdout period for three policies: **as-is (from data), baseline, AI**.
  - Shows on-hand stock, ROP line, orders placed and received, and stockout markers.
  - Reports fill rate, stockout days (as-is: 11.4%), average inventory, orders, and total cost.
- Common random numbers are used across policies so the comparison is fair.

### B4. Bayesian optimization (Step 3)

**Decision variables:**
- Reorder point **r**.
- Order quantity **Q**, with range [0.5 × EOQ, 3 × EOQ], also bounded by the data's observed 50–1,616 units.
- A "ROP only" mode (Q fixed) gives a clear one-dimensional view.

**Objective:** minimise expected annual cost = holding (h × average on-hand) + ordering (S × number of orders) + shortage (p × units of lost demand). Each cost is estimated by a 365-day Monte Carlo inventory simulation with common random numbers.

Default cost parameters (assumptions, adjustable):
- h = 25% of the SKU's median price per year.
- S = 50 per order.
- p = unit margin (40% of median price).

**Constraints (interactive controls):**
1. Service level: fill rate ≥ target **or** cycle service level ≥ target (user chooses which).
2. Inventory budget: average inventory value ≤ budget.
3. Storage capacity: maximum on-hand ≤ capacity in units (default from the data's maximum observed inventory per SKU).
4. Supplier limits: MOQ ≤ Q ≤ maximum order. Default MOQ = the SKU's smallest historical order; no maximum unless the user sets one (the historical maximum proved too restrictive, e.g. capping S005-P0020 at 244 units against an EOQ of 728).

**Algorithm (implemented in TypeScript):**
- Gaussian-process surrogate (Matérn 5/2, automatic relevance determination, noise term). Hyperparameters fitted by maximising the log marginal likelihood with multiple starting points.
- Separate GP models for each simulation-based constraint.
- **Constrained Expected Improvement** = EI × Π P(constraint satisfied).
- Starting design: 6 Sobol points. Budget: 45 evaluations by default (measured: median gap to a 900-point grid 0.0%, 90th percentile 1.5%), maximised over a dense Sobol candidate set.
- Hard constraints (capacity, supplier limits) shrink the search space directly.

**Validation:**
- Unit test on the Branin benchmark function (known optimum).
- On the dashboard, a brute-force 30 × 30 grid (900 simulations) runs as a "ground truth" check. Bayesian optimization reaches the grid's optimum (within the grid's own resolution) in 5% of the evaluations. This is the evidence that it replaces manual sweeps.

**Sensitivity views (powered by the GP surrogate, so they are instant):**
- **Convergence chart:** best feasible cost against iteration, compared with random search.
- **1D GP view:** posterior mean, ±2σ band, evaluated points and the acquisition curve over r.
- **3D surrogate surface** (WebGL via echarts-gl) of cost over (r, Q), with the infeasible region masked and the optimum marked. **This is the one place WebGL clearly adds value.**
- **Tornado chart:** ROP and cost swing for ±20% on D̄, σ_D, L, σ_L, h, p and service level.
- **Optimal ROP against service-level target** curve (warm-started Bayesian optimization runs), showing the steep cost of the last few percent of service.

### B5. Dashboard pages and visuals

| # | Page | Key visuals and controls |
|---|---|---|
| 1 | **Control Tower** (overview) | SKU and store selector; KPI tiles for **as-is vs baseline vs AI** (ROP, SS, service level achieved, expected cost, stockout risk, inventory change); a "What this means" narrative; mini forecast and inventory sparklines; data-freshness badge |
| 2 | **Demand Forecasting** | Forecast vs actual with 80/95% bands and model toggles; epidemic periods shaded; model leaderboard; driver effects (promotion, epidemic, weather, month, from Ridge); residual diagnostics; **Add Data panel** (form, CSV, stream); update log and rolling-accuracy chart; future scenario inputs |
| 3 | **Safety Stock & Monte Carlo** | Live formula card with each number substituted (the hand calculation, visible); variance decomposition; empirical lead-time distribution; demand-during-lead-time histogram with ROP and shaded stockout tail; formula vs Monte Carlo comparison; controls for service level, L, σ_L, trial count, residual model |
| 4 | **Inventory Simulation** | Inventory level vs ROP over time (as-is vs baseline vs AI, synchronised); orders and receipts; stockout markers; scorecard (fill rate, stockout days, average inventory, cost); play/pause replay |
| 5 | **Optimization & Sensitivity** | Constraint panel; Bayesian optimization run with live step animation; convergence chart; 1D GP and acquisition view; 3D cost surface; tornado; ROP vs service-level curve; grid-search comparison |
| 6 | **Method & Assumptions** | Data audit (Part A, including the leakage findings), assumptions register, metric definitions, **traceability table**, honest limitations |

**Plain-language explanations:** every chart carries a "What this means for an operations manager" caption generated from live numbers. For example: *"The textbook formula suggests 166 units of safety stock, but because 1 in 10 deliveries takes 4 days, you would run out on about 1 in 10 order cycles. Holding 224 units brings that back to the 5% target."*

### B6. Visual design language

- **Theme: "Warehouse Control Tower" (dark).**
  - Deep graphite and navy base (`#0A0F1C`).
  - A subtle blueprint grid in the background, hinting at a racking floor plan.
  - Glassmorphism panels: translucent fill, `backdrop-blur`, 1px light border, soft inner glow.
- **Semantic colours, used the same way on every chart:**
  - Cyan for AI and forecast.
  - Amber for baseline.
  - Slate for actual data and the as-is policy.
  - Rose for stockout and risk; also used for epidemic shading.
  - Emerald for service level and safe zones.
  - Violet for optimization.
  - Each also has a distinct shape or dash so meaning doesn't depend on colour alone.
- **Typography:** Inter for the UI; JetBrains Mono with tabular figures for numbers and formulas.
- **Motion (Framer Motion), purposeful only:**
  - Staggered panel entrance.
  - Animated number tickers when a KPI changes.
  - A brief highlight pulse when new data updates a chart.
  - Animated Bayesian optimization steps.
  - Page transitions.
  - Respects `prefers-reduced-motion`.
- **Responsive:** 12-column grid on desktop, 2 columns on tablet, stacked cards on phones. Charts resize, and the 3D surface falls back to a heatmap on small or low-power devices.

### B7. Technology stack

- **Core:** Vite + React 18 + TypeScript (strict), React Router.
- **State:** Zustand for app state; Comlink for typed Web Worker RPC.
- **Styling and motion:** Tailwind CSS with design tokens; Framer Motion.
- **Charts:** Apache ECharts via `echarts-for-react` (canvas, fast with large series); `echarts-gl` (WebGL) for the 3D surface only, lazy-loaded.
- **ML:** TensorFlow.js, lazy-loaded inside the forecast worker. All other maths (ETS, Ridge, empirical and Gamma lead-time sampling, GP, EI, Sobol, inverse Normal) is written in typed TypeScript modules with tests.
- **Data handling:** PapaParse for CSV; zod for validation; idb-keyval for IndexedDB.
- **Testing:** Vitest (unit and parity); Playwright (end to end, with a console-error guard).
- Local environment: Node 25 / npm 11 and Python 3.13 with pandas, statsmodels, scikit-learn and TensorFlow 2.21 are already installed.

### B8. Supporting Python notebooks (yes, justified)

1. `notebooks/01_data_audit.ipynb`: a reproducible version of Part A (audit, leakage proof, lead-time extraction, hand calculation, Monte Carlo cross-check), included in your submission.
2. `notebooks/02_reference_models_and_lstm.ipynb`:
   - statsmodels ETS, scikit-learn Ridge and NumPy Monte Carlo produce **parity fixtures** (JSON). The TypeScript implementations are tested against them, so the browser maths is proven to match standard libraries.
   - Keras LSTM training; weights exported to JSON and loaded into an identical TF.js architecture. A parity test checks that predictions match within 1e-4.
   - Backtest leaderboard as an offline reference.
3. `scripts/preprocess.py` produces the compact dashboard JSON (non-leaky features, lead-time table, cost table).

### B9. Folder structure

```
/ (project root)
├── sales_data.csv, retail_store_inventory.csv     # git-ignored raw data
├── docs/        IMPLEMENTATION_PLAN.md, ASSUMPTIONS.md, TEST_REPORT.md
├── notebooks/   01_data_audit.ipynb, 02_reference_models_and_lstm.ipynb
├── scripts/     preprocess.py, export_fixtures.py
├── netlify.toml
└── dashboard/
    ├── public/data/        series.json, leadtimes.json, costs.json, lstm/ (model + weights)
    ├── src/
    │   ├── app/            App.tsx, routes, layout, theme tokens
    │   ├── pages/          ControlTower, Forecasting, SafetyStock, Simulation, Optimization, Method
    │   ├── components/     GlassPanel, KpiTile, FormulaCard, InsightCaption, AddDataPanel, controls/
    │   ├── charts/         ForecastChart, DdltHistogram, LeadTimeChart, InventoryChart, ConvergenceChart, GpSlice, Surface3D, Tornado
    │   ├── lib/
    │   │   ├── data/       schema, features (no price), validation, csv import
    │   │   ├── stats/      normal (Φ, Φ⁻¹), samplers (empirical, gamma), PRNG, quantiles, metrics
    │   │   ├── forecasting/ naive, ets, ridge, lstm, ensemble, backtest, intervals
    │   │   ├── inventory/  safetyStock (slide formula), rop, montecarlo, policySim, asIsReplay, cost
    │   │   └── optimization/ gp, kernels, acquisition, sobol, bayesOpt, gridSearch
    │   ├── workers/        forecast.worker.ts, sim.worker.ts, optimize.worker.ts
    │   └── store/          zustand slices (data, params, results, jobs)
    ├── tests/              unit + parity (fixtures from notebooks)
    └── e2e/                Playwright specs
```

### B10. Testing approach

| Layer | What is tested |
|---|---|
| Formula | `safetyStock()` against the A6 hand calculation (169.95 / 355.58) and the earlier fixture (652.46 / 1,613.60); edge cases (σ_L = 0 reduces to Z·σ_D·√L; L = 0; Z for 90/95/99%) |
| Statistics | Φ⁻¹ against SciPy to 1e-6; sampler means and variances; PRNG reproducibility |
| Monte Carlo | Simulated mean and variance of demand during lead time match D̄·L and σ_D²·L + D̄²·σ_L² within tolerance (the identity verified in A6) |
| Data | Lead-time extraction reproduces A5 (99.8% matched, the same distribution); no price features reach any model (an explicit leakage guard test) |
| Forecasting | ETS and Ridge parity with statsmodels and scikit-learn; LSTM parity with Keras; metric functions on known vectors; backtests use only past data |
| Bayesian optimization | Branin optimum found within tolerance; constrained case respects feasibility; agrees with grid search on our cost function |
| Integration | Adding a row updates forecast version, accuracy, SS, ROP and Monte Carlo; reset restores the original data |
| End to end (Playwright) | Every page loads; controls change outputs; CSV append works; **zero console errors or warnings**; main thread never blocked for more than 200 ms during Monte Carlo or optimization (long-task observer) |
| Build | `npm run build` + `vite preview` smoke test; Lighthouse check of performance and accessibility |

Phase 4 re-runs every row of the traceability table below as an acceptance checklist.

### B11. Netlify deployment

1. `netlify.toml`: `base = "dashboard"`, `command = "npm run build"`, `publish = "dist"`, Node 22. SPA fallback (`/* → /index.html 200`), long-cache headers for hashed assets, and security headers (CSP allowing `wasm-unsafe-eval` for the TF.js WASM backend).
2. Push to a **private** GitHub repo. You provide the link in Phase 4.
3. In Netlify: Add new site → Import from Git → choose the repo → settings are picked up from `netlify.toml` → Deploy.
4. Post-deploy check: run the Playwright smoke suite against the live URL; confirm that adding data works and the console is clean.

---

## Part C — Traceability Table

| Slide requirement | Dashboard feature that delivers it | Where |
|---|---|---|
| **Objective:** enhance the ROP calculator and sensitivity analysis | As-is vs baseline vs AI-enhanced ROP; simulated cost and service comparison | Control Tower, Simulation |
| Objective: *predictive intelligence* | Forecast-driven D̄ and forecast-error σ_D | Forecasting, Safety Stock |
| Objective: *adaptive decision-making* | SS and ROP recompute automatically as new data arrives and forecasts change (e.g. epidemic onset) | Add Data → all pages |
| Objective: *real-time optimisation* | In-browser Bayesian optimization re-runs on parameter or data change | Optimization |
| 1. ML models (time series, regression, LSTM) | ETS, Ridge regression, global LSTM (+ naive benchmarks, ensemble) | Forecasting |
| 1. …historical data, seasonality, promotions, external factors | Lags; month and Fourier terms; Promotion (+30%); Weather (±10%); Epidemic (−44%); driver-effects chart. Leaky price features excluded and documented | Forecasting, Method |
| 1. Keep the possibility of adding new data | Single-day form, CSV append, stream-next-day replay; IndexedDB persistence | Forecasting → Add Data |
| 1. Continuously update forecasts as new data arrives | Incremental ETS, Ridge refit, LSTM fine-tune in a worker; versioned update log; rolling out-of-sample accuracy | Forecasting |
| 1. …improving accuracy and responsiveness | Rolling accuracy against data added; model leaderboard (MAE, RMSE, WAPE, MAPE, sMAPE, MASE, bias) | Forecasting |
| 2. Probabilistic models: demand variability | σ_D from forecast errors; bootstrap/Normal demand distributions | Safety Stock |
| 2. Probabilistic models: lead-time uncertainty | Empirical lead times recovered from the data (99.8% of orders); store-pool distribution; Gamma what-if | Safety Stock |
| 2. Monte Carlo for risk scenarios and buffers | Demand-during-lead-time simulation, stockout tail, fill rate, Monte Carlo SS; inventory-level simulation of three policies | Safety Stock, Simulation |
| 2. Formula `SS = Z·√(σ_D²·L + D̄²·σ_L²)` | Implemented exactly; live formula card with substituted numbers; unit-tested against the hand calculations | Safety Stock |
| Variables Z, σ_D, L, σ_L (and D̄) | Service-level → Z control; L and σ_L from data with slider overrides; D̄ and σ_D from data or forecast; units shown (units/day, days) | Safety Stock |
| 3. Bayesian optimization instead of manual sweeps | GP + constrained EI; convergence chart vs random and grid search | Optimization |
| 3. …optimal reorder points under constraints | Service level, budget, capacity, MOQ constraints; optimal (r, Q) | Optimization |
| 3. Sensitivity analysis | Tornado, ROP vs service-level curve, 3D surrogate surface, 1D GP view | Optimization |
| "No sharing of data with peers allowed" | Private repo; raw CSVs git-ignored; data stays in the browser; optional no-data build | Deployment, Method |

---

## Part D — Development parts (Phase 3, each stops for "continue")

1. **Part 1 — Data and models:** preprocessing, audit notebook, reference fixtures, LSTM training and export.
2. **Part 2 — Safety stock and Monte Carlo engine** (TypeScript library + tests).
3. **Part 3 — Bayesian optimization engine** (GP, constrained EI, grid validation + tests).
4. **Part 4 — Dashboard UI** (design system, pages, charts, controls, explanations).
5. **Part 5 — Integration:** workers, add-data flow, continuous updates, persistence, performance.
6. **Phase 4 — Testing and deployment.**
