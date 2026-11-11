/**
 * Thin ECharts wrapper (tree-shaken core, canvas renderer). Resizes with its container, disposes on
 * unmount, and applies the dark "control tower" styling through `baseAxis` / `baseTooltip` helpers.
 */
import { BarChart, CustomChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent,
  TooltipComponent, VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { COLORS } from "../../app/theme";

echarts.use([
  LineChart, BarChart, ScatterChart, CustomChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, MarkLineComponent,
  MarkPointComponent, VisualMapComponent, CanvasRenderer,
]);

export type EChartOption = echarts.EChartsCoreOption;

export function EChart({ option, height = 300, ariaLabel }: { option: EChartOption; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(
      { backgroundColor: "transparent", textStyle: { fontFamily: "Inter Variable, system-ui, sans-serif", color: COLORS.muted }, animationDuration: 450, ...option },
      { notMerge: true },
    );
  }, [option]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
}

export const baseGrid = { left: 52, right: 18, top: 36, bottom: 36, containLabel: false };

export function baseAxis(extra: Record<string, unknown> = {}) {
  return {
    axisLine: { lineStyle: { color: "rgba(148,163,184,0.25)" } },
    axisTick: { show: false },
    axisLabel: { color: COLORS.faint, fontSize: 11 },
    splitLine: { lineStyle: { color: "rgba(148,163,184,0.08)", type: "dashed" } },
    nameTextStyle: { color: COLORS.faint, fontSize: 11 },
    ...extra,
  };
}

export const baseTooltip = {
  backgroundColor: COLORS.panel,
  borderColor: "rgba(148,163,184,0.25)",
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: COLORS.text, fontSize: 12 },
  extraCssText: "backdrop-filter: blur(8px); border-radius: 10px; box-shadow: 0 10px 30px -10px rgba(0,0,0,.7);",
};

export const baseLegend = {
  top: 0,
  right: 0,
  icon: "roundRect",
  itemWidth: 12,
  itemHeight: 4,
  textStyle: { color: COLORS.muted, fontSize: 11 },
  inactiveColor: "#334155",
};
