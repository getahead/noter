import type { MouseEvent } from "react";
import type { CallRow as Call } from "../../core/bindings";
import { duration, t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { IconButton } from "../../ui/primitives/icon-button";
import { Icon } from "../../ui/icons";
import { Link } from "../../ui/primitives/link";
import { Progress } from "../../ui/primitives/progress";
import { shortDay, audioDeletedHelp, statusOf } from "./status-cell";

const ROOT = "cpt-noter-component-ui-call-row";
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Today 14:30", or "2 Oct 14:30". */
export function whenOf(ms: number, now = Date.now()): string {
  const same = shortDay(ms) === shortDay(now);
  return `${same ? t("section.today") : shortDay(ms)} ${TIME.format(ms)}`;
}

/** The call's people as "Anna, Boris +2", the user last as "You". */
export function peopleOf(c: Call, max = 3): string {
  const names = c.participants
    .filter((p) => !p.is_you)
    .map((p) => p.short_name.replace(/ [A-Z]\.$/, ""));
  if (c.participants.some((p) => p.is_you)) names.push(t("library.you"));
  return names.length > max
    ? `${names.slice(0, max).join(", ")} +${names.length - max}`
    : names.join(", ");
}

/** "one_on_one" → "One on one": the core's type id, until the list of types is read for a page that needs their labels. */
export const typeLabel = (id: string) =>
  id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");

const LanguageTag = ({ code }: { code: string }) => (
  <span
    className="np-lang"
    data-component="cpt-noter-component-ui-language-tag"
    data-variant="call"
    data-state="default"
    title={code}
    aria-label={code}
  >
    {code}
  </span>
);

export interface CallRowProps {
  call: Call;
  selected?: boolean;
  onPress: (e: MouseEvent) => void;
  onOpen: () => void;
  onContext: (e: MouseEvent) => void;
}

// @cpt-component:cpt-noter-component-ui-call-row:p1
/** One row of the Calls table (LC-R3): Return, a double-click or › opens the call; the status cell is the first status that applies. */
export function CallRowView({
  call: c,
  selected,
  onPress,
  onOpen,
  onContext,
}: CallRowProps) {
  const sensitive = c.privacy === "sensitive";
  const st = statusOf(c);
  const audioHelp = audioDeletedHelp(c);
  const state = selected
    ? "selected"
    : st
      ? st.state
      : sensitive
        ? "sensitive"
        : c.audio_deleted
          ? "audio-deleted"
          : "default";
  const title = c.title || t("library.calls.untitled");
  return (
    <tr
      className={`lb-crow${selected ? " is-sel" : ""}`}
      data-component={ROOT}
      data-variant="table-row"
      data-state={state}
      data-lib-row={c.id}
      aria-selected={!!selected}
      aria-label={title}
      tabIndex={0}
      onClick={onPress}
      // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-row
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      onKeyDown={(e) =>
        e.key === "Enter" && !e.metaKey && (e.preventDefault(), onOpen())
      }
      // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-row
    >
      <td className="lb-crow__when np-tnum">{whenOf(c.started_at)}</td>
      <td className="lb-crow__call">
        <div className="lb-crow__l1">
          <span className="lb-crow__title" title={title}>
            {title}
          </span>
          {/* @cpt-begin:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-local-only */}
          {sensitive && (
            <Badge
              text={t("library.row.local_only")}
              kind="status"
              tone="neutral"
              icon="lock"
            />
          )}
          {/* @cpt-end:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-local-only */}
        </div>
        <div className="lb-crow__l2">
          <span className="lb-crow__people">{peopleOf(c)}</span>
          <span className="lb-langs">
            {c.languages.map((l) => {
              const code = (typeof l === "string" ? l : l.code).toUpperCase();
              return <LanguageTag key={code} code={code} />;
            })}
          </span>
          {c.tags.slice(0, 2).map((tag) => (
            <Badge
              key={tag}
              text={tag}
              kind="kind"
              tone="neutral"
              cls="lb-tag"
            />
          ))}
          {c.tags.length > 2 && (
            <span className="np-dim lb-more" title={c.tags.slice(2).join(", ")}>
              {`+${c.tags.length - 2}`}
            </span>
          )}
        </div>
      </td>
      <td className="lb-crow__type">{typeLabel(c.call_type)}</td>
      <td className="lb-crow__len np-tnum">{duration(c.duration_ms / 1000)}</td>
      <td className="lb-crow__open np-tnum">
        {c.open_items ? (
          <Badge text={String(c.open_items)} kind="count" />
        ) : null}
      </td>
      {/* @cpt-begin:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-return-cell */}
      <td className="lb-crow__status">
        {st && (
          <span
            className={`lb-status lb-status--${st.tone ?? "neutral"}`}
            title={st.text}
          >
            {st.spin ? (
              <Progress variant="spinner" label={st.text} />
            ) : (
              <Icon name={st.icon!} size={12} />
            )}
            {/* @cpt-begin:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-medium */}
            <span className="lb-status__text">
              {st.link ? <Link label={st.text} onAction={onOpen} /> : st.text}
            </span>
            {/* @cpt-end:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-medium */}
          </span>
        )}
        {audioHelp && (
          <span className="lb-audiodel" title={audioHelp}>
            <Icon name="speaker" size={12} label={audioHelp} />
            <span className="lb-audiodel__x" aria-hidden="true" />
          </span>
        )}
      </td>
      {/* @cpt-end:cpt-noter-algo-ui-library-calls-status-cell:p1:inst-return-cell */}
      <td className="lb-crow__chev">
        <IconButton
          icon="chevronRight"
          label={t("library.row.open", { title })}
          size="inline"
          onAction={onOpen}
        />
      </td>
    </tr>
  );
}
