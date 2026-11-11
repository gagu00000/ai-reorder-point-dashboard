/**
 * All explanatory text for first-time viewers in one place: page guides, the walkthrough, and the
 * glossary. Presentation only — nothing here affects any calculation.
 */

export type GlossaryKey =
  | "rop" | "safetyStock" | "serviceLevel" | "fillRate" | "z" | "dBar" | "sigmaD" | "leadTime" | "sigmaL"
  | "ddlt" | "monteCarlo" | "eoq" | "bayesOpt" | "gaussianProcess" | "expectedImprovement" | "wape" | "mase"
  | "bias" | "holdout" | "planningDate" | "asIs" | "baseline" | "aiEnhanced" | "stockout" | "lostSales"
  | "ridge" | "ets" | "lstm" | "ensemble" | "annualCost" | "tornado" | "conformal";

export const GLOSSARY: Record<GlossaryKey, { term: string; definition: string }> = {
  rop: { term: "Reorder point (ROP)", definition: "The stock level that triggers a new order. When stock on hand plus stock already on order falls to this level, an order is placed. ROP = expected demand during the lead time + safety stock." },
  safetyStock: { term: "Safety stock (SS)", definition: "Extra units held to cover demand and delivery times that turn out higher than expected. Slide formula: SS = Z · √(σ_D² · L + D̄² · σ_L²)." },
  serviceLevel: { term: "Cycle service level", definition: "The probability of not running out between placing an order and receiving it. A 95% target means at most 1 in 20 order cycles may have a stockout. It sets Z in the formula." },
  fillRate: { term: "Fill rate", definition: "The share of all customer demand served straight from stock. 98% means 2% of demand was lost." },
  z: { term: "Z (service-level factor)", definition: "How many standard deviations of buffer to hold for the chosen service level, from the Normal distribution: 95% → Z = 1.645, 99% → Z = 2.326." },
  dBar: { term: "D̄ (average demand)", definition: "Expected demand per day. The baseline calculator uses the historical average; the AI version uses the forecast for the coming lead time." },
  sigmaD: { term: "σ_D (demand variability)", definition: "Standard deviation of daily demand. The baseline uses the raw historical variation; the AI version uses only what the forecast still gets wrong (forecast errors), which is smaller." },
  leadTime: { term: "L (lead time)", definition: "Days between placing an order and the stock being available. Recovered for each product from the inventory records in the data (1–4 days)." },
  sigmaL: { term: "σ_L (lead-time variability)", definition: "Standard deviation of the lead time in days: how unreliable deliveries are. Taken from each store's supplier deliveries (about 1 day)." },
  ddlt: { term: "Demand during lead time", definition: "Total units customers want while an order is on its way. The reorder point must cover this; if it is higher than the stock left, the product runs out." },
  monteCarlo: { term: "Monte Carlo simulation", definition: "Simulating thousands of possible futures (random lead times and demand drawn from real past errors) to see the full range of outcomes, instead of assuming a bell curve." },
  eoq: { term: "EOQ (economic order quantity)", definition: "The classic order size that balances ordering cost against holding cost: √(2 × daily demand × order cost ÷ daily holding cost)." },
  bayesOpt: { term: "Bayesian optimisation", definition: "A search method that learns from each simulation it runs and chooses the next policy to test where it expects the biggest improvement — finding a near-best policy in a few dozen tries instead of hundreds." },
  gaussianProcess: { term: "Gaussian process (surrogate)", definition: "The statistical model Bayesian optimisation builds of how cost depends on the reorder point and order quantity, including how uncertain it is in each region." },
  expectedImprovement: { term: "Expected improvement", definition: "How much better than the best policy so far a candidate is expected to be, weighed by the chance it meets all constraints. The optimiser tests the candidate with the highest value next." },
  wape: { term: "WAPE", definition: "Weighted absolute percentage error: total forecast error ÷ total demand. Lower is better; 27% means forecasts were off by 27 units per 100 sold." },
  mase: { term: "MASE", definition: "Error relative to the simplest forecast (\"tomorrow = today\"). Below 1 means the model beats that naive forecast." },
  bias: { term: "Bias", definition: "Whether a model systematically over-forecasts (positive) or under-forecasts (negative)." },
  holdout: { term: "Holdout (unseen days)", definition: "The last 60 days of data (2 Dec 2023 – 30 Jan 2024), kept away from every model and setting so results on them are an honest test." },
  planningDate: { term: "Planning as of", definition: "The last day the planner knows about. Everything after it is \"the future\" — used only to test policies honestly, or revealed day by day as new data." },
  asIs: { term: "As-is (historical ordering)", definition: "What the business actually did, read from the stock and order records in the data." },
  baseline: { term: "Baseline calculator", definition: "The classic approach: the slide's formula fed with the historical average and variation of demand, ordering the EOQ." },
  aiEnhanced: { term: "AI-enhanced", definition: "The same formula fed with the demand forecast and its error, corrected by Monte Carlo, recomputed every day, and finally tuned by Bayesian optimisation." },
  stockout: { term: "Stockout", definition: "Running out of stock while customers still want the product." },
  lostSales: { term: "Lost sales", definition: "Demand that could not be served because the product was out of stock. Valued at the lost margin (40% of the price by default)." },
  ridge: { term: "Ridge regression", definition: "A regression model that predicts demand from recent demand, season, promotions, weather and epidemic periods. The most accurate model here, so the planner uses it." },
  ets: { term: "Exponential smoothing (ETS)", definition: "A classic time-series model that forecasts from a weighted average of past demand, giving more weight to recent days." },
  lstm: { term: "LSTM", definition: "A recurrent neural network that reads the last 28 days and forecasts the next 14. Trained offline on all 100 products, then updated in your browser as new data arrives." },
  ensemble: { term: "Ensemble", definition: "A weighted average of the ETS, ridge and LSTM forecasts, weighting each model by its past accuracy." },
  annualCost: { term: "Annual cost", definition: "Holding cost (stock tied up) + ordering cost (per order) + lost-sales cost, simulated over a year of daily operations." },
  tornado: { term: "Tornado chart", definition: "Each input is moved 20% down and up while the others stay fixed; the longest bars show the inputs the result is most sensitive to." },
  conformal: { term: "Prediction band", definition: "The range the actual demand is expected to fall in (80% or 95% of the time), built from the model's own past errors." },
};

