import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compileSizeExpression } from "./src/build/safeSizeExpression";

/**
 * Keep the production Content-Security-Policy strict (no 'unsafe-eval'): replace the single
 * `new Function` in claygl (used by the WebGL 3D view) with a safe arithmetic evaluator.
 */
function claygLNoEval(): Plugin {
  const target = /claygl[\\/]src[\\/]createCompositor\.js$/;
  const evalCall = "new Function('width', 'height', 'dpr', 'return ' + exprRes[1])";
  return {
    name: "claygl-no-eval",
    enforce: "pre",
    transform(code, id) {
      if (!target.test(id.split("?")[0])) return null;
      if (!code.includes(evalCall)) this.error("claygl changed: expected expression compiler not found; review the CSP patch");
      return `${code.replace(evalCall, "compileSizeExpression(exprRes[1])")}\n${compileSizeExpression.toString()}\n`;
    },
  };
}

export default defineConfig({
  plugins: [claygLNoEval(), react(), tailwindcss()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
