import { useCallback, useEffect, useRef, useState } from "react";
import type { CoreError, Result } from "../../core/bindings";

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
  useEffect(() => {
    setState({ status: "LOADING" });
    run();
    return () => void latest.current++;
  }, [key, run]);
  return [state, run];
}
