// Status row of the prototype's src/js/50-e-1-components.js (C.statusRow): one row for a source, runtime, model, job,
// piece of evidence or share result. The status always carries both an icon and a word; the owner supplies the
// words, the subtitle and the actions, so the row holds no state of its own.
import type { ReactNode } from "react";
import { t } from "../../i18n/format";
import { Icon, type IconName } from "../icons";
import { Badge } from "../primitives/badge";
import { Progress } from "../primitives/progress";
import "./status-row.css";

export type StatusTone = "ok" | "warn" | "err" | "off" | "run";
export type StatusVariant = "source" | "runtime" | "model" | "job" | "evidence" | "share-test";

export interface StatusRowProps {
  variant?: StatusVariant;
  tone: StatusTone;
  /** Status word: "Up to date", "Failed", ... */
  word: string;
  /** Icon of the status; a running row shows the spinner instead. */
  icon?: IconName;
  title: string;
  tag?: string;
  subtitle?: ReactNode;
  /** A failure or warning line under the subtitle; hidden while running. */
  message?: string;
  /** Present while running; `total: null` is an indeterminate bar, never a made-up percentage. */
  progress?: { done: number; total: number | null };
  /** Words for the progress ("Indexing 9 of 24 files"); without them "{done} of {total}". */
  progressText?: string;
  /** The status name, for data-state ("up-to-date", "failed", "expired"); defaults to the tone. */
  state?: string;
  /** Return on the row opens it (the source sheet); makes the row a keyboard stop. */
  onOpen?: () => void;
  /** Hidden while running: no duplicate work. */
  actions?: ReactNode;
}

// @cpt-component:cpt-noter-component-ui-status-row:p1
export function StatusRow({ variant = "source", tone, word, icon, title, tag, subtitle, message, progress, progressText, state, onOpen, actions }: StatusRowProps) {
  const running = tone === "run" || !!progress;
  const value = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  return (
    <div className={`e-status e-status--${running ? "run" : tone}`} data-component="cpt-noter-component-ui-status-row" data-variant={variant} data-state={running ? "running" : (state ?? tone)} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen && ((e) => e.target === e.currentTarget && e.key === "Enter" && (e.preventDefault(), onOpen()))}>
      <span className="e-status__icon" aria-hidden={progress ? true : undefined}>{running ? <Progress variant="spinner" label={t("status.running")} /> : icon && <Icon name={icon} size={14} />}</span>
      <div className="e-status__main">
        <div className="e-status__name">
          <span className="e-status__word">{word}</span>
          <span className="e-status__title" title={title}>{title}</span>
          {tag && <Badge text={tag} kind="kind" />}
        </div>
        {subtitle && <div className="e-status__sub">{subtitle}</div>}
        {message && tone !== "ok" && !running && <div className="e-status__msg">{message}</div>}
        {running && progress && (
          <div className="e-status__prog">
            <Progress value={value} label={t("status.running")} />
            <span>{progressText ?? (progress.total ? t("status.of", { done: progress.done, total: progress.total }) : t("status.running_again"))}</span>
          </div>
        )}
      </div>
      <div className="e-status__actions">{!running && actions}</div>
    </div>
  );
}
