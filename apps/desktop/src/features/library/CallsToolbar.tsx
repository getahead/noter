import { useSyncExternalStore } from "react";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { exportStore } from "./export-store";

/** The Calls toolbar (LC-R1): the shell's toolbar plus Export…, disabled with its help tag until calls are selected. */
export function CallsToolbar({ route, base }: PageToolbarProps) {
  const ids = useSyncExternalStore(exportStore.subscribe, exportStore.get, exportStore.get);
  if (route.key !== "root") return <MainToolbar {...base} />;
  return (
    <MainToolbar
      {...base}
      trailing={
        <>
          {base.trailing}
          <PushButton label={t("library.export")} size="small" disabled={!ids.length} help={ids.length ? undefined : t("library.export_hint")} shortcut="Meta+E" onAction={exportStore.run} />
        </>
      }
    />
  );
}