export type PageKey = "overview" | "forecasting" | "safety" | "simulation" | "optimisation" | "method";

export interface PageGuideContent {
  question: string;
  look: string[];
  tryThis: string[];
}

export const PAGE_GUIDES: Record<PageKey, PageGuideContent> = {
  overview: {
    question: "For the selected product: when should we reorder, how much, and does the AI-enhanced approach beat the classic reorder-point calculator?",
    look: [
      "Top tiles: the recommended reorder point and order quantity, next to what the classic formula would say.",
      "The four numbered cards are the three steps of the exercise plus the proof — click any of them to open that step.",
      "Bottom charts: the demand forecast, the cost of each policy on 60 days the planner never saw, and the recommended policy in action.",
    ],
    tryThis: [
      "Pick another store or product at the top — every number recomputes for it.",
      "Read the recommendation box at the bottom for the plain-language conclusion.",
    ],
  },
  forecasting: {
    question: "How much will this product sell over the next 14 days, which model forecasts best, and do the forecasts improve as new data arrives? (Slide step 1)",
    look: [
      "Chart: grey line = actual demand; coloured lines = each model's forecast after the dashed \"forecast origin\" line; shaded band = the range demand is expected to fall in; red shading = epidemic periods; green triangles = promotion days.",
      "\"Add new data\" panel: reveal the next recorded day, type in a day yourself, or upload a CSV — every model is scored on the new day before it learns from it.",
      "Leaderboard: accuracy of every model on all 100 products; the drivers chart shows how much promotions, epidemics and weather move demand.",
    ],
    tryThis: [
      "Click \"Next day\" (or \"Auto-stream\") and watch the accuracy chart and update log fill in; the planning date at the top moves forward.",
      "Toggle models on and off with the coloured chips, and switch the leaderboard between Holdout and Validation.",
    ],
  },
  safety: {
    question: "How much safety stock is needed to cover uncertain demand and uncertain delivery times — and is the slide's formula enough? (Slide step 2)",
    look: [
      "Top tiles: safety stock by the formula vs by Monte Carlo, and how often the formula's reorder point would actually run out.",
      "Histogram: bars = thousands of simulated lead times; dashed curve = the bell curve the formula assumes; red bars = scenarios that still run out; the two vertical lines are the formula's and Monte Carlo's reorder points.",
      "Formula table: every term of SS = Z · √(σ_D² · L + D̄² · σ_L²) with today's numbers, for the baseline and the AI-enhanced version.",
    ],
    tryThis: [
      "Move the service-level slider (e.g. to 99%) and watch the reorder points and the red tail move.",
      "Raise the lead-time variability σ_L — the risk shifts from demand to delivery uncertainty.",
      "Switch the histogram between \"AI-enhanced\" and \"Baseline\".",
    ],
  },
  simulation: {
    question: "If each policy had been used on the 60 days the planner never saw, how would service and cost have compared?",
    look: [
      "Chart: coloured step line = stock on hand; dashed line = reorder point; purple diamonds = orders placed; red dots = days with lost sales; dotted grey = what the business actually held.",
      "Scorecard: fill rate, cycle service, stockout days and total cost for every policy, with the change against the baseline calculator.",
      "Cost bars: where the money goes — holding, ordering and lost sales.",
    ],
    tryThis: [
      "Press \"Replay\" to watch the 60 days unfold, then switch between policies with the tabs above the chart.",
    ],
  },
  optimisation: {
    question: "Which reorder point and order quantity give the lowest annual cost while meeting the service target and other constraints — found by Bayesian optimisation instead of a manual sweep? (Slide step 3)",
    look: [
      "Left panel: the objective (lowest annual cost) and the constraints you can set — service target, inventory budget, storage capacity, order limits, cost assumptions.",
      "Convergence chart: purple line = best cost found by Bayesian optimisation after each simulation; grey dashed = random search with the same budget; amber line = the classic formula's cost.",
      "Below: the optimiser's cost map (white dots = policies it actually simulated, pin = recommendation), sensitivity (tornado) charts, the price of higher service, and a check against a 900-point manual sweep.",
    ],
    tryThis: [
      "Press \"Run Bayesian optimisation\" and watch it converge in a few seconds.",
      "Switch on a storage capacity or budget limit (or lower the lost-margin cost) and run again — the recommendation changes to respect it.",
      "Press \"Run grid search\" to see the optimiser match a brute-force sweep with about 5% of the work.",
    ],
  },
  method: {
    question: "Where does the data come from, what was assumed, how was everything verified, and how does each slide requirement map to the dashboard?",
    look: [
      "Data audit, assumptions register, verification results and honest limitations.",
      "The traceability table at the bottom maps every line of the exercise slide to the feature that delivers it.",
    ],
    tryThis: ["Use the traceability table as a checklist against the exercise slide."],
  },
};

