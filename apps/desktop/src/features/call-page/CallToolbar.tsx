// PC-R1: the call page's toolbar. The shell's toolbar (Back, title and subtitle, search) with the view control in
// the centre and Share, ⋯ More and the inspector toggle after it.
import { useEffect, useState } from "react";

import { useWindow } from "../../app/use-window";
import { updateNativeMenuContext } from "../../core/native-menu";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { TextField } from "../../ui/primitives/text-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallRow, CallTypeInfo, CallPageTab } from "../../core/bindings";
import { menuActs, saveTitle } from "./actions";
import { review, reviewAll } from "../items/actions";
import { focusNext } from "../items/ActionItemRow";
import { useExtras } from "./cache";
import { useExport } from "./ExportSheet";
import { deleteAudio, revealExport } from "./share-actions";
import { ShareMenu } from "./ShareMenu";
import { exportOpener } from "./share-run";
import { useOutputs } from "./outputs-cache";
import { shareState } from "./share-logic";
import { useTypes } from "./cache";
import { useRegenerate } from "./RegenerateSheet";
import { registeredViews } from "./views";
import { audioKept as keepsAudio, callViews, parseCallKey, subtitleOf, VIEW_LABEL } from "./logic";

export function nativeItemReviewMenuState(focused: boolean, hasActionableSelection: boolean, pendingSuggestions: number) {
  return {
    acceptItemEnabled: focused && hasActionableSelection,
    rejectItemEnabled: focused && hasActionableSelection,
    acceptAllSuggestionsEnabled: focused && pendingSuggestions > 0,
  };
}

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
export function watchNativeMenuContext(call: CallRow | undefined, outputs: ReturnType<typeof useOutputs>, bridge?: Bridge): () => void {
  const copyReady = outputs !== undefined && shareState(outputs, call?.privacy).ready;
  let focused = true;
  const reviewState = (hasFocus: boolean) => {
    const rows = typeof document.querySelectorAll === "function" ? Array.from(document.querySelectorAll<HTMLElement>("[data-item-id]")).filter((row) => row.dataset.callId === call?.id) : [];
    const active = document.activeElement?.closest<HTMLElement>("[data-item-id]");
    const item = active?.dataset.itemId ? bridge?.store.getState().entities.item[active.dataset.itemId] : undefined;
    const activeIsSuggestion = !!active && rows.includes(active) && active.dataset.review === "suggested" && item?.call.id === call?.id && item?.review === "suggested" && !["editing", "saving"].includes(active.dataset.state ?? "");
    const knownItems = Object.values(bridge?.store.getState().entities.item ?? {}).filter((entry) => entry.call.id === call?.id);
    const pendingSuggestions = knownItems.length ? knownItems.filter((entry) => entry.review === "suggested").length : outputs?.review_waiting ?? 0;
    return nativeItemReviewMenuState(hasFocus, activeIsSuggestion, pendingSuggestions);
  };
  const update = (hasFocus = focused) => void updateNativeMenuContext({
    focused: hasFocus,
    exportEnabled: !!call,
    copySlackEnabled: copyReady,
    copyJiraEnabled: copyReady,
    copyMarkdownEnabled: copyReady,
    deleteEnabled: !!call,
    ...reviewState(hasFocus),
  });
  const onFocus = () => (focused = true, update());
  const onBlur = () => (focused = false, update());
  const onFocusIn = () => update();
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => update());
  // Mounting the focused main-window page is the initial active state; native window blur events
  // take it back to false. document.hasFocus() can still be false during the first WebKit frame.
  update(true);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener?.("focusin", onFocusIn);
  if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-review", "data-state", "data-variant"] });
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener?.("focusin", onFocusIn);
    observer?.disconnect();
    void updateNativeMenuContext({ focused: false, exportEnabled: false, copySlackEnabled: false, copyJiraEnabled: false, copyMarkdownEnabled: false, deleteEnabled: false, acceptItemEnabled: false, rejectItemEnabled: false, acceptAllSuggestionsEnabled: false });
  };
}

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** Route DESIGN's contextual native review commands through the same M2 review handlers as row controls. */
export function runNativeReviewMenuAction(key: string, bridge: Bridge, callId: string, pendingSuggestions: number): boolean {
  const row = document.activeElement?.closest<HTMLElement>("[data-item-id]");
  if (key === "menu.accept_all_suggestions") {
    if (pendingSuggestions <= 0) return false;
    void reviewAll(bridge, callId, []);
    return true;
  }
  if ((key !== "menu.accept_item" && key !== "menu.reject_item") || !row || row.dataset.callId !== callId || row.dataset.review !== "suggested" || ["editing", "saving"].includes(row.dataset.state ?? "")) return false;
  const item = bridge.store.getState().entities.item[row.dataset.itemId!];
  if (!item || item.review !== "suggested") return false;
  void review(bridge, item, key === "menu.accept_item" ? "accept" : "reject").then((result) => result.status === "ok" && focusNext(item.id));
  return true;
}

