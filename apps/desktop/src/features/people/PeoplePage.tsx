import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";

import { useBridge } from "../../app/bridge/context";
import { useWindow } from "../../app/use-window";
import type { PersonRow, UiPrefs } from "../../core/bindings";
import { shortDay, t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Table } from "../../ui/primitives/table";
import { NONE, press, retain, type Selection } from "../library/selection";
import { holdPeople } from "./count";
import { setAddPerson } from "./add-person";
import { view, type PeopleView } from "./identity";
import { confirmDelete, usePeopleSheets } from "./sheets";
import { createPeopleList, setPeopleQuery, usePeopleQuery, type PeopleState } from "./model";
import "./people.css";

const SLOW_MS = 300;
const COLS = [
  ["name", "people.col.name"],
  ["role", "people.col.role"],
  ["theirs", "people.col.theirs"],
  ["owe", "people.col.owe"],
  ["last", "people.col.last"],
  ["voice", "people.col.voice"],
] as const;
const WIDTH: Record<string, string> = { theirs: "130px", owe: "90px", last: "100px", voice: "110px" };

const roleOrg = (p: PersonRow) => (p.role && p.org ? t("people.role_org", { role: p.role, org: p.org }) : (p.role ?? p.org ?? ""));

/** People: the searchable list (PL-R2) and, when the core has any, the unnamed speakers (PL-R3). */
export function PeoplePage() {
  const bridge = useBridge();
  const list = useMemo(() => createPeopleList(bridge), [bridge]);
  const state = usePeopleListState(list);
  const query = usePeopleQuery();
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const known = useWindow(bridge, (s) => s.entities.person);
  const [selection, setSelection] = useState<Selection>(NONE);
  const [slow, setSlow] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const sheets = usePeopleSheets();
  const seen = useRef(known);
  useEffect(() => void list.load(), [list]);
  // the core changed a person (naming, merge, edit): read the list again, keeping it on screen meanwhile
  useEffect(() => {
    if (seen.current !== known) list.load();
    seen.current = known;
  }, [known, list]);
  useEffect(() => {
    if (state.status !== "LOADING") return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [state.status]);
  const shown = useMemo(() => (state.read ? view(state.read, query) : null), [state.read, query]);
  useEffect(() => {
    holdPeople(state.read ? state.read.people.filter((p) => !p.is_you) : null);
    return () => holdPeople(null);
  }, [state.read]);
  const order = useMemo(() => shown?.rows.map((r) => r.id) ?? [], [shown]);
  useEffect(() => setSelection((s) => retain(s, order)), [order]);

  const open = (id: string) =>
    void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "person", person_id: id } }), { screen: "people" });
  const rows = state.read?.people ?? [];
  const onContext = (id: string, e: MouseEvent) => {
    e.preventDefault();
    const next = press(selection, order, id, { context: true });
    setSelection(next);
    setMenu({ x: e.clientX, y: e.clientY, ids: next.ids });
  };
  return (
    <>
      {failed && <InlineBanner banner={{ id: "people-delete-failed", severity: "error", text: failed }} onDismiss={() => setFailed(null)} />}
      <PeopleBody status={state.status} shown={shown} query={query} prefs={prefs} selection={selection} slow={slow} onOpen={open} onSelect={(id, mods) => setSelection((s) => press(s, order, id, mods))} onRetry={() => void list.load()} onContext={onContext} />
      {menu && (
        <div className="pe-ctx" style={{ left: menu.x, top: menu.y }}>
          <Menu variant="context-menu" onClose={() => setMenu(null)} items={rowMenu(menu.ids.map((id) => rows.find((p) => p.id === id)!).filter(Boolean), { open, close: () => setMenu(null), edit: (p) => sheets.open("person-edit", { bridge, person: p }), merge: (a, b) => sheets.open("person-merge", { bridge, source: a, people: rows, target: b?.id }), del: (p) => void confirmDelete(bridge, p, setFailed) })} />
        </div>
      )}
    </>
  );
}

// @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge-open
/** The right-click menu of the selected rows: Merge 2 People… only with exactly two selected. */
export function rowMenu(chosen: PersonRow[], on: { open: (id: string) => void; close: () => void; edit: (p: PersonRow) => void; merge: (a: PersonRow, b?: PersonRow) => void; del: (p: PersonRow) => void }): MenuItem[] {
  const one = chosen.length === 1 ? chosen[0]! : null;
  const run = (f: () => void) => () => (on.close(), f());
  return [
    { label: t("person.open"), disabled: !one, onSelect: run(() => on.open(one!.id)) },
    { label: t("person.edit"), disabled: !one, onSelect: run(() => on.edit(one!)) },
    { divider: true },
    { label: t("person.merge_two"), disabled: chosen.length !== 2, onSelect: run(() => on.merge(chosen[0]!, chosen[1])) },
    { divider: true },
    { label: t("person.delete"), destructive: true, disabled: !one, onSelect: run(() => on.del(one!)) },
  ];
}
// @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge-open

