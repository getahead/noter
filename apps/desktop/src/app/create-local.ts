import { useSyncExternalStore } from "react";

export function createLocal<T extends object>() {
  const none = {} as T;
  let rows = new Map<string, T>();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
  const patchLocal = (id: string, patch: { [K in keyof T]: T[K] | undefined }) => {
    const next = { ...rows.get(id), ...patch } as T;
    for (const key of Object.keys(next) as (keyof T)[]) if (next[key] === undefined) delete next[key];
    rows = new Map(rows).set(id, next);
    listeners.forEach((listener) => listener());
  };
  const localOf = (id: string): T => rows.get(id) ?? none;
  const useLocal = (id: string): T => useSyncExternalStore(subscribe, () => localOf(id), () => localOf(id));
  const useLocals = () => useSyncExternalStore(subscribe, () => rows, () => rows);
  const resetLocal = () => ((rows = new Map()), listeners.forEach((listener) => listener()));
  return { patchLocal, localOf, useLocal, useLocals, resetLocal };
}
