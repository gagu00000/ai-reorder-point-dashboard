"""Shared data utilities for the AI-enhanced reorder-point project.

Everything that touches the raw Kaggle file lives here so the preprocessing
script, the notebooks and the fixture exporter use one definition of:

* how the CSV is loaded and validated,
* the time-ordered train / validation / holdout split,
* how supplier lead times are recovered from the inventory ledger,
* the calendar and exogenous features shared with the TypeScript models.

Units used throughout: demand in units/day, lead time in days.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_CSV = ROOT / "sales_data.csv"
DATA_OUT = ROOT / "dashboard" / "public" / "data"
FIXTURES_OUT = ROOT / "dashboard" / "tests" / "fixtures"

SOURCE_NAME = "Retail Store Inventory and Demand Forecasting (atomicd), Kaggle"
SOURCE_URL = "https://www.kaggle.com/datasets/atomicd/retail-store-inventory-and-demand-forecasting"
SOURCE_LICENSE = "Apache-2.0"

WEATHER_CODES = ["Cloudy", "Rainy", "Snowy", "Sunny"]  # Cloudy is the reference level
# Price is generated from same-day demand (see notebooks/01_data_audit.ipynb) and
# Competitor Pricing is a near-copy of Price, so neither may reach a forecaster.
LEAKY_COLUMNS = ["Price", "Competitor Pricing"]
# Discount is fully determined by Promotion and adds no information beyond it.
REDUNDANT_COLUMNS = ["Discount"]

TRAIN_END = pd.Timestamp("2023-09-02")
VAL_END = pd.Timestamp("2023-12-01")

# Exogenous features for a target day, in the exact order used by the Ridge and
# LSTM models in Python and TypeScript.
EXOG_FEATURES = [
    "promotion", "epidemic", "w_rainy", "w_snowy", "w_sunny",
    "sin1", "cos1", "sin2", "cos2",
]


def load_raw(path: Path = RAW_CSV) -> pd.DataFrame:
    """Load the raw CSV, add a SKU key (store-product pair) and sort by SKU and date."""
    df = pd.read_csv(path, parse_dates=["Date"])
    df["SKU"] = df["Store ID"] + "-" + df["Product ID"]
    return df.sort_values(["SKU", "Date"]).reset_index(drop=True)


def validate(df: pd.DataFrame) -> None:
    """Fail loudly if the file breaks any assumption the pipeline relies on."""
    if df.isna().any().any():
        raise ValueError("Dataset contains missing values")
    if df.duplicated(["Date", "SKU"]).any():
        raise ValueError("Duplicate Date-SKU rows found")
    calendar = pd.date_range(df["Date"].min(), df["Date"].max())
    days_per_sku = df.groupby("SKU")["Date"].nunique()
    if not (days_per_sku == len(calendar)).all():
        raise ValueError("Every SKU must have one row for every calendar day")
    weather_per_store_day = df.groupby(["Date", "Store ID"])["Weather Condition"].nunique()
    if (weather_per_store_day != 1).any():
        raise ValueError("Weather must be constant within a store and day")
    if (df.groupby("Date")["Epidemic"].nunique() != 1).any():
        raise ValueError("Epidemic flag must be constant across SKUs on a given day")
    unknown = set(df["Weather Condition"]) - set(WEATHER_CODES)
    if unknown:
        raise ValueError(f"Unknown weather codes: {sorted(unknown)}")


@dataclass(frozen=True)
class Split:
    """Inclusive day indices of the time-ordered split."""

    train_end: int
    val_start: int
    val_end: int
    holdout_start: int
    holdout_end: int


def make_split(dates: pd.DatetimeIndex) -> Split:
    train_end = int(dates.get_loc(TRAIN_END))
    val_end = int(dates.get_loc(VAL_END))
    return Split(train_end, train_end + 1, val_end, val_end + 1, len(dates) - 1)


@dataclass
class Panel:
    """Wide (SKU x day) arrays built from the long CSV."""

    dates: pd.DatetimeIndex
    skus: list[str]
    sku_store: list[str]
    sku_product: list[str]
    sku_category: list[str]
    stores: list[str]
    store_region: dict[str, str]
    demand: np.ndarray        # (n_sku, n_days) int
    units_sold: np.ndarray
    inventory: np.ndarray
    units_ordered: np.ndarray
    promotion: np.ndarray
    discount: np.ndarray
    price: np.ndarray         # cost use only, never a forecasting feature
    weather: np.ndarray       # (n_store, n_days) int code into WEATHER_CODES
    epidemic: np.ndarray      # (n_days,) int
    split: Split

    def store_index(self, sku_idx: int) -> int:
        return self.stores.index(self.sku_store[sku_idx])


def build_panel(df: pd.DataFrame) -> Panel:
    dates = pd.DatetimeIndex(sorted(df["Date"].unique()))

    def wide(col: str) -> np.ndarray:
        return df.pivot(index="SKU", columns="Date", values=col).loc[:, dates].to_numpy()

    meta = df.groupby("SKU")[["Store ID", "Product ID", "Category"]].first()
    stores = sorted(df["Store ID"].unique())
    store_weather = (
        df.groupby(["Store ID", "Date"])["Weather Condition"].first().unstack().loc[stores, dates]
    )
    weather_codes = store_weather.apply(lambda col: col.map(WEATHER_CODES.index)).to_numpy()
    epidemic = df.groupby("Date")["Epidemic"].first().loc[dates].to_numpy()

    return Panel(
        dates=dates,
        skus=list(meta.index),
        sku_store=list(meta["Store ID"]),
        sku_product=list(meta["Product ID"]),
        sku_category=list(meta["Category"]),
        stores=stores,
        store_region=df.groupby("Store ID")["Region"].first().to_dict(),
        demand=wide("Demand").astype(int),
        units_sold=wide("Units Sold").astype(int),
        inventory=wide("Inventory Level").astype(int),
        units_ordered=wide("Units Ordered").astype(int),
        promotion=wide("Promotion").astype(int),
        discount=wide("Discount").astype(int),
        price=wide("Price").astype(float),
        weather=weather_codes.astype(int),
        epidemic=epidemic.astype(int),
        split=make_split(dates),
    )


def extract_lead_times(
    inventory: np.ndarray, units_sold: np.ndarray, units_ordered: np.ndarray, max_lag: int = 30
) -> tuple[list[tuple[int, int, int]], int]:
    """Recover supplier lead times from one SKU's daily inventory ledger.

    The ledger closes as ``inventory[t+1] = inventory[t] - sold[t] + receipt[t]``,
    so ``receipt[t]`` is the stock that arrived overnight between day t and t+1.
    Each order placed on day t is matched to the first unused receipt of exactly
    the same quantity on or after day t. An order placed on day t and received
    overnight after day t+k is available on day t+k+1, giving a lead time of
    ``k + 1`` days.

    Returns ``([(order_day, lead_time_days, quantity), ...], n_unmatched)``.
    """
    n = len(inventory)
    receipts = np.full(n, np.nan)
    receipts[:-1] = inventory[1:] - (inventory[:-1] - units_sold[:-1])
    used = np.zeros(n, dtype=bool)
    matches: list[tuple[int, int, int]] = []
    unmatched = 0
    for t in np.flatnonzero(units_ordered > 0):
        hit = None
        for k in range(max_lag + 1):
            j = t + k
            if j >= n - 1:
                break
            if not used[j] and abs(receipts[j] - units_ordered[t]) < 0.5:
                hit = k
                break
        if hit is None:
            unmatched += 1
        else:
            used[t + hit] = True
            matches.append((int(t), hit + 1, int(units_ordered[t])))
    return matches, unmatched


def fourier_terms(dates: pd.DatetimeIndex) -> np.ndarray:
    """Yearly Fourier terms (two harmonics) from day-of-year: sin1, cos1, sin2, cos2."""
    angle = 2.0 * np.pi * (dates.dayofyear.to_numpy() - 1) / 365.25
    return np.column_stack([np.sin(angle), np.cos(angle), np.sin(2 * angle), np.cos(2 * angle)])


def exog_matrix(panel: Panel, sku_idx: int, epidemic: np.ndarray | None = None) -> np.ndarray:
    """Exogenous features (EXOG_FEATURES order) for every day of one SKU.

    ``epidemic`` lets callers substitute an assumed epidemic path (persistence or
    a scenario) for the actual flag.
    """
    weather = panel.weather[panel.store_index(sku_idx)]
    epi = panel.epidemic if epidemic is None else epidemic
    return np.column_stack([
        panel.promotion[sku_idx],
        epi,
        (weather == WEATHER_CODES.index("Rainy")).astype(float),
        (weather == WEATHER_CODES.index("Snowy")).astype(float),
        (weather == WEATHER_CODES.index("Sunny")).astype(float),
        fourier_terms(panel.dates),
    ]).astype(float)
