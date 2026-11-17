import { useEffect, useSyncExternalStore } from "react";

// What the page tells its toolbar: the thread's topic name and its subtitle, or the topic count. One per window.
export interface Head {
  title: string | null;
  subtitle: string | null;
}
let head: Head = { title: null, subtitle: null };
const listeners = new Set<() => void>();
export const setHead = (next: Head) => {
  head = next;
  listeners.forEach((l) => l());
};
export const useHead = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => head, () => head);
/** Publishes the page's head while it is shown, and clears it on leaving. */
export const usePublishHead = (title: string | null, subtitle: string | null) =>
  useEffect(() => (setHead({ title, subtitle }), () => setHead({ title: null, subtitle: null })), [title, subtitle]);
