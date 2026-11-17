import { useSyncExternalStore } from "react";

// The Topics search words are shared by the page's toolbar field and its table; they last for the window, not a restart.
let words = "";
const listeners = new Set<() => void>();
export const topicWords = () => words;
export const setTopicWords = (next: string) => {
  words = next;
  listeners.forEach((l) => l());
};
export const useTopicWords = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), topicWords, topicWords);
