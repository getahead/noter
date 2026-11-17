import { useCallback, useEffect, useRef, useState } from "react";
import type { CoreError, Result } from "../../core/bindings";

/** True the first time `key` is claimed on `ref`, false for the repeat of React's dev double-mount. */
export function claim(ref: { current: string | null }, key: string): boolean {
  if (ref.current === key) return false;
  ref.current = key;
  return true;
}

export type Read<T> = { status: "LOADING" } | { status: "READY"; data: T } | { status: "ERROR"; error: CoreError };

/** One read of the core: LOADING, then READY or ERROR. `retry` (and a changed `key`) reads again; an answer older than the last request is dropped, and nothing repeats on its own. */
export function useRead<T>(load: () => Promise<Result<T>>, key: string): [Read<T>, () => void] {
  const [state, setState] = useState<Read<T>>({ status: "LOADING" });
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  const run = useCallback(() => {
    const mine = ++latest.current;
    setState((s) => (s.status === "ERROR" ? { status: "LOADING" } : s));
    void loader.current().then((res) => {
      if (mine !== latest.current) return;
      setState(res.status === "ok" ? { status: "READY", data: res.data } : { status: "ERROR", error: res.error });
    });
  }, []);
  // React's dev double-mount runs this effect twice for one key: the read goes out once (a newer key still supersedes it in `run`).
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!claim(started, key)) return;
    setState({ status: "LOADING" });
    run();
  }, [key, run]);
  return [state, run];
}
