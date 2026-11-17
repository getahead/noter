// Where focus goes when the control that opened a People surface is gone (the shared focus code decides the rest).
import { focusIfLost } from "../../app/a11y/focus";

type Doc = Parameters<typeof focusIfLost>[0];

/** The named row is gone once the list is read again: the next Name…, else the Add Person button. */
export const afterNaming = (doc: Doc) => focusIfLost(doc, ["pe-name-first", "pl-add"]);

/** The read after a naming: wait while it runs, focus once it is read, and forget the naming when it failed. Still pending? */
export const settleNaming = (doc: Doc, pending: boolean, status: "LOADING" | "READ" | "ERROR") => {
  if (!pending || status === "LOADING") return pending;
  if (status === "READ") afterNaming(doc);
  return false;
};

/** The Delete Profile… alert closed (Cancel, or a delete that failed): the button that opened it is still there. */
export const afterVoiceAlert = (doc: Doc) => focusIfLost(doc, ["pe-voice-delete"]);

/** Create or Delete Profile swaps the button that opened the sheet or alert: its successor, once the page is read again. */
export const afterVoiceChange = (doc: Doc, was: boolean | undefined, now: boolean | undefined) =>
  was !== undefined && now !== undefined && was !== now && focusIfLost(doc, [now ? "pe-voice-delete" : "pe-voice-setup"]);
