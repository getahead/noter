// The Handoff drawer (HD-R1 to HD-R7) in the inspector slot: an editable prompt for Claude Code or Codex, the target,
// the repository, what the launch will do, and Copy Prompt / Open. The core generates, stores, copies and launches;
// nothing is sent until Return in the tool (DESIGN › Handoff drawer).
import { useEffect, useRef } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { HandoffTarget, HandoffView, ItemView, LaunchPath, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { Badge } from "../../ui/primitives/badge";
import { Progress } from "../../ui/primitives/progress";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { clock, shortDay } from "../call-page/logic";
import { useOutputs } from "../call-page/outputs-cache";
import { closeInspector } from "../shell/inspector-override";
import { cancel, copy, generate, load, open, setTarget, viewOf } from "./actions";
import { copyEnabled, drawerState, footer, launchLine, noMapping, openDisabledReason, openLabel, promptOf, schemeHelp, toolLabel, type DrawerState } from "./controls";
import { patchLocal, useLocal, type Local } from "./local";
import { PromptEditor } from "./PromptEditor";
import "./handoff.css";

const elementId = (kind: string, id: string) => [kind, id].join("-");
const TARGETS: HandoffTarget[] = ["claude_code", "codex"];
const TERMINAL_APP: Partial<Record<LaunchPath, string>> = { iterm: "iTerm", terminal: "Terminal" };

/** **Handed off to Claude Code · Nov 6 10:58 · cwd**, or **Opened in iTerm · item marked Handed off** right after a terminal launch. */
export function recordLine(item: ItemView, view: HandoffView, local: Local, prefs: UiPrefs | undefined): string | null {
  const app = local.opened && TERMINAL_APP[local.opened];
  if (app) return t("handoff.record.terminal", { app });
  const h = item.handoff ?? view.last;
  if (!h || !prefs) return null;
  return t("handoff.record", { tool: toolLabel(h.target), when: `${shortDay(h.at, prefs)} ${clock(h.at, prefs)}`, cwd: h.cwd });
}

// @cpt-component:cpt-noter-component-ui-handoff-drawer:p1
// @cpt-dod:cpt-noter-dod-ui-handoff-drawer:p3
export function HandoffDrawer({ bridge, itemId }: { bridge: Bridge; itemId: string }) {
  const stored = useWindow(bridge, (s) => s.entities.handoff[itemId]);
  const local = useLocal(itemId);
  const view = local.restored ?? stored;
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const item = useWindow(bridge, (s) => s.entities.item[itemId]) ?? view?.item;
  const callId = view?.item.call.id ?? item?.call.id;
  const sensitive = useWindow(bridge, (s) => !!callId && s.entities.call[callId]?.privacy === "sensitive");
  const localModel = !!useOutputs(callId ?? "")?.written_locally;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => void load(bridge, itemId), [bridge, itemId]);
  // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-open
  const loaded = !!view;
  useEffect(() => void (loaded && root.current?.querySelector<HTMLElement>('[data-region="HD-R2"] [tabindex="0"]')?.focus()), [loaded]);
  // @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-open

  const state = drawerState(view, local);
  const { primary, order } = view ? footer(view) : { primary: "open" as const, order: ["copy", "open"] as const };
  const run = (which: "copy" | "open") => void (which === "copy" ? copy(bridge, itemId) : open(bridge, itemId));
  const reason = openDisabledReason(view, local);

  // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-return
  // ⌘Return runs the default button and Esc closes, both unless an input method is composing; a popover has taken its own Esc
  const onKeyDown = (e: { key: string; metaKey: boolean; defaultPrevented: boolean; nativeEvent?: { isComposing: boolean }; isComposing?: boolean; preventDefault(): void; stopPropagation(): void }) => {
    if ((e.nativeEvent ?? e).isComposing || e.defaultPrevented) return;
    if (e.key === "Escape") return e.preventDefault(), e.stopPropagation(), closeInspector();
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-invoke
    if (e.key === "Enter" && e.metaKey && view && (primary === "copy" ? copyEnabled(view, local) : !reason)) return e.preventDefault(), run(primary);
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-invoke
  };
  // the keys work from the whole window (DESIGN): while focus is still on the row's Handoff button or the page, not in a field
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const onDoc = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (root.current?.contains(target) || target?.closest?.("input, textarea, select, [contenteditable], [role=menu], [role=dialog]")) return;
      keyRef.current(e);
    };
    document.addEventListener("keydown", onDoc);
    return () => document.removeEventListener("keydown", onDoc);
  }, []);
  // @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-return

  const generating = state === "GENERATING" || state === "NOT_GENERATED" || state === "LOADING";
  const variant = sensitive ? "sensitive-call" : view?.item.review === "suggested" ? "suggested-item" : view?.default_action === "copy_prompt" ? "someone-elses-item" : view?.target === "codex" ? "codex" : "claude-code";
  const launchId = elementId("hl", itemId);
  const record = view && recordLine(item ?? view.item, view, local, prefs);
  const tool = view ? toolLabel(view.target) : "";

  let prompt;
  if (state === "LOAD_FAILED")
    prompt = (
      <div className="hd-fail" role="alert">
        <Icon name="error" size={12} />
        {t(local.loadFailed === "not_found" ? "handoff.gone" : "handoff.load_failed")}
        {local.loadFailed !== "not_found" && <PushButton label={t("handoff.try_again")} size="small" variant="quiet" onAction={() => void load(bridge, itemId)} />}
      </div>
    );
  else if (state === "GENERATION_FAILED")
    prompt = (
      <div className="hd-fail" role="alert">
        <Icon name="error" size={12} />
        {t("handoff.gen_failed")}
        <PushButton label={t("handoff.try_again")} size="small" variant="quiet" onAction={() => void generate(bridge, itemId, view?.prompt_md != null)} />
      </div>
    );
  else
    prompt = (
      <>
        {generating && (
          <div className="hd-gen" role="status">
            <Progress variant="spinner" label={t("handoff.writing")} />
            <span>{t("handoff.writing")}</span>
            {state !== "LOADING" && <PushButton label={t("handoff.cancel")} size="small" variant="quiet" onAction={() => void cancel(bridge, itemId)} />}
          </div>
        )}
        <PromptEditor
          itemId={itemId}
          value={promptOf(view, local)}
          edited={state === "EDITED" || (!!view?.edited && local.draft === undefined)}
          generating={generating}
          generated={view?.generated_md ?? null}
          versions={view?.versions ?? []}
          prefs={prefs!}
          showDiff={!!local.showDiff}
          onDiff={() => patchLocal(itemId, { showDiff: !local.showDiff })}
          onChange={(draft) => patchLocal(itemId, { draft, draftRev: local.draftRev ?? view?.rev ?? 0, error: undefined, openFailed: undefined, opened: undefined })}
        />
      </>
    );

  return (
    <div ref={root} className="hd" data-component="cpt-noter-component-ui-handoff-drawer" data-region="HD" data-variant={variant} data-state={state.toLowerCase().replace(/_/g, "-")} onKeyDown={onKeyDown}>
      <header className="hd__head" data-region="HD-R1">
        <div className="hd__titles">
          <span className="t-headline">{t("handoff.title")}</span>
          <span className="hd__item" title={item?.text}>
            {item?.text}
          </span>
        </div>
        {(state === "EDITED" || view?.edited) && <Badge kind="status" text={t("handoff.edited")} />}
        {localModel && <Badge kind="kind" text={t("handoff.local_model")} />}
        <PushButton label={t("handoff.regenerate")} size="small" variant="quiet" disabled={!view || state === "GENERATING"} onAction={() => void generate(bridge, itemId, true)} />
      </header>
      <div className="hd__body">
        {view && (
          <>
            <div className="hd__row" data-region="HD-R2">
              <span className="hd__lab">{t("handoff.target")}</span>
              <SegmentedControl variant="option" label={t("handoff.target")} items={TARGETS.map((value) => ({ value, label: toolLabel(value) }))} value={view.target} onAction={(v) => void setTarget(bridge, itemId, v as HandoffTarget)} />
            </div>
            <div className="hd__row" data-region="HD-R3">
              <span className="hd__lab">{t("handoff.repository")}</span>
              {view.repo ? (
                <PopupButton label={t("handoff.repository")} options={[{ value: view.repo.id, label: `${view.repo.local_path} (${view.repo.key})` }]} value={view.repo.id} />
              ) : (
                <span className="hd__warn">
                  <Icon name="warning" size={12} />
                  {noMapping(view)}
                </span>
              )}
            </div>
          </>
        )}
        <div data-region="HD-R4">{prompt}</div>
        {view && state !== "GENERATING" && (
          <p className="hd__launch" id={launchId} data-region="HD-R5" title={schemeHelp(view.launch.path)}>
            <Icon name="terminal" size={12} />
            {launchLine(view)}
          </p>
        )}
        {sensitive && (
          <p className="hd__warn">
            <Icon name="warning" size={12} />
            {t("handoff.sensitive")}
          </p>
        )}
        {record && (
          <p className="hd__rec" data-region="HD-R6" role="status">
            <Icon name="checkCircle" size={12} />
            {record}
          </p>
        )}
        {local.error && (
          <p className="hd__err" role="alert">
            <Icon name="error" size={12} />
            {local.error}
          </p>
        )}
        {view?.item.review === "suggested" && <p className="hd__accept">{t("handoff.accepts")}</p>}
      </div>
      <footer className="hd__foot" data-region="HD-R7">
        {state === "OPEN_FAILED" && (
          <p className="hd__err" role="alert">
            <Icon name="error" size={12} />
            {t("handoff.open_failed", { tool })}
          </p>
        )}
        {order.map((which) =>
          which === "copy" ? (
            <PushButton key="copy" label={t("handoff.copy")} icon="copy" variant={primary === "copy" ? "primary" : "secondary"} kbd={primary === "copy" ? "⌘↩" : undefined} disabled={!copyEnabled(view, local)} loading={local.pending === "copy"} {...(local.copied ? { flash: t("handoff.copied") } : {})} onAction={() => run("copy")} />
          ) : (
            <PushButton key="open" label={view ? openLabel(view.target) : t("handoff.open", { tool: "Claude Code" })} variant={primary === "open" ? "primary" : "secondary"} kbd={primary === "open" ? "⌘↩" : undefined} disabled={!!reason} loading={local.pending === "open"} help={reason ?? (view ? schemeHelp(view.launch.path) : undefined)} attrs={{ "aria-describedby": launchId }} onAction={() => run("open")} />
          ),
        )}
      </footer>
    </div>
  );
}
