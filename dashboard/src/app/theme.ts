/** Semantic colours shared by charts and UI (must match the CSS tokens in styles/index.css). */
export const COLORS = {
  ai: "#22d3ee",
  aiSoft: "rgba(34, 211, 238, 0.16)",
  baseline: "#f59e0b",
  actual: "#94a3b8",
  risk: "#f43f5e",
  riskSoft: "rgba(244, 63, 94, 0.10)",
  safe: "#34d399",
  opt: "#a78bfa",
  optSoft: "rgba(167, 139, 250, 0.18)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  faint: "#64748b",
  line: "rgba(148, 163, 184, 0.14)",
  panel: "rgba(10, 15, 28, 0.92)",
} as const;

/** One colour per forecasting model: AI models in the cyan family, distinguished by dash style too. */
export const MODEL_STYLE = {
  ridge: { color: "#22d3ee", dash: "solid", label: "Ridge regression" },
  lstm: { color: "#2dd4bf", dash: "dashed", label: "LSTM" },
  ensemble: { color: "#7dd3fc", dash: "dotted", label: "Ensemble" },
  ets: { color: "#818cf8", dash: "dashed", label: "Exponential smoothing" },
  baseline: { color: "#f59e0b", dash: "dashed", label: "Static mean (baseline)" },
} as const;

export const POLICY_STYLE = {
  asis: { color: "#94a3b8", label: "As-is (historical)" },
  baseline: { color: "#f59e0b", label: "Baseline calculator" },
  ai: { color: "#22d3ee", label: "AI forecast + Monte Carlo" },
  optimized: { color: "#a78bfa", label: "AI + Bayesian-optimised" },
} as const;