export interface PeopleBodyProps {
  status: PeopleState["status"];
  shown: PeopleView | null;
  query: string;
  prefs: UiPrefs | undefined;
  selection: Selection;
  slow: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string, mods: { meta?: boolean; shift?: boolean }) => void;
  onRetry: () => void;
  onContext?: (id: string, e: MouseEvent) => void;
}

/** What the page draws for a state of the list: the table, its empty states, the skeleton or the error. */
export function PeopleBody({ status, shown, query, prefs, selection, slow, onOpen: open, onSelect, onRetry, onContext }: PeopleBodyProps) {
  const onRow = (id: string) => (e: MouseEvent) => onSelect(id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter") (e.preventDefault(), open(id));
    else if (e.key === " ") (e.preventDefault(), onSelect(id, {}));
  };
  const order = shown?.rows.map((r) => r.id) ?? [];
  if (status === "ERROR" && !shown)
    return <InlineBanner banner={{ id: "people-error", severity: "error", text: t("people.error"), actions: [{ label: t("action.try_again"), onAction: onRetry }] }} />;
  if (!shown)
    return (
      <div className="pe-loading" data-state="loading" aria-busy="true" aria-label={t("people.loading")}>
        {slow && (
          <div className="pe-skel" data-component="cpt-noter-component-ui-primitives" data-primitive="table">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="pe-skel__row"><span /><span /><span /></div>
            ))}
          </div>
        )}
      </div>
    );
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-error
  const reloadFailed = status === "ERROR" && (
    <InlineBanner banner={{ id: "people-error", severity: "error", text: t("people.error"), actions: [{ label: t("action.try_again"), onAction: onRetry }] }} />
  );
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-error
  const stop = order.find((id) => selection.ids.includes(id)) ?? order[0];
  return (
    <>
      <h2 className="np-sr" tabIndex={-1}>{t("people.title")}</h2>
      {reloadFailed}
      <div data-region="PL-R2" role="region" aria-label={t("people.title")} data-state={shown.status.toLowerCase()}>
        {shown.status === "EMPTY" ? (
          <EmptyState variant="first-use" icon="people" title={t("people.empty_title")} body={t("people.empty_body")} actionLabel={t("people.add")} onAction={() => setAddPerson(true)} />
        ) : shown.status === "NO_MATCH" ? (
          <EmptyState variant="filtered" title={t("people.no_match", { query: query.trim() })} actionLabel={t("people.clear")} onAction={() => setPeopleQuery("")} />
        ) : (
          <Table variant="sortable" label={t("people.title")} cls="pe-table">
            <thead>
              <tr>
                {COLS.map(([c, label]) => (
                  <th key={c} scope="col" aria-sort={c === "name" ? "ascending" : undefined} style={{ width: WIDTH[c] }}>
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((p) => {
                const on = selection.ids.includes(p.id);
                return (
                  <tr key={p.id} className={on ? "pe-row is-sel" : "pe-row"} data-pe-row={p.id} aria-selected={on} tabIndex={p.id === stop ? 0 : -1} onClick={onRow(p.id)} onDoubleClick={() => open(p.id)} onContextMenu={(e) => onContext?.(p.id, e)} onKeyDown={onKey(p.id)}>
                    <td>
                      <span className="pe-name">
                        <span className="np-person__ini" aria-hidden="true">{p.initials}</span>
                        <button type="button" tabIndex={-1} className="pe-name__btn" title={p.display_name} onClick={(e) => (e.stopPropagation(), open(p.id))}>{p.short_name}</button>
                      </span>
                    </td>
                    <td className="np-muted">{roleOrg(p)}</td>
                    <td className="np-tnum">{p.open_items || ""}</td>
                    <td className="np-tnum">{p.you_owe || ""}</td>
                    <td>{p.last_call_at !== null ? shortDay(p.last_call_at, prefs) : ""}</td>
                    <td>{p.voice_profile && <Icon name="wave" size={14} label={t("people.voice_on")} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {shown.status === "LISTED" && <p className="pe-hint">{t("people.hint")}</p>}
      </div>
      {shown.unnamed.length > 0 && (
        <div data-region="PL-R3" role="region" aria-label={t("people.unnamed")} className="pe-unnamed">
          <h2 className="np-section-h">{t("people.unnamed")} <span className="np-dim">· {shown.unnamed.length}</span></h2>
          <div className="pe-unnamed__list">
            {shown.unnamed.map((u) => (
              <div key={`${u.call.id}:${u.speaker_id}`} className="pe-urow">
                <strong>{t("people.unnamed_label", { n: u.n })}</strong>
                <span className="np-muted">{t("people.unnamed_meta", { call: u.call.title })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}


const usePeopleListState = (list: ReturnType<typeof createPeopleList>) => useSyncExternalStore(list.subscribe, list.get, list.get);
