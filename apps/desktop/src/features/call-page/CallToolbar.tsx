// PC-R1: the call page's toolbar. The shell's toolbar (Back, title and subtitle, search) with the view control in
// the centre and Share, ⋯ More and the inspector toggle after it.
import { useEffect, useState } from "react";

import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { TextField } from "../../ui/primitives/text-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallRow, CallTypeInfo } from "../../core/bindings";
import { menuActs, saveTitle } from "./actions";
import { useTypes } from "./cache";
import { callViews, parseCallKey, subtitleOf, VIEW_LABEL } from "./logic";
import type { CallPageTab } from "../../core/bindings";

/** The views a delivered feature registered: Transcript in M1; Summary, Agent Reviews and History join in M2 and M4. */
export const REGISTERED_VIEWS: readonly CallPageTab[] = ["transcript"];

/** The ⋯ menu's items for a call (the later items join with their features). */
export function moreItems(call: CallRow, types: CallTypeInfo[], act: { rename: () => void; type: (id: string) => void; sensitive: () => void; finder: () => void; remove: (() => void) | null }): MenuItem[] {
  const sensitive = call.privacy === "sensitive";
  return [
    { label: t("callpage.rename"), onSelect: act.rename },
    { label: t("callpage.call_type"), children: types.map((x) => ({ label: x.label, checked: x.id === call.call_type, onSelect: () => act.type(x.id) })) },
    { label: sensitive ? t("callpage.sensitive") : t("callpage.mark_sensitive"), checked: sensitive, onSelect: act.sensitive },
    { divider: true },
    { label: t("callpage.show_in_finder"), onSelect: act.finder },
    { divider: true },
    { label: t("callpage.delete"), destructive: true, kbd: "⌘⌫", disabled: act.remove === null, onSelect: act.remove ?? undefined },
  ];
}

export function CallToolbar({ route, bridge, base, inspectorOpen, onToggleInspector }: PageToolbarProps) {
  const at = parseCallKey(route.key)!;
  const call = useWindow(bridge, (s) => s.entities.call[at.callId]);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const types = useTypes();
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { segments, view } = callViews(REGISTERED_VIEWS, at.tab);
  const title = call ? call.title : "";
  const sub = call && prefs ? subtitleOf(call, Date.now(), prefs) : undefined;
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-toolbar
  return (
    <MainToolbar
      {...base}
      region="PC-R1"
      title={title}
      subtitle={sub}
      titleNode={call && renaming ? <TitleField bridge={bridge} call={call} onDone={() => setRenaming(false)} /> : undefined}
      center={<SegmentedControl items={segments.map((v) => ({ value: v, label: t(VIEW_LABEL[v]) }))} value={view} variant="view" label={t("callpage.view")} />}
      trailing={
        <>
          <PushButton label={t("callpage.share")} variant="secondary" disabled />
          <PullDownButton id="pc-more" iconOnly icon="ellipsis" label={t("callpage.more")} ariaLabel={t("callpage.more")} variant="item-menu" size="toolbar" open={menu !== null} onAction={() => setMenu(menu ? null : globalThis.document?.getElementById("pc-more") ?? null)} />
          {menu && call && (
            <Popover variant="item-menu" anchor={menu} align="end" label={t("callpage.more")} onClose={() => setMenu(null)}>
              <Menu
                items={moreItems(call, types, menuActs(bridge, call, () => setRenaming(true)))}
                onClose={() => setMenu(null)}
              />
            </Popover>
          )}
          <IconButton
            icon="sidebar"
            label={inspectorOpen ? t("callpage.hide_inspector") : t("callpage.show_inspector")}
            help={inspectorOpen ? t("callpage.hide_inspector_help") : t("callpage.show_inspector_help")}
            pressed={inspectorOpen}
            onAction={onToggleInspector}
          />
        </>
      }
    />
  );
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-toolbar
}

/** Rename in place: Return saves with `call_update` (title and `rev`), Esc or leaving the field cancels. */
function TitleField({ bridge, call, onDone }: { bridge: Bridge; call: CallRow; onDone: () => void }) {
  const [value, setValue] = useState(call.title);
  useEffect(() => globalThis.document?.getElementById("pc-title-edit")?.focus(), []);
  const save = () => (onDone(), void saveTitle(bridge, call, value));
  return (
    <span onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onDone())}>
      <TextField value={value} ariaLabel={t("callpage.rename_field")} onChange={setValue} onEnter={save} id="pc-title-edit" />
    </span>
  );
}
