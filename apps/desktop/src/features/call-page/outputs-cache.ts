// What the Summary view reads from the core and holds for the window's lifetime: the outputs of a call, a section's
// versions and the bodies of two versions being compared. The window store holds the rest (progress, whole sections).
import { useSyncExternalStore } from "react";

import type { CallOutputs, VersionBody, VersionList } from "../../core/bindings";

interface Held {
  outputs: Map<string, CallOutputs>;
  versions: Map<string, VersionList>;
  bodies: Map<string, VersionBody>;
}
let held: Held = { outputs: new Map(), versions: new Map(), bodies: new Map() };
const listeners = new Set<() => void>();
const emit = () => {
  held = { ...held };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const holdOutputs = (o: CallOutputs) => (held.outputs.set(o.call_id, o), emit());
export const holdVersions = (summaryId: string, v: VersionList) => (held.versions.set(summaryId, v), emit());
export const holdBody = (summaryId: string, b: VersionBody) => (held.bodies.set(`${summaryId}/${b.meta.id}`, b), emit());
export const resetOutputsCache = () => ((held = { outputs: new Map(), versions: new Map(), bodies: new Map() }), emit());

export const useOutputs = (callId: string): CallOutputs | undefined => useSyncExternalStore(subscribe, () => held.outputs.get(callId), () => held.outputs.get(callId));
export const useVersions = (summaryId: string | null): VersionList | undefined => useSyncExternalStore(subscribe, () => (summaryId ? held.versions.get(summaryId) : undefined), () => undefined);
export const bodyOf = (summaryId: string, versionId: string): VersionBody | undefined => held.bodies.get(`${summaryId}/${versionId}`);
export const useBody = (summaryId: string | null, versionId: string | null): VersionBody | undefined =>
  useSyncExternalStore(subscribe, () => (summaryId && versionId ? held.bodies.get(`${summaryId}/${versionId}`) : undefined), () => undefined);
