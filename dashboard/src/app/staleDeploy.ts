/**
 * After a redeploy, an open page may ask for code files (lazy pages, workers) that no longer exist.
 * Reload once to pick up the new version instead of failing; the session flag prevents reload loops.
 */
const FLAG = "rop-reloaded-after-deploy";

export function recoverFromStaleDeploy(): boolean {
  try {
    if (sessionStorage.getItem(FLAG)) return false;
    sessionStorage.setItem(FLAG, "1");
  } catch {
    return false; // storage blocked: do not risk a loop
  }
  window.location.reload();
  return true;
}

export function installStaleDeployRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    if (recoverFromStaleDeploy()) event.preventDefault();
  });
  // A successful start means this page matches the deployed files: allow a future recovery.
  window.addEventListener("load", () => {
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      // ignore
    }
  });
}
