import { useEffect, useMemo, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useBridge } from "../../app/bridge/context";
import { useWindow } from "../../app/use-window";
import type { CoreError, PersonPage as Page, PersonRow, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Table } from "../../ui/primitives/table";
import { HistoryTimeline } from "../history/HistoryTimeline";
import { ActionItemRow } from "../items/ActionItemRow";
import { CallRowView } from "../library/call-row";
import { PushButton } from "../../ui/primitives/push-button";
import { confirmDeleteProfile, usePeopleSheets } from "./sheets";
import { holdPerson, setPersonNotice, setPersonTab, usePersonNotice, usePersonReread, usePersonStatus, usePersonTab, type PersonTab } from "./person-store";
import "../library/library.css";
import "./people.css";

const SLOW_MS = 300;

export interface PersonState {
  status: "LOADING" | "OK" | "ERROR";
  page: Page | null;
  error: CoreError | null;
}

const reading = new WeakMap<Bridge, Map<string, Promise<PersonState>>>();

/** One `person_get`; a person who no longer exists reads as the error until Delete Person returns to People.
 *  StrictMode mounts a page twice in development: a read in flight is shared, never sent twice. */
export function readPerson(bridge: Bridge, id: string): Promise<PersonState> {
  const mine = reading.get(bridge) ?? reading.set(bridge, new Map()).get(bridge)!;
  const held = mine.get(id);
  if (held) return held;
  const read = bridge
    .act("person:get", "person_get", () => bridge.core.personGet({ person_id: id }), { screen: "person" })
    .then((res): PersonState => (res.status === "ok" ? { status: "OK", page: res.data, error: null } : { status: "ERROR", page: null, error: res.error }))
    .finally(() => void mine.delete(id));
  mine.set(id, read);
  return read;
}

/** **Show All** under Last calls opens the person's Calls view. */
export const showAll = (id: string) => setPersonTab(id, "calls");

// @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-navigate
const navigate = (bridge: Bridge, target: Parameters<Bridge["core"]["windowNavigate"]>[0]["target"]) =>
  void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target }), { screen: "person" });
// @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-navigate

/** A Person page: one `person_get` read, shown as Overview, Calls or History (PE-R2..R6). */
export function PersonPage({ id }: { id: string }) {
  const bridge = useBridge();
  const tab = usePersonTab(id);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const known = useWindow(bridge, (s) => s.entities.person[id]);
  const [state, setState] = useState<PersonState>({ status: "LOADING", page: null, error: null });
  const [slow, setSlow] = useState(false);
  const [reads, setReads] = useState(0);
  const reread = usePersonReread();
  const notice = usePersonNotice();
  const status = usePersonStatus();
  const sheets = usePeopleSheets();
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-get
  useEffect(() => {
    let current = true;
    // a failed re-read keeps the page that is on screen
    void readPerson(bridge, id).then((next) => current && setState((s) => (next.status === "ERROR" ? { ...next, page: s.page } : next)));
    return () => void (current = false);
  }, [bridge, id, known?.rev, reads, reread]);
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-get
  useEffect(() => {
    holdPerson(state.page);
    return () => holdPerson(null);
  }, [state.page]);
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-overview
  useEffect(() => {
    if (state.status !== "LOADING") return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [state.status]);
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-overview
  return <PersonBody bridge={bridge} state={state} tab={tab} prefs={prefs} slow={slow} onRetry={() => setReads((n) => n + 1)} onShowAll={() => showAll(id)} notice={notice} status={status}
    // @cpt-begin:cpt-noter-flow-ui-people-voice-profile:p1:inst-open-profile
    onSetUpVoice={() => state.page && sheets.open("person-voice", { bridge, person: state.page.person, calls: state.page.calls.length })}
    // @cpt-end:cpt-noter-flow-ui-people-voice-profile:p1:inst-open-profile
    onDeleteVoice={() => state.page && void confirmDeleteProfile(bridge, state.page.person, setPersonNotice)} />;
}

export interface PersonBodyProps {
  bridge: Bridge;
  state: PersonState;
  tab: PersonTab;
  prefs: UiPrefs | undefined;
  slow: boolean;
  onRetry: () => void;
  onShowAll?: () => void;
  /** A refused action of the menu, shown above the view. */
  notice?: string | null;
  /** A done action, as a status line. */
  status?: string | null;
  onSetUpVoice?: () => void;
  onDeleteVoice?: () => void;
}

/** What the page draws for a read of the person. */
export function PersonBody({ bridge, state, tab, prefs, slow, onRetry, onShowAll, notice, status, onSetUpVoice, onDeleteVoice }: PersonBodyProps) {
  const { page } = state;
  if (!page) {
    if (state.status === "ERROR")
      return <InlineBanner banner={{ id: "person-error", severity: "error", text: t("person.error"), actions: [{ label: t("action.try_again"), onAction: onRetry }] }} />;
    return (
      <div className="lb-loading" data-state="loading" aria-busy="true" aria-label={t("person.loading")}>
        {slow && (
          <div className="lb-skel">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="lb-skel__row"><span /><span /><span /></div>
            ))}
          </div>
        )}
      </div>
    );
  }
  // @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-fields
  const p = page.person;
  // @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-fields
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-calls
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-history
  return (
    // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-return-prepare
    <div data-region="PE" data-state={tab}>
      <h2 className="np-sr" tabIndex={-1}>{p.display_name}</h2>
      {status && <div role="status" className="pe-status">{status}</div>}
      {notice && <InlineBanner banner={{ id: "person-notice", severity: "error", text: notice }} />}
      {tab === "calls" ? (
        <div data-region="PE-CALLS" role="region" aria-label={t("person.tab.calls")}>
          <CallsTable bridge={bridge} calls={page.calls} prefs={prefs} name={p.short_name} />
        </div>
      ) : tab === "history" ? (
        <div data-region="PE-HISTORY" role="region" aria-label={t("person.tab.history")}>
          {/* @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-history */}
          <HistoryTimeline bridge={bridge} target={{ type: "person", person_id: p.id }} variant="person" emptyBody={t("person.history_empty", { name: p.short_name })} />
          {/* @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-history */}
        </div>
      ) : (
        <Overview bridge={bridge} page={page} prefs={prefs} onShowAll={onShowAll} onSetUpVoice={onSetUpVoice} onDeleteVoice={onDeleteVoice} />
      )}
    </div>
    // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-return-prepare
  );
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-history
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-calls
}

