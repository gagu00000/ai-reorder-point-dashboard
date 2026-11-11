/**
 * Run an async worker call keyed by `key`, with:
 *  - a small shared cache, so revisiting a page or SKU is instant;
 *  - debouncing, so dragging a slider does not queue dozens of simulations;
 *  - stale-result protection: only the latest request may update the view;
 *  - previous data kept on screen while a new result is computed (no flashing).
 */
import { useEffect, useRef, useState } from "react";

const cache = new Map<string, unknown>();
const MAX_ENTRIES = 80;

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
}

export function useWorkerQuery<T>(key: string | null, run: () => Promise<T>, debounceMs = 150): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>(() => ({
    data: key ? (cache.get(key) as T | undefined) : undefined,
    loading: key ? !cache.has(key) : false,
    error: null,
  }));
  const latest = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!key) return;
    const ticket = ++latest.current;
    if (cache.has(key)) {
      setState({ data: cache.get(key) as T, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      runRef.current().then(
        (data) => {
          remember(key, data);
          if (ticket === latest.current) setState({ data, loading: false, error: null });
        },
        (err: unknown) => {
          if (ticket === latest.current) setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
        },
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [key, debounceMs]);

  return state;
}
