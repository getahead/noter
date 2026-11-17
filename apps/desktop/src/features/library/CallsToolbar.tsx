import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";

/** The Calls toolbar (LC-R1): the shell's toolbar plus Export…, disabled with its help tag (the Export slice enables it for a selection). */
export function CallsToolbar({ route, base }: PageToolbarProps) {
  if (route.key !== "root") return <MainToolbar {...base} />;
  return (
    <MainToolbar
      {...base}
      trailing={
        <>
          {base.trailing}
          <PushButton label={t("library.export")} size="small" disabled help={t("library.export_hint")} shortcut="Meta+E" />
        </>
      }
    />
  );
}
