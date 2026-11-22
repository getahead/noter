// What the Calls page tells its toolbar: the selected ids and how to export them (the toolbar's Export… and ⌘E).
let ids: string[] = [];
/** Every selected call is still recording: nothing to export yet (issue 1053). */
let recordingOnly = false;
let open: ((ids: string[]) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const exportStore = {
  subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
  get: () => ids,
  /** The page publishes its selection; the same array is kept while it is unchanged. */
  setIds(next: string[], onlyRecording = false) {
    const same = next.length === ids.length && next.every((x, i) => x === ids[i]);
    if (same && onlyRecording === recordingOnly) return;
    if (!same) ids = next;
    recordingOnly = onlyRecording;
    emit();
  },
  isRecordingOnly: () => recordingOnly,
  setOpener(f: ((ids: string[]) => void) | null) {
    open = f;
  },
  run: () => void (ids.length > 0 && !recordingOnly && open?.(ids)),
};
