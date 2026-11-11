/**
 * WebGL cost surface (echarts-gl), loaded only when the user asks for the 3-D view.
 * Registers just the GL pieces it needs on the shared tree-shaken ECharts core.
 */
import { Scatter3DChart, SurfaceChart } from "echarts-gl/charts";
import { Grid3DComponent } from "echarts-gl/components";
import { VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([SurfaceChart, Scatter3DChart, Grid3DComponent, VisualMapComponent, CanvasRenderer] as Parameters<typeof echarts.use>[0]);
import type { SurrogateGrid } from "../../lib/optimization/sensitivity";
import { COLORS } from "../../app/theme";

interface Props {
  grid: SurrogateGrid;
  best: { r: number; q: number; cost: number } | null;
  height?: number;
}

export default function Surface3D({ grid, best, height = 380 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    // Clip the height at 3× the cheapest predicted cost: far-off, very expensive policies would
    // otherwise flatten the region around the optimum (same rule as the 2-D map's colour scale).
    let minCost = Infinity;
    grid.mean.forEach((row) => row.forEach((v) => (minCost = Math.min(minCost, v))));
    const cap = 3 * minCost;
    const data: [number, number, number][] = [];
    grid.y.forEach((q, iy) => grid.x.forEach((r, ix) => data.push([r, q, Math.min(grid.mean[iy][ix], cap)])));
    const costs = data.map((d) => d[2]);
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: { show: false },
      visualMap: {
        show: false, dimension: 2, min: Math.min(...costs), max: Math.max(...costs),
        inRange: { color: ["#a78bfa", "#22d3ee", "#34d399", "#f59e0b", "#f43f5e"] },
      },
      xAxis3D: { type: "value", name: "Reorder point", nameTextStyle: { color: COLORS.muted }, axisLabel: { color: COLORS.faint } },
      yAxis3D: { type: "value", name: "Order qty", nameTextStyle: { color: COLORS.muted }, axisLabel: { color: COLORS.faint } },
      zAxis3D: { type: "value", name: "Annual cost", nameTextStyle: { color: COLORS.muted }, axisLabel: { color: COLORS.faint } },
      grid3D: {
        boxWidth: 100, boxDepth: 80, boxHeight: 60,
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.4)" } },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } },
        axisPointer: { show: false },
        viewControl: { autoRotate: true, autoRotateSpeed: 6, distance: 210, alpha: 28, beta: 35 },
        light: { main: { intensity: 1.1, shadow: false }, ambient: { intensity: 0.35 } },
      },
      series: [
        { type: "surface", data, dataShape: [grid.y.length, grid.x.length], shading: "lambert", wireframe: { show: true, lineStyle: { color: "rgba(10,15,28,0.35)", width: 0.6 } } },
        ...(best ? [{ type: "scatter3D", data: [[best.r, best.q, best.cost]], symbolSize: 14, itemStyle: { color: "#ffffff", borderColor: COLORS.opt, borderWidth: 3 } }] : []),
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [grid, best]);
  return <div ref={ref} role="img" aria-label="3D surrogate surface of annual cost over reorder point and order quantity" style={{ height, width: "100%" }} />;
}
