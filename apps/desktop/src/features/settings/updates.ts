// The Updates pane's derived values (#1130, #1131): the release notes address and the model bundle line.
/** The running version's release notes on GitHub; a development build ("dev") has none, so the releases list. */
export const releaseNotesUrl = (version: string) => (/^\d+\.\d+/.test(version) ? `https://github.com/getahead/noter/releases/tag/v${version}` : "https://github.com/getahead/noter/releases");

/** Model bundle (DESIGN 3.2 Updates "model bundle status"): the selected bundles' state in one line. */
export function modelsLine(bundles: { state: string; selected?: boolean }[]): "settings.updates.models_current" | "settings.updates.models_updating" | "settings.updates.models_failed" {
  const chosen = bundles.filter((b) => b.selected !== false);
  if (chosen.some((b) => b.state === "failed" || b.state === "checksum_failed")) return "settings.updates.models_failed";
  return chosen.every((b) => b.state === "ready") ? "settings.updates.models_current" : "settings.updates.models_updating";
}
