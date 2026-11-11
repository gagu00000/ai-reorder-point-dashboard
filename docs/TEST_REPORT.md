# Test Report — Phase 4

All results below were produced on the final code. Commands to reproduce are in the README.

## Summary

| Suite | Command | Result |
|---|---|---|
| TypeScript type check (strict) | `npx tsc --noEmit` | clean |
| Unit, parity and integration tests (Vitest) | `npm test` | **116 / 116 passed** (13 files) |
| Browser tests on the production build (Playwright, Chromium) | `npm run e2e` | **15 / 15 passed**; each test fails on any console error or warning |
| Holdout report, 100 products × 60 unseen days | `npm run report:holdout` | re-run reproduces the earlier numbers exactly (max cost difference 0.0) |
| Python notebooks | `nbconvert --execute` | both execute without error |
| Lighthouse (desktop, production build) | `lighthouse --preset=desktop` | Performance 99–100 · Accessibility 100 · Best practices 100 |
| Browser tests against the **live Netlify site** | `E2E_BASE_URL=https://ai-reorder-point-dashboard.netlify.app npm run e2e` | 15 / 15 passed (after the audit fixes below and the first-time-viewer guidance) |

Lighthouse detail (Control Tower / Forecasting / Optimisation): LCP 0.8 s, total blocking time 0 ms, CLS ≤ 0.013.
Remaining notices are informational: "missing source maps" is deliberate, because it keeps the source private.

## Requirement → evidence

