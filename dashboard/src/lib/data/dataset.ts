import type { Dataset, SeriesFile } from "./types";

/** Convert the compact JSON produced by `scripts/preprocess.py` into typed arrays. */
export function buildDataset(file: SeriesFile): Dataset {
  const storeIndex = new Map(file.stores.map((s, i) => [s.id, i]));
  return {
    dates: file.dates.slice(),
    epidemic: Float64Array.from(file.epidemic),
    stores: file.stores.map((s) => ({ id: s.id, region: s.region, weather: Int8Array.from(s.weather) })),
    skus: file.skus.map((s) => {
      const idx = storeIndex.get(s.store);
      if (idx === undefined) throw new Error(`SKU ${s.id} references unknown store ${s.store}`);
      return {
        id: s.id,
        store: s.store,
        storeIndex: idx,
        product: s.product,
        category: s.category,
        demand: Float64Array.from(s.demand),
        unitsSold: Float64Array.from(s.unitsSold),
        inventory: Float64Array.from(s.inventory),
        unitsOrdered: Float64Array.from(s.unitsOrdered),
        promotion: Float64Array.from(s.promotion),
        discount: Float64Array.from(s.discount),
      };
    }),
    split: { ...file.meta.split },
  };
}

export function skuIndexById(dataset: Dataset, id: string): number {
  const idx = dataset.skus.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Unknown SKU ${id}`);
  return idx;
}
