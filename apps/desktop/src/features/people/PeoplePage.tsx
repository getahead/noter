import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";

import { useBridge } from "../../app/bridge/context";
import { useWindow } from "../../app/use-window";
import type { PersonRow, UiPrefs } from "../../core/bindings";
import { shortDay, t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Table } from "../../ui/primitives/table";
import { NONE, press, retain, type Selection } from "../library/selection";
import { holdCount } from "./count";
import { view, type PeopleView } from "./identity";
import { createPeopleList, setPeopleQuery, usePeopleQuery, type PeopleState } from "./model";
import "./people.css";

const SLOW_MS = 300;
const COLS = [
  ["name", "people.col.name"],
  ["role", "people.col.role"],
  ["theirs", "people.col.theirs"],
  ["last", "people.col.last"],
  ["voice", "people.col.voice"],
] as const;
const WIDTH: Record<string, string> = { theirs: "130px", last: "100px", voice: "110px" };

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
  const first = useRef(true);
  useEffect(() => void list.load(), [list]);
  // the core changed a person (naming, merge, edit): read the list again, keeping it on screen meanwhile
  useEffect(() => void (first.current ? (first.current = false) : list.load()), [known, list]);
  useEffect(() => {
    if (state.status !== "LOADING") return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [state.status]);
  const shown = useMemo(() => (state.read ? view(state.read, query) : null), [state.read, query]);
  useEffect(() => {
    holdCount(shown ? (shown.status === "EMPTY" ? 0 : state.read!.people.filter((p) => !p.is_you).length) : null);
    return () => holdCount(null);
  }, [shown, state.read]);
  const order = useMemo(() => shown?.rows.map((r) => r.id) ?? [], [shown]);
  useEffect(() => setSelection((s) => retain(s, order)), [order]);

  const open = (id: string) =>
    void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "person", person_id: id } }), { screen: "people" });
  return <PeopleBody status={state.status} shown={shown} query={query} prefs={prefs} selection={selection} slow={slow} onOpen={open} onSelect={(id, mods) => setSelection((s) => press(s, order, id, mods))} onRetry={() => void list.load()} />;
}

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
}

/** What the page draws for a state of the list: the table, its empty states, the skeleton or the error. */
export function PeopleBody({ status, shown, query, prefs, selection, slow, onOpen: open, onSelect, onRetry }: PeopleBodyProps) {
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
          <EmptyState variant="first-use" icon="people" title={t("people.empty_title")} body={t("people.empty_body")} />
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
                  <tr key={p.id} className={on ? "pe-row is-sel" : "pe-row"} data-pe-row={p.id} aria-selected={on} tabIndex={p.id === stop ? 0 : -1} onClick={onRow(p.id)} onDoubleClick={() => open(p.id)} onKeyDown={onKey(p.id)}>
                    <td>
                      <span className="pe-name">
                        <span className="np-person__ini" aria-hidden="true">{p.initials}</span>
                        <button type="button" tabIndex={-1} className="pe-name__btn" onClick={(e) => (e.stopPropagation(), open(p.id))}>{p.display_name}</button>
                      </span>
                    </td>
                    <td className="np-muted">{roleOrg(p)}</td>
                    <td className="np-tnum">{p.open_items || ""}</td>
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
