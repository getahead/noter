// What the drawer keeps while the user works and the core has nothing to say about: the prompt draft, Diff on or off,
// the action running, the outcome of the last copy or open and a view restored by Cancel. A module store like the
// items' `local.ts`, so `actions.ts` drives it and the drawer only reads it.
import { createLocal } from "../../app/create-local";

import type { ErrorCode, HandoffView, LaunchPath } from "../../core/bindings";

export interface Local {
  /** The prompt as the user typed it, not yet saved with `handoff_edit`. */
  draft?: string;
  draftRev?: number;
  showDiff?: boolean;
  pending?: "save" | "copy" | "open" | "target";
  /** `handoff_get` failed with this code. */
  loadFailed?: ErrorCode;
  /** `handoff_generate` itself was refused. */
  genFailed?: ErrorCode;
  /** The last open succeeded through this path (this drawer session). */
  opened?: LaunchPath;
  /** The last open failed with this code. */
  openFailed?: ErrorCode;
  /** **Copied** shows on the button. */
  copied?: boolean;
  error?: string;
  /** What Cancel returned: a completion event that arrives later is not shown over it. */
  restored?: HandoffView;
}

const { patchLocal, localOf, useLocal, resetLocal } = createLocal<Local>();
export { patchLocal, localOf, useLocal, resetLocal };
