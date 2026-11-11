"""Build the compact data files the dashboard loads.

Reads ``sales_data.csv`` (git-ignored) and writes to ``dashboard/public/data``:

* ``series.json``    daily demand, ledger and non-leaky drivers for all 100 SKUs
* ``leadtimes.json`` lead times recovered from the inventory ledger
* ``costs.json``     per-SKU cost parameters and the as-is (historical) policy summary

Price and Competitor Pricing are never written to ``series.json``: they are
generated from same-day demand and would leak the target. Only each SKU's
median price is exported, as a cost parameter.

Usage:  python scripts/preprocess.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from inventory_data import (
    DATA_OUT, LEAKY_COLUMNS, REDUNDANT_COLUMNS, SOURCE_LICENSE, SOURCE_NAME, SOURCE_URL,
    WEATHER_CODES, Panel, build_panel, extract_lead_times, load_raw, validate,
)

DEFAULT_COSTS = {
    "holdingRatePerYear": 0.25,   # share of unit price per unit-year
    "orderCost": 50.0,            # per purchase order
    "marginRate": 0.40,           # lost margin per unit short, as share of price
    "daysPerYear": 365,
}


def series_payload(panel: Panel) -> dict:
    s = panel.split
    iso = [d.strftime("%Y-%m-%d") for d in panel.dates]
    return {
        "meta": {
            "source": SOURCE_NAME,
            "sourceUrl": SOURCE_URL,
            "license": SOURCE_LICENSE,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "startDate": iso[0],
            "endDate": iso[-1],
            "nDays": len(iso),
            "units": {"demand": "units/day", "leadTime": "days", "price": "currency/unit"},
            "split": {
                "trainEnd": iso[s.train_end], "trainEndIdx": s.train_end,
                "valStart": iso[s.val_start], "valEnd": iso[s.val_end], "valEndIdx": s.val_end,
                "holdoutStart": iso[s.holdout_start], "holdoutStartIdx": s.holdout_start,
                "holdoutEnd": iso[s.holdout_end],
            },
            "weatherCodes": WEATHER_CODES,
            "excludedColumns": {
                "leakage": LEAKY_COLUMNS,
                "redundantFeature": REDUNDANT_COLUMNS,
            },
            "target": "Demand",
        },
        "dates": iso,
        "epidemic": panel.epidemic.tolist(),
        "stores": [
            {"id": st, "region": panel.store_region[st], "weather": panel.weather[i].tolist()}
            for i, st in enumerate(panel.stores)
        ],
        "skus": [
            {
                "id": sku,
                "store": panel.sku_store[i],
                "product": panel.sku_product[i],
                "category": panel.sku_category[i],
                "demand": panel.demand[i].tolist(),
                "unitsSold": panel.units_sold[i].tolist(),
                "inventory": panel.inventory[i].tolist(),
                "unitsOrdered": panel.units_ordered[i].tolist(),
                "promotion": panel.promotion[i].tolist(),
                "discount": panel.discount[i].tolist(),
            }
            for i, sku in enumerate(panel.skus)
        ],
    }


def leadtime_payload(panel: Panel) -> tuple[dict, dict[str, list[tuple[int, int, int]]]]:
    per_sku: dict[str, dict] = {}
    matches_by_sku: dict[str, list[tuple[int, int, int]]] = {}
    pools: dict[str, list[int]] = {st: [] for st in panel.stores}
    total_orders = total_unmatched = 0
    for i, sku in enumerate(panel.skus):
        matches, unmatched = extract_lead_times(panel.inventory[i], panel.units_sold[i], panel.units_ordered[i])
        matches_by_sku[sku] = matches
        lts = np.array([m[1] for m in matches])
        total_orders += len(matches) + unmatched
        total_unmatched += unmatched
        pools[panel.sku_store[i]].extend(lts.tolist())
        per_sku[sku] = {
            "L": float(lts.mean()),
            "sd": float(lts.std(ddof=1)),
            "nOrders": int(len(lts)),
            "unmatched": int(unmatched),
        }

    def summarise(values: list[int]) -> dict:
        arr = np.array(values)
        vals, counts = np.unique(arr, return_counts=True)
        return {
            "values": vals.tolist(),
            "probs": (counts / counts.sum()).round(6).tolist(),
            "mean": float(arr.mean()),
            "sd": float(arr.std(ddof=1)),
            "n": int(arr.size),
        }

    all_lts = [lt for pool in pools.values() for lt in pool]
    payload = {
        "method": (
            "Each order is matched to the first later overnight receipt of the same quantity in the "
            "inventory ledger (inventory[t+1] = inventory[t] - unitsSold[t] + receipt[t]). "
            "Lead time = days from order day until the stock is available."
        ),
        "assumption": (
            "Lead time is constant within each SKU in this dataset, so sigma_L for a SKU is taken from "
            "its store's pooled lead-time distribution (variability of that store's supplier lanes)."
        ),
        "totalOrders": total_orders,
        "matchedOrders": total_orders - total_unmatched,
        "overall": summarise(all_lts),
        "stores": {st: summarise(pool) for st, pool in pools.items()},
        "skus": per_sku,
    }
    return payload, matches_by_sku


def costs_payload(panel: Panel, matches_by_sku: dict[str, list[tuple[int, int, int]]]) -> dict:
    skus = {}
    years = len(panel.dates) / DEFAULT_COSTS["daysPerYear"]
    for i, sku in enumerate(panel.skus):
        orders = panel.units_ordered[i][panel.units_ordered[i] > 0]
        stockout_days = panel.units_sold[i] >= panel.inventory[i]
        skus[sku] = {
            "medianPrice": round(float(np.median(panel.price[i])), 2),
            "maxInventory": int(panel.inventory[i].max()),
            "orderQty": {"min": int(orders.min()), "median": float(np.median(orders)), "max": int(orders.max())},
            "asIs": {
                "stockoutDayRate": round(float(stockout_days.mean()), 4),
                "avgInventory": round(float(panel.inventory[i].mean()), 2),
                "ordersPerYear": round(len(matches_by_sku[sku]) / years, 2),
                "fillRate": round(float(panel.units_sold[i].sum() / panel.demand[i].sum()), 4),
            },
        }
    return {"defaults": DEFAULT_COSTS, "skus": skus}


def main() -> None:
    df = load_raw()
    validate(df)
    panel = build_panel(df)
    DATA_OUT.mkdir(parents=True, exist_ok=True)

    series = series_payload(panel)
    leadtimes, matches = leadtime_payload(panel)
    costs = costs_payload(panel, matches)

    for name, payload in (("series.json", series), ("leadtimes.json", leadtimes), ("costs.json", costs)):
        path = DATA_OUT / name
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {path.relative_to(DATA_OUT.parents[2])}  ({path.stat().st_size / 1024:.0f} KB)")
    print(f"SKUs={len(panel.skus)} days={len(panel.dates)} split={panel.split}")
    print(f"lead times: matched {leadtimes['matchedOrders']}/{leadtimes['totalOrders']} orders, "
          f"overall mean {leadtimes['overall']['mean']:.3f} sd {leadtimes['overall']['sd']:.3f}")


if __name__ == "__main__":
    main()
