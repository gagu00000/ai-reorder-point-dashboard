/** echarts-gl ships no type definitions; its modular entry points export ECharts `use()` installers. */
declare module "echarts-gl/charts" {
  type Installer = (registers: unknown) => void;
  export const SurfaceChart: Installer;
  export const Scatter3DChart: Installer;
}

declare module "echarts-gl/components" {
  type Installer = (registers: unknown) => void;
  export const Grid3DComponent: Installer;
}
