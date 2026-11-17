// Where focus goes when the control that opened a People surface is gone (the shared focus code decides the rest).
import { focusIfLost } from "../../app/a11y/focus";

type Doc = Parameters<typeof focusIfLost>[0];

/** The named row is gone once the list is read again: the next Name…, else the Add Person button. */
export const afterNaming = (doc: Doc) => focusIfLost(doc, ["pe-name-first", "pl-add"]);

/** Create or Delete Profile swaps the button that opened the sheet or alert: its successor, once the page is read again. */
export const afterVoiceChange = (doc: Doc, was: boolean | undefined, now: boolean | undefined) =>
  was !== undefined && now !== undefined && was !== now && focusIfLost(doc, [now ? "pe-voice-delete" : "pe-voice-setup"]);
