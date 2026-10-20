import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { Icon } from "../../ui/icons";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { Toggle } from "../../ui/primitives/toggle";
import { saveSection, unignoreKey } from "./actions";
import { Group, Row } from "./form";
import { choices, type PaneProps } from "./pane-props";

const LANGUAGES = choices({ en: "settings.general.lang_en", ru: "settings.general.lang_ru", de: "settings.general.lang_de", language_of_the_call: "settings.general.lang_call" });
const RANKING = choices({ owed_to_todays_people: "settings.general.ranking_owed", due_then_owed_to_you: "settings.general.ranking_due" });
const HORIZON = choices({ today: "settings.general.horizon_today", this_week: "settings.general.horizon_week" });

const Warn = ({ children }: { children: string }) => (
  <span className="st-warnline">
    <Icon name="warning" size={12} /> {children}
  </span>
);

// @cpt-dod:cpt-noter-dod-ui-settings-window:p1
export function GeneralPane({ bridge, settings }: PaneProps) {
  const { general, today } = settings;
  const selfTestPassed = useWindow(bridge, (s) => s.whole.setup?.self_test.type === "passed");
  const general_ = (edits: Partial<typeof general>) => void saveSection(bridge, "general", edits);
  return (
    <>
      <Group>
        <Row label={t("settings.general.launch")}>
          <Toggle on={general.launch_at_login} size="small" ariaLabel={t("settings.general.launch")} onAction={(launch_at_login) => general_({ launch_at_login })} />
        </Row>
        <Row label={t("settings.general.offer")} note={selfTestPassed ? t("settings.general.offer_note") : <Warn>{t("settings.general.needs_self_test")}</Warn>}>
          <Toggle on={selfTestPassed && general.offer_to_record} size="small" disabled={!selfTestPassed} ariaLabel={t("settings.general.offer")} onAction={(offer_to_record) => general_({ offer_to_record })} />
        </Row>
        {!general.notifications_enabled && (
          <Row label={t("settings.general.notifications")} note={t("settings.general.notifications_note")}>
            <Warn>{t("settings.general.notifications_off")}</Warn>
            {/* @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-open */}
            <PushButton label={t("settings.general.open_system_settings")} size="small" onAction={() => void bridge.act("open:notifications", "open_external", () => bridge.core.openExternal({ target: { type: "system_settings", permission: "notifications" } }))} />
            {/* @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-open */}
          </Row>
        )}
      </Group>
      <Group title={t("settings.general.apps")}>
        {general.ignored_apps.length === 0 ? (
          <div className="st-empty">
            <EmptyState variant="section" title={t("settings.general.apps_empty")} />
          </div>
        ) : (
          general.ignored_apps.map((app) => (
            <div key={app.bundle_id} className="st-applist">
              <span className="st-app">
                <Icon name="globe" size={15} /> {app.app_name}
              </span>
              <span className="np-dim">{t("settings.general.apps_note")}</span>
              <span className="np-tb__spacer" />
              {/* @cpt-begin:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-unignore */}
              <PushButton label={t("settings.general.remove")} size="small" onAction={() => void bridge.act(unignoreKey(app.bundle_id), "settings_unignore_app", () => bridge.core.settingsUnignoreApp({ bundle_id: app.bundle_id }), { slice: "settings" })} />
              {/* @cpt-end:cpt-noter-flow-ui-settings-change-setting:p1:inst-case-unignore */}
            </div>
          ))
        )}
      </Group>
      <Group title={t("settings.general.outputs")}>
        <Row label={t("settings.general.summary_language")} note={t("settings.general.summary_language_note")}>
          <PopupButton options={LANGUAGES} value={general.summary_language} label={t("settings.general.summary_language")} onAction={(v) => general_({ summary_language: v as typeof general.summary_language })} />
        </Row>
        <Row label={t("settings.general.storage")} note={general.storage_in_cloud_folder && <Warn>{t("settings.general.storage_cloud")}</Warn>}>
          <span className="st-path np-mono" title={general.storage_path}>
            {general.storage_path}
          </span>
        </Row>
      </Group>
      <Group title={t("settings.general.today")}>
        <Row label={t("settings.general.horizon")}>
          <SegmentedControl variant="option" label={t("settings.general.horizon")} items={HORIZON} value={today.horizon} onAction={(v) => void saveSection(bridge, "today", { horizon: v as typeof today.horizon })} />
        </Row>
        <Row label={t("settings.general.ranking")} note={t("settings.general.ranking_note")}>
          <PopupButton options={RANKING} value={today.ranking} label={t("settings.general.ranking")} onAction={(v) => void saveSection(bridge, "today", { ranking: v as typeof today.ranking })} />
        </Row>
      </Group>
    </>
  );
}