/** Suggested first visit, shown in the Guide panel. */
export const WALKTHROUGH: { to: string; title: string; text: string }[] = [
  { to: "/", title: "Overview", text: "Read the top tiles and the recommendation box: reorder point, order quantity, and the cost change versus the classic calculator on unseen days." },
  { to: "/forecasting", title: "Step 1 · Demand forecasting", text: "Compare the models on the chart and leaderboard, then click \"Next day\" in the Add new data panel to see every model scored and updated." },
  { to: "/safety-stock", title: "Step 2 · Safety stock & Monte Carlo", text: "See the slide formula worked through term by term; move the service-level slider and compare the formula with Monte Carlo on the histogram." },
  { to: "/simulation", title: "Proof · Inventory simulation", text: "Press Replay to watch the policies run through the 60 unseen days; read the scorecard." },
  { to: "/optimization", title: "Step 3 · Bayesian optimisation", text: "Press \"Run Bayesian optimisation\", watch it converge, then look at the sensitivity (tornado) and the 3D cost surface." },
  { to: "/method", title: "Method & traceability", text: "Check the assumptions and the table mapping each slide requirement to the dashboard." },
];

/** Exercise slide → where it is answered. */
export const SLIDE_MAP: { requirement: string; where: string; to: string }[] = [
  { requirement: "1 · Demand forecasting with time-series, regression and LSTM models (seasonality, promotions, external factors)", where: "Demand Forecasting", to: "/forecasting" },
  { requirement: "1 · Add new data; continuously update forecasts", where: "Demand Forecasting → Add new data", to: "/forecasting" },
  { requirement: "2 · Dynamic safety stock: probabilistic models and Monte Carlo; formula SS = Z·√(σ_D²·L + D̄²·σ_L²)", where: "Safety Stock & Monte Carlo", to: "/safety-stock" },
  { requirement: "3 · Bayesian optimisation of reorder points under constraints (instead of manual sweeps)", where: "Optimisation & Sensitivity", to: "/optimization" },
  { requirement: "Objective · Enhance the calculator: baseline vs AI-enhanced", where: "Control Tower and Inventory Simulation", to: "/" },
];
