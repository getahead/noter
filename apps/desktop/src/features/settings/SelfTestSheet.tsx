import { useEffect, useState, useSyncExternalStore } from "react";

import { useAnnounce } from "../../app/a11y/announce";
import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { SelfTestPanel } from "../../ui/setup/self-test-panel";
import { createWizard, speechPercent } from "../first-run/wizard";

// one array: a getSnapshot that returns a fresh [] each call loops forever
const NO_BUNDLES: never[] = [];

/** **Run Audio Self-Test…**: the first-run self-test panel in a sheet, run by the first-run controller. */
export function SelfTestSheet({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  const announce = useAnnounce(bridge);
  const [wizard] = useState(() => createWizard(bridge, (text, key) => void announce({ kind: "self_test", text, key })));
  // Settings only runs the test: no model downloads and no microphone level stream
  useEffect(() => wizard.start({ downloads: false, levels: false }), [wizard]);
  const w = useSyncExternalStore(wizard.store.subscribe, wizard.store.getState, wizard.store.getState);
  const models = useSyncExternalStore(bridge.store.subscribe, () => bridge.store.getState().whole.setup?.models.bundles ?? NO_BUNDLES, () => NO_BUNDLES);
  return (
    <Sheet title={t("settings.selftest.title")} width={560} busy={w.panel.state === "RUNNING"} onCancel={onClose} onDefault={onClose}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("settings.selftest.title")}</div>
        <div className="np-sheet__sub">{t("settings.selftest.sub")}</div>
      </div>
      <div className="np-sheet__body">
        <SelfTestPanel
          panel={w.panel}
          variant="sheet"
          waitingPercent={speechPercent(models)}
          playClip={w.clip}
          onPlayClip={() => void wizard.runTest(true)}
          onRun={() => void wizard.runTest(false)}
          onOpenSettings={() => void wizard.openSettings("system_audio")}
        />
      </div>
      <SheetFooter defaultButton={<PushButton label={t("settings.share.done")} variant="primary" onAction={onClose} />} />
    </Sheet>
  );
}
