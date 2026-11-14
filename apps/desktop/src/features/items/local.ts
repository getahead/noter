// What a row keeps while the user works on it and the core has nothing to say about: the edit draft and phase,
// the outcome being shown (**Accepted**, **Rejected · Undo**), the open handoff question and the last error.
// A module store like the undo strip's, so the commands in `actions.ts` drive it and the rows only read it.
import { createLocal } from "../../app/create-local";

import type { ItemView, UndoTarget } from "../../core/bindings";
import type { Draft } from "./review";

export interface Outcome {
  text: string;
  /** What **Undo** reverses (the change the command returned); none for a plain confirmation. */
  target: UndoTarget | null;
  /** How long it shows. */
  ms: number;
}

export interface Local {
  phase?: "editing" | "saving";
  draft?: Draft;
  /** The item when editing began; streamed revisions must not silently replace the draft's base. */
  draftBase?: ItemView;
  outcome?: Outcome;
  /** The completion change stays available in Done today after inline feedback expires. */
  doneTarget?: UndoTarget;
  /** **Did the handoff land?** is open. */
  asking?: boolean;
  error?: string;
  /** The edit was saved but its acceptance failed: only the acceptance is retried. */
  retryAccept?: boolean;
}

const { patchLocal, localOf, useLocal, useLocals, resetLocal } = createLocal<Local>();
export { patchLocal, localOf, useLocal, useLocals, resetLocal };
