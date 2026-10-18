import type { SettingsPane } from "../../core/bindings";

export interface PaneEntry {
  id: SettingsPane;
  label: string;
  /** The prototype's `PANES` keyword list (docs/prototype/clickable/src/js/50-e-5-settings.js). */
  keywords: string;
}

/** The 11 panes in DESIGN's fixed order. */
export const PANES: readonly PaneEntry[] = [
  { id: "general", label: "General", keywords: "launch login record notifications apps language storage calendars horizon ranking setup" },
  { id: "audio_and_transcription", label: "Audio & Transcription", keywords: "microphone output devices headphones speakers transcription archive languages glossary permission self-test models whisper" },
  { id: "models_and_runtimes", label: "Models & Runtimes", keywords: "api key anthropic codex claude chatgpt account sign in login ollama local runtime spend" },
  { id: "privacy", label: "Privacy", keywords: "privacy mode redaction retention audio calendar talk-time silent voice profiles left mac audit share screen test zoom teams" },
  { id: "call_screen_and_menu_bar", label: "Call Screen & Menu Bar", keywords: "display layout floating automatically latency text size menu bar title quick actions zoom" },
  { id: "hotkeys", label: "Hotkeys", keywords: "shortcut hotkey card keys pin dismiss undo restore" },
  { id: "repositories", label: "Repositories", keywords: "repository jira mapping folder tool handoff launch" },
  { id: "knowledge_sources", label: "Knowledge Sources", keywords: "source folder mcp confluence index sync" },
  { id: "maintenance", label: "Maintenance", keywords: "nightly battery backups jobs evidence bitbucket jira github" },
  { id: "performance", label: "Performance", keywords: "stages sampled metrics thresholds bottleneck" },
  { id: "updates", label: "Updates", keywords: "version channel beta install check" },
];

export type SearchResult =
  | { kind: "all"; panes: readonly PaneEntry[] }
  | { kind: "matches"; panes: readonly PaneEntry[] }
  /** The empty state reads **No settings match “text”**. */
  | { kind: "none"; panes: readonly []; text: string };

// @cpt-algo:cpt-noter-algo-ui-settings-search:p1
export function searchPanes(text: string): SearchResult {
  const q = text.trim().toLowerCase();
  if (!q) return { kind: "all", panes: PANES };
  const panes = PANES.filter((p) => `${p.label} ${p.keywords}`.toLowerCase().includes(q));
  return panes.length ? { kind: "matches", panes } : { kind: "none", panes: [], text: text.trim() };
}