function CallsTable({ bridge, calls, prefs, name, compact }: { bridge: Bridge; calls: Page["calls"]; prefs: UiPrefs | undefined; name: string; compact?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const open = (id: string) => navigate(bridge, { type: "call_page", call_id: id, tab: "summary" });
  return (
    <Table variant="sortable" label={t("person.calls_label", { name })} cls={compact ? "lb-table pe-calls--compact" : "lb-table"} wrapCls="lb-tablewrap">
      <thead>
        <tr>
          <th scope="col" style={{ width: "120px" }}>{t("library.col.when")}</th>
          <th scope="col">{t("library.col.call")}</th>
          <th scope="col" style={{ width: "120px" }}>{t("library.col.type")}</th>
          <th scope="col" style={{ width: "80px" }}>{t("library.col.length")}</th>
          <th scope="col" style={{ width: "60px" }}>{t("library.col.open")}</th>
          <th scope="col" style={{ width: "200px" }}><span className="np-sr">{t("library.col.status")}</span></th>
          <th style={{ width: "36px" }} />
        </tr>
      </thead>
      <tbody>
        {calls.map((c, i) => (
          <CallRowView key={c.id} call={c} prefs={prefs} selected={selected === c.id} stop={selected ? selected === c.id : i === 0} onPress={(id) => setSelected(id)} onOpen={open} onContext={() => {}} />
        ))}
      </tbody>
    </Table>
  );
}

const Block = ({ region, title, count, children }: { region: string; title: string; count?: string; children: React.ReactNode }) => (
  <section data-region={region} role="region" aria-label={title} className="pe-block">
    <h2 className="np-section-h">{title}{count && <> <span className="np-dim">· {count}</span></>}</h2>
    {children}
  </section>
);

// @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-calls
export function Overview({ bridge, page, prefs, onShowAll, onSetUpVoice, onDeleteVoice }: { bridge: Bridge; page: Page; prefs: UiPrefs | undefined; onShowAll?: () => void; onSetUpVoice?: () => void; onDeleteVoice?: () => void }) {
  const p: PersonRow = page.person;
  const names = useMemo(() => [...new Set([p.short_name, ...p.aliases])].join(", "), [p]);
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-person
  if (!page.calls.length)
    return (
      <div data-region="PE-R2" role="region" aria-label={t("person.tab.overview")}>
        <EmptyState variant="large" icon="person" title={t("person.no_calls_title", { name: p.short_name })} body={t("person.no_calls_body")} />
      </div>
    );
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-person
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-items
  const items = (list: Page["owns_open"], empty: string) =>
    list.length ? <div className="lb-items">{list.map((it) => <ActionItemRow key={it.id} bridge={bridge} item={it} variant="compact" />)}</div> : <EmptyState variant="section" title={empty} />;
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-items
  return (
    <div className="pe-cols">
      <div className="pe-col">
        <Block region="PE-R2" title={t("person.commitments")} count={String(page.owns_open.length)}>{items(page.owns_open, t("person.nothing_open"))}</Block>
        <Block region="PE-R3" title={t("person.asked_you")} count={t("person.asked_open", { count: page.you_owe.length })}>{items(page.you_owe, t("person.nothing_asked"))}</Block>
        <Block region="PE-R4" title={t("person.topics")}>
          {page.topics.length ? (
            <div className="pe-topics">
              {page.topics.map((tp) => (
                <button key={tp.id} type="button" className="pe-topic" onClick={() => navigate(bridge, { type: "topic", topic_id: tp.id })}>{tp.name}</button>
              ))}
            </div>
          ) : (
            <EmptyState variant="section" title={t("person.no_topics")} />
          )}
        </Block>
      </div>
      <div className="pe-col">
        <Block region="PE-R5" title={t("person.identity")}>
          <dl className="np-kv pe-identity">
            <dt>{t("person.voice")}</dt>
            <dd>
              <div>{p.voice_profile ? t("person.voice_on") : t("person.voice_off")}</div>
              <div className="pe-kvact">
                {p.voice_profile ? <PushButton label={t("person.voice_delete")} size="small" variant="destructive" onAction={onDeleteVoice} /> : <PushButton label={t("person.voice_setup")} size="small" onAction={onSetUpVoice} />}
              </div>
            </dd>
            <dt>{t("person.names")}</dt>
            <dd>{names}</dd>
            {p.email && (<><dt>{t("person.email")}</dt><dd className="pe-sel">{p.email}</dd></>)}
            {/* @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-metrics */}
            {page.talk_share !== null && (<><dt>{t("person.talk_share")}</dt><dd>{`${Math.round(page.talk_share * 100)}%`}</dd></>)}
            {/* @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-metrics */}
          </dl>
        </Block>
        <Block region="PE-R6" title={t("person.last_calls")}>
          <CallsTable bridge={bridge} calls={page.calls.slice(0, 5)} prefs={prefs} name={p.short_name} compact />
          <button type="button" className="pe-showall" onClick={onShowAll}>{t("person.show_all")}</button>
        </Block>
      </div>
    </div>
  );
}
// @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-calls
