# AI-Enhanced Reorder Point & Inventory Management

**AI in Operations · Session II exercise.** A React dashboard that upgrades the classic reorder-point calculator with:

1. **Demand forecasting:** exponential smoothing, ridge regression and an LSTM, updated as new data arrives.
2. **Dynamic safety stock:** the slide's formula `SS = Z·√(σ_D²·L + D̄²·σ_L²)`, checked by Monte Carlo simulation.
3. **AI-driven sensitivity analysis:** Bayesian optimisation of the reorder point and order quantity under constraints.

All computation runs in the visitor's browser (Web Workers). There is no server, and data a visitor adds never leaves their browser.

| Document | What it contains |
|---|---|
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Data audit, architecture, design decisions, traceability to the slide |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Numerical verification: hand calculations, parity with Python, holdout results |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | Every slide requirement mapped to the tests that prove it |
| [docs/results/holdout_replay.md](docs/results/holdout_replay.md) | Reproducible 100-product holdout comparison of all policies |

## Repository layout

```
notebooks/   01_data_audit.ipynb, 02_reference_models_and_lstm.ipynb   (executed, with outputs)
scripts/     inventory_data.py, reference_models.py, preprocess.py, export_fixtures.py
dashboard/   React + TypeScript app (Vite)
  src/lib/         forecasting, inventory (formula, Monte Carlo, simulation), optimisation (GP, Bayesian opt.)
  src/engine/      services the Web Workers expose
  src/workers/     forecast / planning / optimise workers
  src/pages/       Control Tower, Forecasting, Safety Stock, Simulation, Optimisation, Method
  public/data/     derived data the app loads (no price columns), LSTM weights, model config
  tests/           unit + parity tests (Vitest)          e2e/  browser tests (Playwright)
  reports/         reproducible long-running reports
netlify.toml  Netlify build, headers and security policy
```

The raw Kaggle files (`sales_data.csv`, `retail_store_inventory.csv`) are **not** in the repository (`.gitignore`). See "Data and privacy" below.

## Run it locally

Requirements: Node 22+ and npm.

```bash
cd dashboard
npm ci
npm run dev            # http://localhost:5173
npm test               # unit and parity tests
npx playwright install chromium && npm run e2e   # browser tests against the production build
npm run build && npm run preview   # production build at http://localhost:4173
npm run report:holdout # regenerates docs/results/holdout_replay.{md,json} (about 3 minutes)
```

## Rebuild the data and models (optional)

The app's data files in `dashboard/public/data` are already built. To regenerate them from the raw dataset:

1. Download `sales_data.csv` from [Kaggle (atomicd)](https://www.kaggle.com/datasets/atomicd/retail-store-inventory-and-demand-forecasting) into the project root.
2. Run:

```bash
pip install -r requirements.txt
python scripts/preprocess.py
python -m nbconvert --to notebook --execute --inplace notebooks/01_data_audit.ipynb
python -m nbconvert --to notebook --execute --inplace notebooks/02_reference_models_and_lstm.ipynb
python scripts/export_fixtures.py
```

`preprocess.py` writes the app's data files. Notebook 02 trains the LSTM and writes `model_config.json`. `export_fixtures.py` writes the reference values the TypeScript tests compare against.

## Deploy to Netlify (free tier)

1. Push this repository to GitHub. A **private** repository is recommended.
2. In Netlify, go to **Add new project → Import an existing project → GitHub** and pick the repository. Netlify reads `netlify.toml`, so no build settings need typing:
   - base: `dashboard`
   - build command: `npm run build`
   - publish directory: `dist`
   - Node: 22
3. Deploy. The build runs the TypeScript check and Vite build, which take about a minute.
4. **Make it reachable.** On the free plan, a *private* project can only be opened by its owner (you, logged in to Netlify). To share the link: Project configuration → General → Visitor access → Project visibility → Public. Anyone with the URL can then open the dashboard and the derived data it loads.
5. Check the live site:
   - every page loads;
   - "Add new data → Next day" moves the planning date;
   - the browser console shows no errors.

## Data and privacy ("No sharing of data with peers")

- Raw CSVs are never committed (`.gitignore`). The app ships only derived per-day series (demand, sales, stock ledger, promotion, discount, weather, epidemic), lead-time and cost summaries, and the model's weights.
- Price columns are never shipped: they leak demand. Only each product's median price is used, as a cost parameter.
- Everything a visitor enters or uploads is processed and stored only in their own browser (IndexedDB). "Reset" erases it.
- The deployed site is public by choice: anyone with the link can open it. The repository itself is private.
