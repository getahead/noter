import type { BundleState, DownloadAction, ModelBundle } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";

const STATUS: Record<BundleState, MsgKey> = {
  ready: "settings.models.ready",
  downloading: "settings.models.downloading",
  pending: "settings.models.pending",
  paused: "settings.models.paused",
  verifying: "settings.models.verifying",
  failed: "settings.models.failed",
  checksum_failed: "settings.models.checksum_failed",
};

export const statusKey = (s: BundleState): MsgKey => STATUS[s];

/** The one action a bundle offers in its row: what `models_download` is asked for and its button; null when nothing applies. */
export function modelAction(b: Pick<ModelBundle, "state">): { action: DownloadAction; label: MsgKey } | null {
  switch (b.state) {
    case "pending":
      return { action: "start", label: "settings.models.download" };
    case "paused":
      return { action: "resume", label: "settings.models.resume" };
    case "failed":
    case "checksum_failed":
      return { action: "retry", label: "settings.models.retry" };
    default:
      return null;
  }
}

/** The control key of a bundle's button. */
export const modelKey = (name: string) => `models:${name}`;
