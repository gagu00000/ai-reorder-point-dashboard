"""Reference forecasting models, metrics and backtesting (Python side).

These implementations are the ground truth for the browser (TypeScript) models:
every recursion and feature definition here is mirrored one-to-one in
``dashboard/src/lib/forecasting`` and checked by parity fixtures.

Models
------
* static mean  - the baseline reorder-point calculator's demand input
* naive        - yesterday's demand
* ma28         - 28-day moving average
* ets          - SES or damped Holt (chosen by AIC), statsmodels with fixed bounds
* ridge        - per-SKU ridge regression on lags + exogenous drivers, recursive multi-step
* lstm         - one global Keras LSTM across all SKUs (trained offline, fine-tuned in browser)

Exogenous values in the forecast horizon: promotion and weather use recorded
values (promotion is planned; weather stands in for a short-range weather
forecast). The epidemic flag is *not* known ahead: forecasts hold the last
observed state (persistence), which is how the dashboard behaves too.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

from inventory_data import EXOG_FEATURES, Panel, exog_matrix

HORIZON = 14
MIN_HISTORY = 28            # days needed before the first ridge training row (roll28)
LSTM_WINDOW = 28
LSTM_UNITS = 32
LSTM_DENSE = 64
ETS_BOUNDS = {
    "smoothing_level": (1e-4, 0.9999),
    "smoothing_trend": (1e-4, 0.9999),
    "damping_trend": (0.8, 0.98),
}
RIDGE_FEATURES = ["lag1", "lag7", "lag14", "roll7", "roll28", *EXOG_FEATURES]


# --------------------------------------------------------------------------- metrics
def metrics(y: np.ndarray, f: np.ndarray, mase_scale: np.ndarray | None = None) -> dict[str, float]:
    """Point-forecast accuracy. ``mase_scale`` is the in-sample naive MAE per row."""
    y = np.asarray(y, float)
    f = np.asarray(f, float)
    e = f - y
    out = {
        "MAE": float(np.mean(np.abs(e))),
        "RMSE": float(np.sqrt(np.mean(e**2))),
        "WAPE": float(np.sum(np.abs(e)) / np.sum(np.abs(y))),
        "MAPE": float(np.mean(np.abs(e) / np.abs(y))),
        "sMAPE": float(np.mean(2 * np.abs(e) / (np.abs(f) + np.abs(y)))),
        "Bias": float(np.sum(e) / np.sum(y)),
    }
    if mase_scale is not None:
        out["MASE"] = float(np.mean(np.abs(e) / np.asarray(mase_scale, float)))
    return out


def naive_mae_scale(y_train: np.ndarray) -> float:
    """Mean absolute one-step naive error in sample (MASE denominator)."""
    return float(np.mean(np.abs(np.diff(y_train))))


# --------------------------------------------------------------------------- persistence
def epidemic_path(panel: Panel, origin: int) -> np.ndarray:
    """Epidemic flag known up to ``origin``, held constant afterwards (persistence)."""
    path = panel.epidemic.astype(float).copy()
    path[origin + 1:] = path[origin]
    return path


# --------------------------------------------------------------------------- ETS
def ets_initial_state(y: np.ndarray) -> tuple[float, float]:
    """Heuristic initial level and trend shared with the TypeScript implementation."""
    level = float(np.mean(y[:7]))
    trend = float((np.mean(y[7:14]) - np.mean(y[:7])) / 7.0)
    return level, trend


def ets_filter(y: np.ndarray, alpha: float, beta: float | None, phi: float | None,
               l0: float, b0: float) -> tuple[np.ndarray, float, float]:
    """One-step-ahead fitted values and final state for SES (beta=None) or damped Holt."""
    level, trend = l0, (b0 if beta is not None else 0.0)
    fitted = np.empty(len(y))
    for t, obs in enumerate(y):
        if beta is None:
            fitted[t] = level
            level = alpha * obs + (1 - alpha) * level
        else:
            fitted[t] = level + phi * trend
            new_level = alpha * obs + (1 - alpha) * (level + phi * trend)
            trend = beta * (new_level - level) + (1 - beta) * phi * trend
            level = new_level
    return fitted, level, trend


def ets_forecast_from_state(level: float, trend: float, phi: float | None, horizon: int) -> np.ndarray:
    if phi is None:
        return np.full(horizon, level)
    damp = np.cumsum(phi ** np.arange(1, horizon + 1))
    return level + damp * trend


def ets_aic(sse: float, n: int, k: int) -> float:
    return n * np.log(sse / n) + 2 * k


@dataclass
class EtsFit:
    kind: str                  # "SES" or "Holt-damped"
    alpha: float
    beta: float | None
    phi: float | None
    l0: float
    b0: float
    sse: float
    aic: float
    level: float
    trend: float

    def forecast(self, horizon: int) -> np.ndarray:
        return ets_forecast_from_state(self.level, self.trend, self.phi, horizon)


def fit_ets(y: np.ndarray) -> EtsFit:
    """Fit SES and damped Holt with statsmodels (known initial state) and keep the lower AIC."""
    return min(fit_ets_candidates(y), key=lambda fit: fit.aic)


def fit_ets_candidates(y: np.ndarray) -> list[EtsFit]:
    """Both candidate fits (SES, damped Holt), each optimised by statsmodels within ETS_BOUNDS."""
    import warnings

    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    y = np.asarray(y, float)
    l0, b0 = ets_initial_state(y)
    fits = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ses = ExponentialSmoothing(y, trend=None, initialization_method="known", initial_level=l0,
                                   bounds={"smoothing_level": ETS_BOUNDS["smoothing_level"]}).fit()
        holt = ExponentialSmoothing(y, trend="add", damped_trend=True, initialization_method="known",
                                    initial_level=l0, initial_trend=b0, bounds=ETS_BOUNDS).fit()
    for kind, res, k in (("SES", ses, 1), ("Holt-damped", holt, 3)):
        p = res.params
        alpha = float(p["smoothing_level"])
        beta = float(p["smoothing_trend"]) if kind != "SES" else None
        phi = float(p["damping_trend"]) if kind != "SES" else None
        fitted, level, trend = ets_filter(y, alpha, beta, phi, l0, b0)
        sse = float(np.sum((y - fitted) ** 2))
        fits.append(EtsFit(kind, alpha, beta, phi, l0, b0, sse, ets_aic(sse, len(y), k), level, trend))
    return fits


# --------------------------------------------------------------------------- Ridge
def ridge_row(z: np.ndarray, exog: np.ndarray, t: int) -> np.ndarray:
    """Feature row (RIDGE_FEATURES order) for target day t from demand path z (days < t)."""
    return np.concatenate([
        [z[t - 1], z[t - 7], z[t - 14], z[t - 7:t].mean(), z[t - 28:t].mean()],
        exog[t],
    ])


@dataclass
class RidgeFit:
    alpha: float
    mean: np.ndarray
    scale: np.ndarray
    coef: np.ndarray
    intercept: float

    def predict_row(self, row: np.ndarray) -> float:
        return float(self.intercept + ((row - self.mean) / self.scale) @ self.coef)


def fit_ridge(y: np.ndarray, exog: np.ndarray, origin: int, alpha: float) -> RidgeFit:
    """Standardised ridge with an unpenalised intercept on rows t = MIN_HISTORY..origin."""
    rows = np.array([ridge_row(y, exog, t) for t in range(MIN_HISTORY, origin + 1)])
    target = np.asarray(y[MIN_HISTORY:origin + 1], float)
    mean = rows.mean(axis=0)
    scale = rows.std(axis=0)
    scale[scale < 1e-12] = 1.0
    z = (rows - mean) / scale
    coef = np.linalg.solve(z.T @ z + alpha * np.eye(z.shape[1]), z.T @ (target - target.mean()))
    return RidgeFit(alpha, mean, scale, coef, float(target.mean()))


def ridge_forecast(y: np.ndarray, exog: np.ndarray, origin: int, fit: RidgeFit, horizon: int) -> np.ndarray:
    """Recursive multi-step forecast: predictions feed the lag features of later days."""
    z = np.asarray(y[:origin + 1], float).tolist()
    out = []
    for t in range(origin + 1, origin + horizon + 1):
        pred = max(0.0, fit.predict_row(ridge_row(np.asarray(z), exog, t)))
        out.append(pred)
        z.append(pred)
    return np.array(out)


# --------------------------------------------------------------------------- LSTM
def lstm_scales(panel: Panel) -> np.ndarray:
    """Per-SKU demand scale = mean demand over the training period."""
    return panel.demand[:, : panel.split.train_end + 1].mean(axis=1)


def lstm_inputs(panel: Panel, sku_idx: int, origin: int, scale: float,
                exog: np.ndarray, horizon: int = HORIZON) -> tuple[np.ndarray, np.ndarray]:
    """Encoder window (LSTM_WINDOW x 10) and flattened future exogenous block (horizon x 9)."""
    lo = origin - LSTM_WINDOW + 1
    enc = np.column_stack([panel.demand[sku_idx, lo:origin + 1] / scale, exog[lo:origin + 1]])
    fut = exog[origin + 1:origin + 1 + horizon].reshape(-1)
    return enc.astype(np.float32), fut.astype(np.float32)


def lstm_training_set(panel: Panel, origins: range, scales: np.ndarray):
    """Windows from every SKU at the given origins, using *actual* future exogenous values."""
    enc, fut, tgt = [], [], []
    for s in range(len(panel.skus)):
        exog = exog_matrix(panel, s)
        for o in origins:
            e, f = lstm_inputs(panel, s, o, scales[s], exog)
            enc.append(e)
            fut.append(f)
            tgt.append(panel.demand[s, o + 1:o + 1 + HORIZON] / scales[s])
    return np.stack(enc), np.stack(fut), np.stack(tgt).astype(np.float32)


def build_lstm(n_exog: int = len(EXOG_FEATURES)):
    """Global LSTM forecaster. recurrent_activation is pinned to sigmoid so TF.js matches."""
    import keras

    enc_in = keras.Input((LSTM_WINDOW, n_exog + 1), name="encoder")
    fut_in = keras.Input((HORIZON * n_exog,), name="future")
    h = keras.layers.LSTM(LSTM_UNITS, activation="tanh", recurrent_activation="sigmoid", name="lstm")(enc_in)
    z = keras.layers.Concatenate(name="concat")([h, fut_in])
    z = keras.layers.Dense(LSTM_DENSE, activation="relu", name="dense_hidden")(z)
    out = keras.layers.Dense(HORIZON, name="dense_out")(z)
    return keras.Model([enc_in, fut_in], out, name="lstm_forecaster")


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr, dtype="<f4").tobytes()).decode("ascii")


def export_lstm_weights(model) -> dict:
    """Serialise weights layer by layer (base64 little-endian float32) for TF.js."""
    layers = []
    for name in ("lstm", "dense_hidden", "dense_out"):
        layer = model.get_layer(name)
        layers.append({
            "name": name,
            "weights": [{"shape": list(w.shape), "data": _b64(w)} for w in layer.get_weights()],
        })
    return {
        "format": "lstm-forecaster/v1",
        "window": LSTM_WINDOW,
        "horizon": HORIZON,
        "units": LSTM_UNITS,
        "dense": LSTM_DENSE,
        "encoderFeatures": ["demand_scaled", *EXOG_FEATURES],
        "futureFeatures": EXOG_FEATURES,
        "recurrentActivation": "sigmoid",
        "layers": layers,
    }


def load_lstm_weights(model, payload: dict) -> None:
    for layer in payload["layers"]:
        weights = [
            np.frombuffer(base64.b64decode(w["data"]), dtype="<f4").reshape(w["shape"])
            for w in layer["weights"]
        ]
        model.get_layer(layer["name"]).set_weights(weights)


# --------------------------------------------------------------------------- forecasters
Forecaster = Callable[[Panel, int], np.ndarray]   # (panel, origin) -> (n_sku, HORIZON)


def static_mean_forecaster(panel: Panel, origin: int) -> np.ndarray:
    m = panel.demand[:, : origin + 1].mean(axis=1)
    return np.repeat(m[:, None], HORIZON, axis=1)


def naive_forecaster(panel: Panel, origin: int) -> np.ndarray:
    return np.repeat(panel.demand[:, origin, None].astype(float), HORIZON, axis=1)


def ma28_forecaster(panel: Panel, origin: int) -> np.ndarray:
    m = panel.demand[:, origin - 27: origin + 1].mean(axis=1)
    return np.repeat(m[:, None], HORIZON, axis=1)


def ets_forecaster(panel: Panel, origin: int) -> np.ndarray:
    return np.stack([fit_ets(panel.demand[s, : origin + 1]).forecast(HORIZON) for s in range(len(panel.skus))])


def make_ridge_forecaster(alpha: float) -> Forecaster:
    def forecaster(panel: Panel, origin: int) -> np.ndarray:
        epi = epidemic_path(panel, origin)
        out = []
        for s in range(len(panel.skus)):
            exog = exog_matrix(panel, s, epidemic=epi)
            fit = fit_ridge(panel.demand[s], exog, origin, alpha)
            out.append(ridge_forecast(panel.demand[s], exog, origin, fit, HORIZON))
        return np.stack(out)
    return forecaster


def make_lstm_forecaster(model, scales: np.ndarray) -> Forecaster:
    def forecaster(panel: Panel, origin: int) -> np.ndarray:
        epi = epidemic_path(panel, origin)
        enc, fut = zip(*(lstm_inputs(panel, s, origin, scales[s], exog_matrix(panel, s, epidemic=epi))
                         for s in range(len(panel.skus))))
        pred = model.predict([np.stack(enc), np.stack(fut)], verbose=0)
        return np.maximum(pred, 0.0) * scales[:, None]
    return forecaster


# --------------------------------------------------------------------------- backtest
@dataclass
class Backtest:
    """Long table of forecasts: one row per (model, sku, origin, horizon)."""

    rows: pd.DataFrame = field(default_factory=pd.DataFrame)


def rolling_origins(start: int, last_target: int, step: int = 7) -> list[int]:
    """Origins from ``start`` every ``step`` days such that the full horizon is observed."""
    return list(range(start, last_target - HORIZON + 1, step))


def run_backtest(panel: Panel, origins: list[int], forecasters: dict[str, Forecaster]) -> pd.DataFrame:
    scale = np.array([naive_mae_scale(panel.demand[s, : panel.split.train_end + 1]) for s in range(len(panel.skus))])
    frames = []
    for name, forecaster in forecasters.items():
        for o in origins:
            f = forecaster(panel, o)
            y = panel.demand[:, o + 1: o + 1 + HORIZON]
            n_sku = len(panel.skus)
            frames.append(pd.DataFrame({
                "model": name,
                "sku": np.repeat(panel.skus, HORIZON),
                "origin": o,
                "h": np.tile(np.arange(1, HORIZON + 1), n_sku),
                "y": y.reshape(-1).astype(float),
                "f": f.reshape(-1),
                "mase_scale": np.repeat(scale, HORIZON),
            }))
    return pd.concat(frames, ignore_index=True)


def leaderboard(bt: pd.DataFrame, max_h: int = HORIZON) -> pd.DataFrame:
    sub = bt[bt.h <= max_h]
    rows = {name: metrics(g.y, g.f, g.mase_scale) for name, g in sub.groupby("model")}
    return pd.DataFrame(rows).T.sort_values("WAPE")


def residual_quantiles(bt: pd.DataFrame, probs=(0.025, 0.1, 0.9, 0.975)) -> dict:
    """Empirical (y - f) quantiles per model and horizon: conformal-style interval offsets."""
    out: dict[str, dict[str, list[float]]] = {}
    for name, g in bt.assign(r=bt.y - bt.f).groupby("model"):
        q = g.groupby("h").r.quantile(list(probs)).unstack()
        out[name] = {f"q{int(round(p * 1000)):03d}": q[p].round(4).tolist() for p in probs}
    return out
