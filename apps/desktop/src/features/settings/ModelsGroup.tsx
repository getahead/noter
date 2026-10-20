import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { Progress } from "../../ui/primitives/progress";
import { PushButton } from "../../ui/primitives/push-button";
import { Group } from "./form";
import { modelAction, modelKey, statusKey } from "./models";

/** **Models**: one row per bundle the core lists; a download or retry runs `models_download`. */
export function ModelsGroup({ bridge }: { bridge: Bridge }) {
  const bundles = useWindow(bridge, (s) => s.whole.setup?.models.bundles ?? []);
  return (
    <Group title={t("settings.models.title")}>
      {bundles.length === 0 && <EmptyState variant="section" title={t("settings.models.empty")} />}
      {bundles.map((b) => {
        const action = modelAction(b);
        return (
          <div key={b.name} className="e-status" data-state={b.state}>
            <div className="e-status__main">
              <span className="e-status__title">{b.name}</span>
              <span className="e-status__sub">
                {t("settings.models.size", { size: b.size_mb })} · {b.state === "downloading" ? t("settings.models.downloading", { done: Math.min(b.done_mb, b.size_mb), total: b.size_mb }) : t(statusKey(b.state))}
              </span>
              {b.state === "downloading" && <Progress value={Math.round((100 * b.done_mb) / Math.max(b.size_mb, 1))} label={b.name} />}
            </div>
            {action && (
              // @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-models
              <PushButton label={t(action.label)} size="small" onAction={() => void bridge.act(modelKey(b.name), "models_download", () => bridge.core.modelsDownload({ action: action.action }))} />
              // @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-models
            )}
          </div>
        );
      })}
    </Group>
  );
}
