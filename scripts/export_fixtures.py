"""Export parity fixtures that the TypeScript tests compare against.

Every fixture is produced by the Python reference implementation
(``reference_models.py``) or by scikit-learn / statsmodels / Keras, so the
browser code is proven to compute the same numbers.

Usage:  python scripts/export_fixtures.py   (after preprocess.py and notebook 02)
"""
from __future__ import annotations

import json
import os

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
from scipy import stats

import reference_models as rm
from inventory_data import DATA_OUT, FIXTURES_OUT, build_panel, exog_matrix, extract_lead_times, load_raw

FIXTURE_SKUS = ["S001-P0001", "S003-P0007", "S005-P0020"]


def ridge_fixture(panel, alpha: float) -> list[dict]:
    out = []
    for sku in FIXTURE_SKUS:
        s = panel.skus.index(sku)
        for origin in (panel.split.train_end, panel.split.val_end):
            exog = exog_matrix(panel, s, epidemic=rm.epidemic_path(panel, origin))
            fit = rm.fit_ridge(panel.demand[s], exog, origin, alpha)
            out.append({
                "sku": sku, "origin": origin, "alpha": alpha,
                "mean": fit.mean.tolist(), "scale": fit.scale.tolist(),
                "coef": fit.coef.tolist(), "intercept": fit.intercept,
                "forecast": rm.ridge_forecast(panel.demand[s], exog, origin, fit, rm.HORIZON).tolist(),
            })
    return out


def ets_fixture(panel) -> dict:
    fixed = []
    fitted_cases = []
    for sku in FIXTURE_SKUS:
        s = panel.skus.index(sku)
        y = panel.demand[s, : panel.split.train_end + 1].astype(float)
        l0, b0 = rm.ets_initial_state(y)
        for alpha, beta, phi in ((0.3, None, None), (0.3, 0.1, 0.9)):
            fv, level, trend = rm.ets_filter(y, alpha, beta, phi, l0, b0)
            fixed.append({
                "sku": sku, "alpha": alpha, "beta": beta, "phi": phi, "l0": l0, "b0": b0,
                "fittedHead": fv[:30].tolist(), "sse": float(np.sum((y - fv) ** 2)),
                "level": level, "trend": trend,
                "forecast": rm.ets_forecast_from_state(level, trend, phi, rm.HORIZON).tolist(),
            })
        candidates = rm.fit_ets_candidates(y)
        selected = min(candidates, key=lambda fit: fit.aic)
        fitted_cases.append({
            "sku": sku,
            "selected": selected.kind,
            "candidates": [
                {"kind": fit.kind, "alpha": fit.alpha, "beta": fit.beta, "phi": fit.phi,
                 "sse": fit.sse, "aic": fit.aic, "forecast": fit.forecast(rm.HORIZON).tolist()}
                for fit in candidates
            ],
        })
    return {"fixed": fixed, "fitted": fitted_cases}


def lstm_fixture(panel) -> list[dict]:
    model = rm.build_lstm()
    rm.load_lstm_weights(model, json.loads((DATA_OUT / "lstm" / "weights.json").read_text()))
    scales = rm.lstm_scales(panel)
    out = []
    origin = panel.split.val_end
    epi = rm.epidemic_path(panel, origin)
    for sku in FIXTURE_SKUS:
        s = panel.skus.index(sku)
        enc, fut = rm.lstm_inputs(panel, s, origin, scales[s], exog_matrix(panel, s, epidemic=epi))
        pred = model.predict([enc[None], fut[None]], verbose=0)[0]
        out.append({
            "sku": sku, "origin": origin, "scale": float(scales[s]),
            "encoder": enc.reshape(-1).tolist(), "future": fut.tolist(),
            "predictionScaled": pred.tolist(),
            "forecast": (np.maximum(pred, 0) * scales[s]).tolist(),
        })
    return out


def metrics_fixture() -> dict:
    rng = np.random.default_rng(3)
    y = rng.integers(5, 200, 50).astype(float)
    f = y + rng.normal(0, 20, 50)
    scale = rng.uniform(10, 40, 50)
    return {"y": y.tolist(), "f": f.tolist(), "scale": scale.tolist(), "expected": rm.metrics(y, f, scale)}


def leadtime_fixture(panel) -> dict:
    s = panel.skus.index("S002-P0005")
    matches, unmatched = extract_lead_times(panel.inventory[s], panel.units_sold[s], panel.units_ordered[s])
    return {"sku": "S002-P0005", "nMatched": len(matches), "unmatched": unmatched,
            "first": [list(m) for m in matches[:25]], "meanL": float(np.mean([m[1] for m in matches]))}


def gp_fixture() -> dict:
    """scikit-learn GP with a fixed Matérn-5/2 ARD kernel: posterior mean/std and log marginal likelihood."""
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.gaussian_process.kernels import ConstantKernel, Matern

    rng = np.random.default_rng(12)
    X = rng.uniform(0, 1, (14, 2))
    y = np.sin(6 * X[:, 0]) + 0.5 * np.cos(4 * X[:, 1]) + rng.normal(0, 0.05, 14)
    Xs = rng.uniform(0, 1, (10, 2))
    signal_var, lengthscales, noise_var = 1.7, [0.3, 0.6], 0.01
    kernel = ConstantKernel(signal_var, "fixed") * Matern(length_scale=lengthscales, length_scale_bounds="fixed", nu=2.5)
    gp = GaussianProcessRegressor(kernel=kernel, alpha=noise_var, optimizer=None, normalize_y=False).fit(X, y)
    mean, sd = gp.predict(Xs, return_std=True)
    return {
        "X": X.tolist(), "y": y.tolist(), "Xs": Xs.tolist(),
        "signalVar": signal_var, "lengthscales": lengthscales, "noiseVar": noise_var,
        "mean": mean.tolist(), "sd": sd.tolist(), "logMarginalLikelihood": float(gp.log_marginal_likelihood_value_),
    }


def normal_fixture() -> list[dict]:
    probs = [0.5, 0.8, 0.9, 0.95, 0.975, 0.99, 0.995, 0.999, 0.001, 0.025]
    return [{"p": p, "z": float(stats.norm.ppf(p))} for p in probs]


def main() -> None:
    panel = build_panel(load_raw())
    config = json.loads((DATA_OUT / "model_config.json").read_text())
    FIXTURES_OUT.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "ridge.json": ridge_fixture(panel, config["ridge"]["alpha"]),
        "ets.json": ets_fixture(panel),
        "lstm.json": lstm_fixture(panel),
        "metrics.json": metrics_fixture(),
        "leadtime.json": leadtime_fixture(panel),
        "normal.json": normal_fixture(),
        "gp.json": gp_fixture(),
    }
    for name, payload in fixtures.items():
        (FIXTURES_OUT / name).write_text(json.dumps(payload), encoding="utf-8")
        print("wrote", (FIXTURES_OUT / name).relative_to(FIXTURES_OUT.parents[2]))


if __name__ == "__main__":
    main()
