// The sign-in machines of one window, outside any sheet so that hiding a sheet keeps its session
// (cpt-noter-algo-ui-accounts-session). It feeds the pure machine with `signin:progress`, `jobs:progress` and the
// accounts slice from the window store, and runs the commands the sheet asks for.
import { useSyncExternalStore } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { AccountProvider, AccountsView } from "../../core/bindings";
import { holdUndo } from "../history/undo";
import { t } from "../../i18n/format";
import { bindAgents, cancelSignIn, installCli, prepareSignIn, startSignIn, useExistingAccount } from "./accounts";
import { closed, reduce, type SignIn, type SignInEvent } from "./signin-session";

const PROVIDERS: AccountProvider[] = ["claude", "chatgpt"];
const TOOL = { claude: "claude_code", chatgpt: "codex" } as const;

class Machines {
  state: Record<AccountProvider, SignIn> = { claude: closed, chatgpt: closed };
  private listeners = new Set<() => void>();
  private recovered = false;
  constructor(readonly bridge: Bridge) {
    bridge.store.subscribe(() => this.sync());
    this.sync();
  }
  subscribe = (l: () => void) => (this.listeners.add(l), () => void this.listeners.delete(l));
  get = () => this.state;
  dispatch(p: AccountProvider, e: SignInEvent) {
    const next = reduce(this.state[p], e);
    if (next === this.state[p]) return;
    this.state = { ...this.state, [p]: next };
    this.listeners.forEach((l) => l());
  }
  private signedIn = (accounts: AccountsView | undefined, p: AccountProvider) => accounts?.accounts.find((a) => a.provider === p)?.status.type === "signed_in";
  /** Window-store changes → machine events; the core's answers, never a local timer, move the steps. */
  private sync() {
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-progress
    const s = this.bridge.store.getState();
    const accounts = s.whole.accounts;
    for (const p of PROVIDERS) {
      const m = this.state[p];
      const view = accounts?.accounts.find((a) => a.provider === p);
      // a reload while the core still signs in: only the session id comes back (spec step 6)
      if (m.phase === "SIGNED_OUT" && view?.status.type === "signing_in" && !this.recovered) this.dispatch(p, { type: "recovered", sessionId: view.status.session_id, provider: p });
      if (m.sessionId) {
        const progress = s.signin[m.sessionId];
        if (progress) this.dispatch(p, { type: "progress", progress, signedIn: this.signedIn(accounts, p) });
      }
      if (m.runId) {
        const run = s.jobs[m.runId];
        if (run?.finished_at != null && run.status === "succeeded") void this.afterInstall(p, m.runId);
      }
      this.dispatch(p, { type: "accounts", signedIn: this.signedIn(accounts, p) });
    }
    if (accounts) this.recovered = true;
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-progress
  }
  private installing = new Set<string>();
  private async afterInstall(p: AccountProvider, runId: string) {
    if (this.installing.has(runId)) return;
    this.installing.add(runId);
    this.dispatch(p, { type: "installDone", runId });
    await this.prepare(p);
  }
  async prepare(p: AccountProvider) {
    const res = await prepareSignIn(this.bridge, p);
    this.dispatch(p, res.status === "ok" ? { type: "prepared", prepare: res.data } : { type: "prepareFailed", code: res.error.code });
  }
  async open(p: AccountProvider) {
    this.dispatch(p, { type: "open" });
    await this.prepare(p);
  }
  async install(p: AccountProvider) {
    const res = await installCli(this.bridge, TOOL[p]);
    if (res.status === "ok") this.dispatch(p, { type: "installStarted", runId: res.data.job_run_id });
  }
  /** Continue in Browser (a fresh guarded session) or Use This Account, by the choice of the sheet. */
  async proceed(p: AccountProvider) {
    const m = this.state[p];
    if (m.choice === "existing" && m.prepare?.existing) {
      const res = await useExistingAccount(this.bridge, p);
      if (res.status === "ok") this.dispatch(p, { type: "usedExisting", identity: m.prepare.existing });
      return;
    }
    const res = await startSignIn(this.bridge, p, m.confirmed);
    if (res.status === "ok") this.dispatch(p, { type: "started", session: res.data });
    else this.dispatch(p, { type: "prepareFailed", code: res.error.code });
  }
  /** Try Again / Open the Page Again: always the user's choice, always a fresh guarded session through the browser. */
  async retry(p: AccountProvider) {
    this.dispatch(p, { type: "choose", choice: "other" });
    await this.proceed(p);
  }
  async cancel(p: AccountProvider) {
    const id = this.state[p].sessionId;
    this.dispatch(p, { type: "cancelled" });
    if (id) await cancelSignIn(this.bridge, id);
  }
  async bind(p: AccountProvider, agentIds: string[], defaultForNew: boolean) {
    const res = await bindAgents(this.bridge, p, agentIds, defaultForNew);
    if (res.status !== "ok") return false;
    if (agentIds.length) holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("settings.accounts.bound", { count: agentIds.length }) });
    this.dispatch(p, { type: "finish" });
    return true;
  }
}

const machines = new WeakMap<Bridge, Machines>();
export const signInMachines = (bridge: Bridge): Machines => {
  let m = machines.get(bridge);
  if (!m) machines.set(bridge, (m = new Machines(bridge)));
  return m;
};

/** One provider's machine and the actions of its sheet and row. */
export function useSignIn(bridge: Bridge, provider: AccountProvider) {
  const m = signInMachines(bridge);
  const state = useSyncExternalStore(m.subscribe, () => m.state[provider], () => m.state[provider]);
  return { state, machines: m };
}
