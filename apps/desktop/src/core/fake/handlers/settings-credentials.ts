import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function settingsHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Settings and credentials ─────────────────────────────────────────
  settings_get: (_a, { world }) => world.settings,
  settings_update: (a, { world, publish }) => {
    shared.checkRev(world.settings.rev, a.rev);
    const sec = a.section;
    if (sec.section === "copilot") {
      const m = sec.value.card_keys.modifiers;
      if (!m.control && !m.option && !m.command) throw coreError("invalid_input", "card keys need a modifier", { type: "validation", field: "card_keys.modifiers", rule: "no_modifier" });
    }
    if (sec.section === "audio") sec.value.retention_next_run_deletes = world.settings.audio.retention_next_run_deletes;
    (world.settings as unknown as Record<string, unknown>)[sec.section] = sec.value;
    world.settings.rev += 1;
    if (sec.section === "general") {
      world.app.setup.detection_enabled = sec.value.offer_to_record && world.app.setup.self_test.type === "passed";
      publish("setup:changed");
    }
    publish("settings:changed");
    return world.settings;
  },
  settings_unignore_app: (a, { world, publish }) => {
    const before = world.settings.general.ignored_apps.length;
    world.settings.general.ignored_apps = world.settings.general.ignored_apps.filter((x) => x.bundle_id !== a.bundle_id);
    if (world.settings.general.ignored_apps.length === before) throw coreError("not_found", `app ${a.bundle_id}`);
    world.settings.rev += 1;
    publish("settings:changed");
    return world.settings;
  },
  storage_move: (a) => {
    if (a.path && /Mobile Documents|Dropbox/.test(a.path)) throw coreError("storage_in_cloud_folder");
    return { job_run_id: newId("run") };
  },
  hotkeys_list: (_a, { world }) => world.hotkeys,
  hotkey_set: (a, { world, publish }) => {
    if (a.shortcut && !/(Ctrl|Alt|Super|Shift)\+/.test(a.shortcut)) throw coreError("invalid_input", "no modifier", { type: "validation", field: "shortcut", rule: "no_modifier" });
    if (a.shortcut === "Super+Q" || a.shortcut === "Super+Tab") throw coreError("hotkey_reserved");
    const b = world.hotkeys.bindings.find((x) => x.action === a.action);
    if (!b) throw coreError("not_found", `hotkey ${a.action}`);
    const owner = a.shortcut && world.hotkeys.bindings.find((x) => x.action !== a.action && x.shortcut === a.shortcut);
    if (owner) throw coreError("hotkey_conflict", "shortcut in use", { type: "hotkey_owner", owner: owner.action });
    b.shortcut = a.shortcut ?? null;
    b.status = b.shortcut ? (b.action === "undo_card_action" ? { type: "registered_during_capture" } : { type: "registered" }) : { type: "not_set" };
    publish("hotkeys:changed");
    return world.hotkeys;
  },
  hotkeys_reset: (_a, { world, publish }) => {
    world.hotkeys.bindings.forEach((b) => {
      b.shortcut = b.default_shortcut;
      b.status = b.action === "undo_card_action" ? { type: "registered_during_capture" } : { type: "registered" };
    });
    // Restore Defaults covers the card keys too, which live in the copilot settings section.
    world.settings.copilot.card_keys = { enabled: true, modifiers: { control: true, option: true, command: true } };
    world.settings.rev += 1;
    publish("settings:changed");
    publish("hotkeys:changed");
    return world.hotkeys;
  },
  repos_list: (_a, { world }) => world.repos,
  repo_upsert: (a, { world }) => {
    if (!a.key.trim()) throw coreError("invalid_input", "key", { type: "validation", field: "key", rule: "required" });
    const dup = world.repos.mappings.find((m) => m.key === a.key && m.id !== a.id);
    if (dup) throw coreError("invalid_input", "duplicate key", { type: "validation", field: "key", rule: "duplicate" });
    const path = a.local_path ?? `~/projects/${a.key.toLowerCase()}`;
    const existing = a.id ? world.repos.mappings.find((m) => m.id === a.id) : undefined;
    if (a.id && !existing) throw coreError("not_found", `mapping ${a.id}`);
    if (existing) Object.assign(existing, { key: a.key, local_path: path, default_tool: a.default_tool, path_exists: true });
    else world.repos.mappings.push({ id: newId("rep"), key: a.key, local_path: path, default_tool: a.default_tool, path_exists: true });
    return world.repos;
  },
  repo_remove: (a, { world }) => {
    const before = world.repos.mappings.length;
    world.repos.mappings = world.repos.mappings.filter((m) => m.id !== a.id);
    if (world.repos.mappings.length === before) throw coreError("not_found", `mapping ${a.id}`);
    return world.repos;
  },
  glossary_list: (_a, { world }) => world.glossary,
  glossary_upsert: (a, { world }) => {
    if (!a.term.trim()) throw coreError("invalid_input", "term", { type: "validation", field: "term", rule: "required" });
    const existing = a.id ? world.glossary.terms.find((t) => t.id === a.id) : undefined;
    if (a.id && !existing) throw coreError("not_found", `term ${a.id}`);
    if (existing) {
      if (a.rev != null) shared.checkRev(existing.rev, a.rev);
      Object.assign(existing, { term: a.term, variants_latin: a.variants_latin, variants_cyrillic: a.variants_cyrillic, spoken_forms: a.spoken_forms, lang: a.lang ?? null, always_apply: a.always_apply, rev: existing.rev + 1 });
    } else {
      if (world.glossary.terms.some((t) => t.term.toLowerCase() === a.term.toLowerCase())) throw coreError("invalid_input", "duplicate", { type: "validation", field: "term", rule: "duplicate" });
      world.glossary.terms.push({ id: newId("gls"), rev: 1, term: a.term, variants_latin: a.variants_latin, variants_cyrillic: a.variants_cyrillic, spoken_forms: a.spoken_forms, lang: a.lang ?? null, always_apply: a.always_apply, added_from: null });
    }
    return world.glossary;
  },
  glossary_remove: (a, { world }) => {
    const before = world.glossary.terms.length;
    world.glossary.terms = world.glossary.terms.filter((t) => t.id !== a.id);
    if (world.glossary.terms.length === before) throw coreError("not_found", `term ${a.id}`);
    return world.glossary;
  },
  audit_list: (a, { world }) => {
    const rows = world.audit.filter((r) => (a.from == null || r.at >= a.from) && (a.to == null || r.at <= a.to));
    return shared.pageRows(a.page, rows);
  },
  audit_export: (a) => ({ path: `~/Downloads/Noter privacy log.${a.format === "json" ? "json" : "md"}`, files: 1 }),
  share_test_run: (a, { world }) => ({
    rows: (["call_window", "record_prompt", "main_window", "settings_window", "menu_bar_title"] as const).map((surface) => ({
      surface,
      window_share: "hidden",
      app_share: "hidden",
      display_share: surface === "menu_bar_title" ? "visible" : "depends_on_app",
    })),
    capture_test: !a.run_capture_test ? { type: "not_run" } : shared.live(world.app.capture) ? { type: "blocked_by_call" } : { type: "passed", at: shared.now() },
  }),
  update_install: (_a, { world }) => {
    if (!world.app.environment.update?.ready) throw coreError("not_found", "no update is ready"); // F3: before the recording state
    return shared.ack;
  },
  accounts_get: (_a, { world }) => world.app.accounts,
  api_key_set: (a, { world, publish }) => {
    const key = world.app.accounts.keys.find((k) => k.provider === a.provider);
    if (!key) throw coreError("not_found");
    if (!a.key.trim()) throw coreError("invalid_input", "key", { type: "validation", field: "key", rule: "required" });
    if (a.key.trim().length < 8 || a.key.includes("bad")) {
      key.status = { type: "rejected", reason: "key_rejected" };
      publish("accounts:changed");
      throw coreError("key_rejected");
    }
    key.status = { type: "configured", verified_at: shared.now() };
    publish("accounts:changed");
    return world.app.accounts;
  },
  api_key_remove: (a, { world, publish }) => {
    const key = world.app.accounts.keys.find((k) => k.provider === a.provider);
    if (!key) throw coreError("not_found");
    key.status = { type: "not_set" };
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_signin_prepare: (a, { world }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    return { provider: a.provider, cli: acc.cli, existing: acc.cli.installed && a.provider === "claude" ? { email: "you@example.com", plan: "Max" } : null, needs_personal_use_confirmation: a.provider === "claude" };
  },
  cli_install: (a, { world, fake, emit, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.cli.tool === a.tool);
    const cli = acc?.cli ?? (world.app.accounts.local.cli.tool === a.tool ? world.app.accounts.local.cli : undefined);
    if (!cli) throw coreError("not_found");
    if (!world.app.environment.online) throw coreError("offline");
    const run = newId("run");
    const row = { id: run, job_id: "job_cli_install", kind: "cli_install" as const, name: `Install ${a.tool}`, started_at: shared.now(), finished_at: null, status: "running" as const, counts: [], error: null, progress: 0 };
    [0.4, 1].forEach((p, i) =>
      fake.later(600 * (i + 1), () => {
        emit("jobs:progress", { run: { ...row, progress: p, status: p === 1 ? "succeeded" : "running", finished_at: p === 1 ? shared.now() : null } });
        if (p === 1) {
          Object.assign(cli, { installed: true, path: `/opt/homebrew/bin/${a.tool}`, version: "1.0.0", supported: true });
          publish("accounts:changed");
        }
      }),
    );
    return { job_run_id: run };
  },
  account_signin_start: (a, { world, fake, emit, publish }) => {
    if (a.provider === "claude" && !a.personal_use_confirmed) throw coreError("personal_use_not_confirmed");
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc?.cli.installed) throw coreError("cli_missing");
    const id = newId("sis");
    const identity = { email: "you@example.com", plan: a.provider === "claude" ? "Max" : "Plus" };
    const steps = ["waiting_for_browser", "signed_in", "checking_plan", "sending_test_request", "done"] as const;
    steps.forEach((step, i) =>
      fake.later(800 * (i + 1), () => {
        if (acc.status.type !== "signing_in" || acc.status.session_id !== id) return;
        emit("signin:progress", { session_id: id, provider: a.provider, step, identity: i ? identity : null, error: null });
        if (step === "done") {
          acc.status = { type: "signed_in", identity, since: shared.now() };
          publish("accounts:changed");
        }
      }),
    );
    acc.status = { type: "signing_in", session_id: id };
    publish("accounts:changed");
    return { id, provider: a.provider, url: "https://example.com/device", code: "ABCD-EFGH", expires_at: shared.now() + 5 * shared.MIN };
  },
  account_signin_cancel: (a, { world, emit, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.status.type === "signing_in" && x.status.session_id === a.session_id);
    if (!acc) throw coreError("not_found", `session ${a.session_id}`);
    acc.status = { type: "not_signed_in" };
    emit("signin:progress", { session_id: a.session_id, provider: acc.provider, step: "waiting_for_browser", identity: null, error: "sign_in_cancelled" });
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_use_existing: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (!acc.cli.installed) throw coreError("cli_missing");
    acc.status = { type: "signed_in", identity: { email: "you@example.com", plan: a.provider === "claude" ? "Max" : "Plus" }, since: shared.now() };
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_bind_agents: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (acc.status.type !== "signed_in") throw coreError("account_signed_out");
    const runtime = a.provider === "claude" ? ("claude_account" as const) : ("chatgpt_account" as const);
    acc.agents = a.agent_ids.map((id) => {
      const ag = shared.agent(world, id);
      ag.runtime = runtime;
      return { id: ag.id, name: ag.name, badge: ag.badge };
    });
    publish("accounts:changed");
    return { accounts: world.app.accounts, change_id: shared.logChange(fake, world, { entity: { kind: "setting", id: "runtimes", label: "Agents' runtime" }, summary: `Moved ${a.agent_ids.length} agents to your ${a.provider} account` }) };
  },
  account_test: (a, { world }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (!world.app.environment.online) return { ok: false, latency_ms: null, error: "offline" };
    return acc.status.type === "signed_in" ? { ok: true, latency_ms: 840, error: null } : { ok: false, latency_ms: null, error: "account_signed_out" };
  },
  account_sign_out: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    acc.status = { type: "not_signed_in" };
    acc.agents = [];
    publish("accounts:changed");
    return world.app.accounts;
  },
  sources_list: (_a, { world }) => world.sources,
  source_add_folder: (a, { world, emit }) => {
    const path = a.path ?? "~/Documents/Notes";
    if (world.sources.sources.some((x) => x.location === path)) throw coreError("invalid_input", "already added", { type: "validation", field: "path", rule: "duplicate" });
    const row: Bindings.SourceRow = { id: newId("src"), rev: 1, kind: "folder", name: path.split("/").at(-1) ?? path, location: path, mode: "indexed", schedule: null, privacy: a.privacy, scope: a.scope, status: { type: "indexing", done: 0, total: 40 }, documents: 0, last_sync_at: null, has_token: false };
    world.sources.sources.push(row);
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_add_mcp: (a, { world, emit }) => {
    if (!a.server.trim()) throw coreError("invalid_input", "server", { type: "validation", field: "server", rule: "required" });
    const row: Bindings.SourceRow = { id: newId("src"), rev: 1, kind: "mcp", name: a.server, location: a.server, mode: a.mode, schedule: a.schedule ?? null, privacy: a.privacy, scope: a.scope, status: { type: "idle" }, documents: 0, last_sync_at: null, has_token: a.mode === "indexed" };
    world.sources.sources.push(row);
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_update: (a, { world, emit }) => {
    const row = shared.source(world, a.source_id);
    shared.checkRev(row.rev, a.rev);
    if (a.name != null) row.name = a.name;
    if (a.schedule !== undefined) row.schedule = a.schedule;
    if (a.privacy != null) row.privacy = a.privacy;
    if (a.scope != null) row.scope = a.scope;
    row.rev += 1;
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_reindex: (a, { world, fake, emit }) => {
    const row = shared.source(world, a.source_id);
    row.status = { type: "indexing", done: 0, total: row.documents || null };
    fake.later(1000, () => {
      row.status = { type: "idle" };
      row.last_sync_at = shared.now();
      emit("entity:changed", { type: "source", source: row });
    });
    return row;
  },
  source_remove: (a, { world, emit }) => {
    const row = shared.source(world, a.source_id);
    world.sources.sources = world.sources.sources.filter((x) => x !== row);
    emit("entity:changed", { type: "removed", kind: "source", id: row.id });
    return { deleted: 1 };
  },
  source_revoke_token: (a, { world }) => {
    const row = shared.source(world, a.source_id);
    if (!row.has_token) throw coreError("invalid_input", "no token", { type: "validation", field: "source_id", rule: "invalid_format" });
    row.has_token = false;
    row.status = { type: "sign_in_expired" };
    return row;
  },
  jobs_list: (_a, { world }) => ({ ...world.jobs, jobs: world.jobs.jobs.map((j) => ({ ...j, blocked_by_call: j.kind !== "post_call" && shared.live(world.app.capture) })) }),
  // D2: only post-call analysis runs while a call is live.
  job_run_now: (a, { world, fake, emit }) => {
    const j = shared.job(world, a.job_id);
    if (j.kind !== "post_call" && shared.live(world.app.capture)) throw coreError("job_blocked", "a call is live");
    if (j.running) return { job_run_id: j.last_run?.id ?? newId("run") };
    const run = { id: newId("run"), job_id: j.id, kind: j.kind, name: j.name, started_at: shared.now(), finished_at: null, status: "running" as const, counts: [], error: null, progress: 0 };
    j.running = true;
    j.last_run = run;
    emit("jobs:progress", { run });
    fake.later(1000, () => {
      if (!j.running) return;
      j.running = false;
      j.last_run = { ...run, status: "succeeded", finished_at: shared.now(), progress: 1 };
      emit("jobs:progress", { run: j.last_run });
    });
    return { job_run_id: run.id };
  },
  job_cancel: (a, { world, emit }) => {
    const j = shared.job(world, a.job_id);
    if (j.running && j.last_run) {
      j.running = false;
      j.last_run = { ...j.last_run, status: "cancelled", finished_at: shared.now() };
      emit("jobs:progress", { run: j.last_run });
    }
    return world.jobs;
  },
  job_update: (a, { world }) => {
    const j = shared.job(world, a.job_id);
    if (a.enabled != null) j.enabled = a.enabled;
    if (a.allow_on_battery != null) j.allow_on_battery = a.allow_on_battery;
    return world.jobs;
  },

  };
}