| Slide requirement | Delivered by | Evidence (test or check) | Result |
|---|---|---|---|
| **Objective:** enhance the ROP calculator and sensitivity analysis | Baseline calculator vs AI-enhanced and optimised policies on unseen days | `holdoutReplay.test.ts`, `holdoutBayesOpt.test.ts`, `report:holdout` | Pass: optimised policy −43% to −48% cost vs baseline, fill rate 96.1% → 98.3–98.7% |
| Predictive intelligence | Forecast-driven D̄, forecast-error σ_D | `holdoutReplay.test.ts` (σ_D of forecast errors < 0.9 × raw σ_D) | Pass (34.9 vs 42.9 units/day) |
| Adaptive decision-making | Daily recomputed reorder point; everything refreshes on new data | `holdoutReplay.test.ts` (adaptive AI policy), e2e `newData.spec.ts` | Pass |
| Real-time optimisation | Bayesian optimisation in a Web Worker | e2e "stays responsive while BO runs" (longest main-thread task < 200 ms) | Pass |
| 1 · Time-series, regression, LSTM models | ETS, ridge, global LSTM, ensemble | `models.test.ts` (parity with statsmodels, scikit-learn, Keras); `backtest.test.ts` reproduces the notebook leaderboard to 10⁻⁶ | Pass |
| 1 · History, seasonality, promotions, external factors | Lags, Fourier seasonality, promotion, weather, epidemic; price excluded | `data.test.ts` (leakage guard, persistence of future epidemic), `engine.test.ts` (driver signs) | Pass |
| 1 · Keep the possibility of adding new data | Enter a day, CSV append, stream recorded days, reset | `newData.test.ts` (validation, applying rows, CSV parsing), e2e `newData.spec.ts` (all four flows, reload) | Pass |
| 1 · Continuously update forecasts | Out-of-sample scoring of each new day, refits, adaptive bands, LSTM fine-tuning, saved in the browser | `newData.test.ts` (scoring uses only earlier data), `models.test.ts` (fine-tuning changes the forecast), e2e (fine-tune logged after 7 days; restored after reload) | Pass |
| 2 · Probabilistic models: demand variability | Bootstrap of real forecast errors; Normal option | `safetyStock.test.ts` | Pass |
| 2 · Probabilistic models: lead-time uncertainty | Lead times recovered from the ledger (99.8%); Gamma with L, σ_L | `data.test.ts` (extraction matches Python), `safetyStock.test.ts` (sampler moments) | Pass |
| 2 · Monte Carlo risk scenarios and buffers | Demand-during-lead-time simulation; inventory replay | `safetyStock.test.ts` (variance identity within 1%, matches notebook's tail figures), `policy.test.ts` (stock conservation, common random numbers) | Pass |
| 2 · Formula `SS = Z·√(σ_D²·L + D̄²·σ_L²)` | Implemented exactly; shown term by term | `safetyStock.test.ts` (hand calculations 169.95 / 355.58 and 652.46 / 1,613.60; special cases) | Pass |
| 3 · Bayesian optimisation instead of manual sweeps | GP + constrained expected improvement | `optimization.test.ts` (GP = scikit-learn; Branin), `inventoryOptimization.test.ts` (within 1.5% of a 900-point grid with 45 simulations; beats random search) | Pass |
| 3 · Optimal reorder points under constraints | Service, budget, capacity, min/max order | `inventoryOptimization.test.ts` (binding service constraint, capacity respected, reorder-point-only mode) | Pass |
| 3 · Sensitivity analysis | Surrogate map, WebGL 3D surface, tornado charts, price-of-service curve | `inventoryOptimization.test.ts` (surfaces, tornado ordering, monotone service curve); e2e 3D view | Pass |
| Dashboard: responsive, fast, no console errors | — | e2e phone width (all pages, 375 px), console guard on every test, Lighthouse | Pass |
| Dashboard: self-explanatory for a first-time viewer | Start-here card, Guide panel (walkthrough, slide map, colour key, glossary), "How to read this page" on every page, plain-language definitions on technical terms | e2e `guide.spec.ts` (card, Guide open/close, remembered dismissal, term definition, page guide on all six pages) | Pass |
| Dashboard: secure deployment | Strict CSP and security headers | e2e `security.spec.ts` (full pipeline incl. WebGL under the production CSP) | Pass |
| Note: no sharing of data with peers | Private repository; raw CSVs git-ignored; only derived data shipped; user data stays in the browser | `data.test.ts` (no price fields shipped), pre-push file audit | Pass |

## Defects found during testing (all fixed)

| Found by | Defect | Fix |
|---|---|---|
| Unit test | Invalid dates such as 2023-13-40 were accepted (JavaScript rolls them over) | Round-trip date validation |
| Browser review | Wheel-scrolling over a chart zoomed the chart instead of scrolling the page | Zoom requires Ctrl + wheel |
| Browser review | Price-of-service curve could show a higher target as cheaper | Each target's optimum taken over all pooled simulations |
| Browser review | Replay priced costs differently from the optimiser when cost settings changed | Shared cost settings |
| Browser review | Narrative claimed the optimised policy always wins | Text adapts to the actual outcome |
| e2e console guard | echarts-gl warning in production | Explicit surface data shape |
| Fixture review | The console check only ran in one test (lazy fixture) | Automatic fixture; verified with a deliberately failing probe |
| Live-site tests | Netlify's free-plan badge (injected script rendered in a srcdoc iframe) was blocked by the CSP, logging an error | Its one inline script allowed by SHA-256 hash; no `unsafe-inline` |
| CSP test | The WebGL 3D chart failed under the strict CSP (claygl compiles size expressions with `new Function`) | Build-time replacement with a safe evaluator, tested against every expression echarts-gl ships; no `unsafe-eval` needed |

## Deviations from the approved plan

- **React 19** instead of React 18: the current stable release; no API differences matter here.
- **Web Workers built in Part 4** rather than Part 5: needed from the start for responsiveness.
- **No "no-data build" flag (`VITE_BUNDLE_DATA=false`).**
  - A deployment with no data would show nothing until a full dataset was loaded, and rebuilding lead times and model scales in the browser was out of scope.
  - The deployed site is public by the owner's choice (no password); the repository is private and raw files are never committed.
  - CSV upload *appends* new days; it does not replace the base dataset.
- **Prediction bands** use validation-calibrated offsets rescaled to each product's recent 90-day errors. This is simpler than re-estimating every quantile, and it still adapts as data arrives.

## Not verified

- **Browsers:** tested in Chromium only. Firefox and Safari were not tested. The code uses standard APIs (Web Workers, IndexedDB, OffscreenCanvas with a CPU fallback for the LSTM).

## End-to-end audit (after deployment)

Every requirement was re-checked against the code, followed by automated scans, a code review of
the riskiest paths, and measurements.

**Found clean:** 0 dependency vulnerabilities (`npm audit`, production and dev), no leftover debug
code, no raw-HTML injection points, and HSTS present on the live site.

**Found and fixed:**

| # | Severity | Finding | Fix | Verified by |
|---|---|---|---|---|
| 1 | High | LSTM fine-tuning leaked 16 tensors per run (old Adam optimiser state never released) | Dispose the previous optimiser before recompiling | Unit test: tensor count constant over repeated fine-tunes |
| 2 | High | A fine-tune started on a hidden tab froze (TF.js waited for animation frames, which browsers pause), and blocked day scoring | TF.js in the worker uses plain task scheduling instead of `requestAnimationFrame` | Reproduced in a hidden browser pane, then fine-tune completed in 1.5 s after the fix |
| 3 | High | A CSV preview made before other days arrived could still be appended, applying rows out of order and moving the planning date backwards | Preview discarded when the date moves; every addition re-validated against the current timeline inside `advance()` | e2e `audit.spec.ts` |
| 4 | Medium | Failures while adding data were unhandled (console error) and could leave auto-stream stuck "on" | Errors reported in the panel and update log; streaming stops cleanly; workers re-synced | Code path review; full e2e suite with console guard |
| 5 | Medium | Manual entry or CSV append during auto-stream was silently ignored | Those controls are disabled while streaming | e2e `audit.spec.ts` |
| 6 | Medium | Auto-streaming on the overview queued one Bayesian optimisation per streamed day | Auto re-optimisation waits until streaming stops; optimisation runs kept in memory capped at 24 | e2e: main thread never blocked > 200 ms while streaming on the busiest page |
| 7 | Medium | Browser-saved data/weights were not tied to a dataset version (a redeploy with new data would reuse them) | Saved state and LSTM weights carry a stamp of the deployed data and models; mismatches are cleared | e2e `audit.spec.ts` |
| 8 | Medium | Missing files (`/assets/*`, `/data/*`) returned the app's HTML with status 200 | Real 404s for those paths; a page left open across a redeploy reloads once instead of failing | `curl` on the live site |
| 9 | Low | No fallback when WebGL is unavailable (the 3D view would fail) | 3D offered only where WebGL works; a failing 3D view falls back to the 2D map | e2e with WebGL disabled |
| 10 | Low | Excel CSVs with a byte-order mark failed ("missing column Date"); no size limit before reading a file | BOM stripped; files over 5 MB refused before reading | Unit test (BOM); e2e (6 MB file) |
| 11 | Low | Clearing a number field submitted 0 instead of "empty" | Empty field means "not given" (demand then fails validation clearly) | Code review |
| 12 | Low | The global service-level slider overwrote the optimiser's fill-rate target | Synced only when the optimiser constrains cycle service | Code review |
| 13 | Low | Planned "pulse" on updated views and the Diebold–Mariano result on the dashboard were missing; the pulse at first did not show (shadow overridden) | Pulse added to four views (inline style); DM result shown with the leaderboard | Measured in the browser: glow 0.6 s after new data |

**Not changed (by design or out of scope):**
- The Netlify badge's script hash is fixed in the policy. If Netlify changes the badge, only the badge stops rendering.
- Browser tests run in Chromium only.
- The second commit message on GitHub mentions removing a password gate that was never committed (it was removed before the first commit). History was not rewritten.
