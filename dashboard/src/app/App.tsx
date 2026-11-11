import { lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { hydrate } from "../state/timeline";
import { Layout } from "./Layout";

let started = false;

const ControlTower = lazy(() => import("../pages/ControlTower"));
const Forecasting = lazy(() => import("../pages/Forecasting"));
const SafetyStock = lazy(() => import("../pages/SafetyStock"));
const Simulation = lazy(() => import("../pages/Simulation"));
const Optimization = lazy(() => import("../pages/Optimization"));
const Method = lazy(() => import("../pages/Method"));

export function App() {
  useEffect(() => {
    // Restore the saved timeline once (StrictMode mounts effects twice in development).
    if (started) return;
    started = true;
    void hydrate();
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ControlTower />} />
          <Route path="forecasting" element={<Forecasting />} />
          <Route path="safety-stock" element={<SafetyStock />} />
          <Route path="simulation" element={<Simulation />} />
          <Route path="optimization" element={<Optimization />} />
          <Route path="method" element={<Method />} />
          <Route path="*" element={<ControlTower />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