/** The ⋯ menu's items for a call (the later items join with their features). */
export function moreItems(call: CallRow, types: CallTypeInfo[], act: { rename: () => void; deleteAudio?: (() => void) | null; type: (id: string) => void; sensitive: () => void; finder: () => void; remove: (() => void) | null; regenerate?: () => void }): MenuItem[] {
  const sensitive = call.privacy === "sensitive";
  return [
    // @cpt-begin:cpt-noter-flow-ui-library-calls-edit:p2:inst-user-edit
    { label: t("callpage.rename"), onSelect: act.rename },
    { label: t("callpage.call_type"), children: types.map((x) => ({ label: x.label, checked: x.id === call.call_type, onSelect: () => act.type(x.id) })) },
    // @cpt-end:cpt-noter-flow-ui-library-calls-edit:p2:inst-user-edit
    { label: sensitive ? t("callpage.sensitive") : t("callpage.mark_sensitive"), checked: sensitive, onSelect: act.sensitive },
    { divider: true },
    ...(act.regenerate ? [{ label: t("outputs.menu.regenerate"), onSelect: act.regenerate }] : []),
    { label: t("callpage.show_in_finder"), onSelect: act.finder },
    ...(act.deleteAudio ? [{ label: t("audio.delete"), onSelect: act.deleteAudio }] : []),
    { divider: true },
    { label: t("callpage.delete"), destructive: true, kbd: "⌘⌫", disabled: act.remove === null, onSelect: act.remove ?? undefined },
  ];
}

export function CallToolbar({ route, bridge, base, inspectorOpen, onToggleInspector }: PageToolbarProps) {
  const at = parseCallKey(route.key)!;
  const call = useWindow(bridge, (s) => s.entities.call[at.callId]);
  const outputs = useOutputs(at.callId);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const types = useTypes();
  const openRegenerate = useRegenerate(bridge, at.callId);
  const extras = useExtras(at.callId);
  const [renaming, setRenaming] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const audioKept = !!call && keepsAudio(call, extras?.audio_not_stored ?? false);
  const openExport = useExport(bridge, at.callId, audioKept, setExported);
  // the status stays 8 s
  useEffect(() => {
    if (!exported) return;
    const id = setTimeout(() => setExported(null), 8000);
    return () => clearTimeout(id);
  }, [exported]);
  // ⌘E reaches the sheet through the page key
  useEffect(() => ((exportOpener.open = openExport), () => void (exportOpener.open = null)), [openExport]);
  useEffect(() => watchNativeMenuContext(call, outputs, bridge), [bridge, call, outputs]);
  useEffect(() => {
    const onMenuAction = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (call) {
        const currentItems = Object.values(bridge.store.getState().entities.item).filter((item) => item.call.id === call.id);
        const pending = currentItems.length ? currentItems.filter((item) => item.review === "suggested").length : outputs?.review_waiting ?? 0;
        runNativeReviewMenuAction(key, bridge, call.id, pending);
      }
    };
    window.addEventListener("shell:native-item-review", onMenuAction);
    return () => window.removeEventListener("shell:native-item-review", onMenuAction);
  }, [bridge, call, outputs]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { segments, view } = callViews(registeredViews(), at.tab);
  const views = segments.map((v) => ({ value: v, label: t(VIEW_LABEL[v]) }));
  const openTab = (tab: string) => void bridge.core.windowNavigate({ target: { type: "call_page", call_id: at.callId, tab: tab as CallPageTab } });
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
      center={
        // @cpt-begin:cpt-noter-algo-ui-call-page-frame-views:p1:inst-narrow
        base.narrow ? <PopupButton options={views} value={view} variant="toolbar" label={t("callpage.view")} onAction={openTab} /> : <SegmentedControl items={views} value={view} variant="view" label={t("callpage.view")} onAction={openTab} />
        // @cpt-end:cpt-noter-algo-ui-call-page-frame-views:p1:inst-narrow
      }
      trailing={
        <>
          <ShareMenu bridge={bridge} callId={at.callId} origin={{ type: "toolbar" }} id="pc-share" />
          {/* @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-return */}
          {exported && (
            <span role="status" className="pc-export-done">
              {t("export.done", { path: exported })} ·{" "}
              <button type="button" className="np-link" onClick={() => void revealExport(bridge, at.callId, exported)}>{t("export.show")}</button>
            </span>
          )}
          {/* @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-return */}
          <PullDownButton id="pc-more" iconOnly icon="ellipsis" label={t("callpage.more")} ariaLabel={t("callpage.more")} variant="item-menu" size="toolbar" open={menu !== null} onAction={() => setMenu(menu ? null : globalThis.document?.getElementById("pc-more") ?? null)} />
          {/* @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-user-more */}
          {menu && call && (
            <Popover variant="item-menu" anchor={menu} align="end" label={t("callpage.more")} onClose={() => setMenu(null)}>
              <Menu
                items={moreItems(call, types, { ...menuActs(bridge, call, () => setRenaming(true)), regenerate: () => openRegenerate(["summary", "decisions", "action_items", "open_questions"]), deleteAudio: audioKept ? () => void deleteAudio(bridge, at.callId) : null })}
                onClose={() => setMenu(null)}
              />
            </Popover>
          )}
          {/* @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-user-more */}
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
    <span onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onDone())} onBlur={onDone}>
      <TextField value={value} ariaLabel={t("callpage.rename_field")} onChange={setValue} onEnter={save} id="pc-title-edit" />
    </span>
  );
}
