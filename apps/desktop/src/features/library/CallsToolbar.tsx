import { useSyncExternalStore } from "react";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { exportStore } from "./export-store";
import { useHead } from "./topics-head";

/** The Calls toolbar (LC-R1): the shell's toolbar plus Export…, disabled with its help tag until calls are selected. */
export function CallsToolbar({ route, base }: PageToolbarProps) {
  const ids = useSyncExternalStore(exportStore.subscribe, exportStore.get, exportStore.get);
  const head = useHead();
  // LS-R1: Search results with its count; the query stays in the shell's search field
  if (route.key.startsWith("search:")) return <MainToolbar {...base} region="LS-R1" title={t("search.title")} subtitle={head.subtitle ?? undefined} />;
  if (route.key !== "root") return <MainToolbar {...base} />;
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-return-filter
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
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-return-filter
}
