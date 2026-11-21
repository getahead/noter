import {
  useEffect,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent,
  type Ref,
} from "react";
import type { CallRow, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Menu } from "../../ui/primitives/menu";
import { Table, Th } from "../../ui/primitives/table";
import { CallRowView } from "./call-row";
import type { CallsState } from "./calls-list";
import { groupByMonth, sortOf, subtitle, type Column } from "./calls-model";
import { usePublishHead } from "./topics-head";
import type { Selection } from "./selection";
import "./library.css";

export const COLUMNS = {
  when: "library.col.when",
  call: "library.col.call",
  length: "library.col.length",
} as const satisfies Record<Column, string>;

export interface CallsViewProps {
  /** The filter bar, above the table. */
  bar?: ReactNode;
  /** Filters are set: an empty read is FILTER_EMPTY, not the first-use state. */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** The Add Tag popover of the selection. */
  actions?: ReactNode;
  state: CallsState;
  selection: Selection;
  selected: ReadonlySet<string>;
  /** The first read has taken longer than 300 ms: skeleton rows. */
  slow: boolean;
  failed: string | null;
  selfTestPassed: boolean;
  /** The core's time zone and 12/24-hour setting. */
  prefs?: UiPrefs;
  menu: { x: number; y: number } | null;
  sentinel?: Ref<HTMLDivElement>;
  onSort: (col: Column) => void;
  onPress: (id: string, e: MouseEvent) => void;
  onOpen: (id: string) => void;
  onContext: (id: string, e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onRetry: () => void;
  onRetryNext: () => void;
  onSelfTest: () => void;
  onDismissFailed: () => void;
  onCloseMenu: () => void;
  onDelete: () => void;
  onAddTag?: () => void;
  /** Removes one tag from the selected calls (Remove Tag in the context menu). */
  onRemoveTag?: (tag: string) => void;
  /** Export… of the selection (⌘E), as the toolbar button does. */
  onExport?: () => void;
}

const selectedRows = (rows: CallRow[], selected: ReadonlySet<string>) =>
  rows.filter((r) => selected.has(r.id));

/** Library › Calls as the prototype draws it: LC-R1 (title and counts) and LC-R3 (table, empty state, skeleton or error). */
/** LC-R1: the counts are the toolbar's subtitle (**212 calls · 148 hours · since 2 Sep**, or **8 calls match**), not a header in the content. */
export function callsSubtitle({ state, filtered, selected, prefs }: Pick<CallsViewProps, "state" | "filtered" | "selected" | "prefs">): string | null {
  if (state.status !== "LISTED") return null;
  const total = state.total ?? state.rows.length;
  return filtered ? t("filters.matches", { count: total }) : subtitle(state.rows, total, selectedRows(state.rows, selected).length, prefs);
}

export function CallsView(p: CallsViewProps) {
  const { state } = p;
  const chosen = selectedRows(state.rows, p.selected);
  usePublishHead(null, callsSubtitle(p));
  return (
    <>
      {/* the title is the toolbar's; this hidden heading is where focus and VoiceOver land in the content after ⌘3 */}
      <h2 className="np-sr" tabIndex={-1}>{t("library.calls.title")}</h2>
      {p.bar}
      {p.actions}
      {p.failed && (
        <InlineBanner
          banner={{
            id: "calls-delete-failed",
            severity: "error",
            text: p.failed,
          }}
          onDismiss={p.onDismissFailed}
        />
      )}
      <div
        data-region="LC-R3"
        // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-listed-several
        // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-several-listed
        data-state={chosen.length > 1 ? "selected-several" : state.status === "EMPTY" && p.filtered ? "filter-empty" : state.status.toLowerCase()}
        // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-several-listed
        // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-listed-several
        role="region"
        aria-label={t("library.calls.title")}
      >
        <Body {...p} />
      </div>
      {p.menu && (
        <div className="lb-ctx" style={{ left: p.menu.x, top: p.menu.y }}>
          <ContextMenu
            onClose={p.onCloseMenu}
            single={chosen.length === 1 ? chosen[0]! : null}
            onOpen={p.onOpen}
            onDelete={p.onDelete}
            onAddTag={p.onAddTag}
            tags={[...new Set(chosen.flatMap((c) => c.tags))]}
            onRemoveTag={p.onRemoveTag}
            onExport={p.onExport}
          />
        </div>
      )}
    </>
  );
}

function Body(p: CallsViewProps) {
  const { state, selected } = p;
  const groups = useMemo(
    () => groupByMonth(state.rows, p.prefs),
    [state.rows, p.prefs?.time_zone],
  );
  if (state.status === "ERROR")
    return (
      <InlineBanner
        banner={{
          id: "calls-error",
          severity: "error",
          text: t("library.calls.error"),
          actions: [{ label: t("action.try_again"), onAction: p.onRetry }],
        }}
      />
    );
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-if-empty
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-empty
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-filter-empty
  if (state.status === "EMPTY" && p.filtered)
    return (
      <EmptyState
        variant="filtered"
        title={t("filters.empty_title")}
        actionLabel={t("filters.clear")}
        onAction={p.onClearFilters}
      />
    );
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-filter-empty
  if (state.status === "EMPTY")
    return (
      <EmptyState
        variant="first-use"
        icon="list"
        title={t("library.calls.empty_title")}
        body={t("library.calls.empty_body")}
        actionLabel={
          p.selfTestPassed ? undefined : t("library.calls.self_test")
        }
        onAction={p.onSelfTest}
      />
    );
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-empty
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-if-empty
  if (state.status === "LOADING")
    // the area keeps its place (and says it is busy) from the first moment; the skeleton rows follow after 300 ms
    return (
      <div
        className="lb-loading"
        data-state="loading"
        aria-busy="true"
        aria-label={t("library.calls.loading")}
      >
        {p.slow && (
          <div
            className="lb-skel"
            data-component="cpt-noter-component-ui-primitives"
            data-primitive="table"
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lb-skel__row">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  const stopId = state.rows.find((c) => selected.has(c.id))?.id ?? groups[0]?.rows[0]?.id;
  const head = (col: Column, width: string) => (
    <Th
      label={t(COLUMNS[col])}
      sort={sortOf(state.sort, col)}
      width={width}
      cls="lb-th"
      onSort={() => p.onSort(col)}
    />
  );
  return (
    <>
      <Table
        variant="sortable"
        label={t("library.calls.title")}
        cls="lb-table"
        wrapCls="lb-tablewrap"
      >
        <thead>
          <tr>
            {head("when", "120px")}
            {head("call", "")}
            <th scope="col" style={{ width: "120px" }}>
              {t("library.col.type")}
            </th>
            {head("length", "80px")}
            <th scope="col" style={{ width: "60px" }}>
              {t("library.col.open")}
            </th>
            <th scope="col" style={{ width: "200px" }}>
              <span className="np-sr">{t("library.col.status")}</span>
            </th>
            <th style={{ width: "36px" }}>
              <span className="np-sr">{t("library.col.open")}</span>
            </th>
          </tr>
        </thead>
        <tbody onKeyDown={p.onKeyDown}>
          {groups.flatMap((g) => [
            <tr
              key={g.label}
              className="lb-month"
              data-variant="sticky-group-header"
            >
              <th colSpan={7} scope="rowgroup">
                {g.label}
              </th>
            </tr>,
            ...g.rows.map((c) => (
              <CallRowView
                key={c.id}
                call={c}
                selected={selected.has(c.id)}
                stop={c.id === stopId}
                onPress={p.onPress}
                onOpen={p.onOpen}
                onContext={p.onContext}
                prefs={p.prefs}
              />
            )),
          ])}
        </tbody>
      </Table>
      <div ref={p.sentinel} aria-hidden="true" />
      {/* @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-next-error */}
      {state.error && state.next && (
        <InlineBanner
          banner={{
            id: "calls-next-error",
            severity: "error",
            text: t("library.calls.error"),
            actions: [{ label: t("action.try_again"), onAction: p.onRetryNext }],
          }}
        />
      )}
      {/* @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-next-error */}
    </>
  );
}

export function ContextMenu({
  onClose,
  single,
  onOpen,
  onDelete,
  onAddTag,
  tags = [],
  onRemoveTag,
  onExport,
}: {
  onClose: () => void;
  single: CallRow | null;
  onOpen: (id: string) => void;
  onDelete: () => void;
  onAddTag?: () => void;
  /** The tags the selection carries. */
  tags?: string[];
  onRemoveTag?: (tag: string) => void;
  onExport?: () => void;
}) {
  useEffect(() => {
    document.addEventListener("pointerdown", onClose);
    return () => document.removeEventListener("pointerdown", onClose);
  }, [onClose]);
  const run = (f: () => void) => () => (onClose(), f());
  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <Menu
        variant="context-menu"
        onClose={onClose}
        items={[
          {
            label: t("library.menu.open"),
            disabled: !single,
            onSelect: run(() => single && onOpen(single.id)),
          },
          ...(onAddTag ? [{ label: t("library.add_tag"), onSelect: run(onAddTag) }] : []),
          // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tags-set
          ...(onRemoveTag ? (tags.length ? [{ header: t("library.remove_tag") }, ...tags.map((tag) => ({ label: tag, onSelect: run(() => onRemoveTag(tag)) }))] : [{ label: t("library.remove_tag"), disabled: true }]) : []),
          // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-tags-set
          ...(onExport ? [{ label: t("library.export"), kbd: "⌘E", onSelect: run(onExport) }] : []),
          { divider: true },
          {
            label: t("library.menu.delete"),
            kbd: "⌘⌫",
            destructive: true,
            onSelect: run(onDelete),
          },
        ]}
      />
    </div>
  );
}
