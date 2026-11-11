/** UI-only state for the Guide panel (kept apart from the analysis state). */
import { create } from "zustand";

export const useHelpStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** Per-viewer convenience flags (e.g. a collapsed guide); storage may be unavailable. */
export function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the setting simply is not remembered
  }
}
