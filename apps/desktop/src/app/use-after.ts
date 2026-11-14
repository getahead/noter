import { useEffect, useState } from "react";

/** Calls `set(true)` once `active` has held for `ms` (and `set(false)` while it does not); returns the cleanup. */
export function afterTimer(ms: number, active: boolean, set: (late: boolean) => void): (() => void) | undefined {
  if (!active) return void set(false);
  const id = setTimeout(() => set(true), ms);
  return () => clearTimeout(id);
}

/** True once `active` has held for `ms`; useful for loading UI that should not flash for a quick read. */
export function useAfter(ms: number, active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => afterTimer(ms, active, setLate), [ms, active]);
  return active && late;
}
