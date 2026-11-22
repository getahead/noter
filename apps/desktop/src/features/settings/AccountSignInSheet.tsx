// The four-step sign-in sheet of one provider (docs/features/ui/accounts.md › Sign in through the user's CLI):
// Prepare, Sign in, Check, Use, and the error bodies. It draws the machine in `signin-session.ts`; the CLI owns the
// password, so nothing here asks for one. Esc hides a waiting sheet and keeps the session; only Cancel ends it.
import { useEffect, useState, type ReactNode } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { AccountProvider, AccountView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { FOCUSABLE } from "../../app/a11y/focus";
import { Icon } from "../../ui/icons";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Link } from "../../ui/primitives/link";
import { Progress } from "../../ui/primitives/progress";
import { PushButton } from "../../ui/primitives/push-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { providerName, toolName } from "./account-rows";
import { canContinue, secondsLeft, sheetOpen, stepIndex, type SignIn } from "./signin-session";
import { useSignIn } from "./signin-store";

const COMPONENT = "cpt-noter-component-screen-dialogs";
const KEY_NAME: Record<AccountProvider, MsgKey> = { claude: "settings.accounts.key_claude", chatgpt: "settings.accounts.key_chatgpt" };
const PROVIDER_TEXT: Record<AccountProvider, { account: MsgKey; site: MsgKey; plans: MsgKey; what: MsgKey; variant: string }> = {
  claude: { account: "signin.account_claude", site: "signin.site_claude", plans: "signin.plans_claude", what: "signin.what_claude", variant: "sign-in-claude" },
  chatgpt: { account: "signin.account_chatgpt", site: "signin.site_chatgpt", plans: "signin.plans_chatgpt", what: "signin.what_chatgpt", variant: "sign-in-chatgpt" },
};
const ERROR_TEXT: Record<string, { title: MsgKey; text: MsgKey }> = {
  sign_in_cancelled: { title: "signin.err.sign_in_cancelled", text: "signin.err.sign_in_cancelled_text" },
  sign_in_timed_out: { title: "signin.err.sign_in_timed_out", text: "signin.err.sign_in_timed_out_text" },
  plan_not_eligible: { title: "signin.err.plan_not_eligible", text: "signin.err.plan_not_eligible_text" },
  offline: { title: "signin.err.offline", text: "signin.err.offline_text" },
  personal_use_not_confirmed: { title: "signin.err.personal_use_not_confirmed", text: "signin.err.personal_use_not_confirmed_text" },
  other: { title: "signin.err.other", text: "signin.err.other_text" },
};
const STEPS: MsgKey[] = ["signin.step_prepare", "signin.step_signin", "signin.step_check", "signin.step_use"];

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Stepper({ s }: { s: SignIn }) {
  const cur = stepIndex(s);
  const err = s.phase === "SIGNIN_ERROR";
  return (
    <ol className="f-steps" aria-label={t("signin.steps")}>
      {STEPS.map((k, i) => (
        <li key={k} className={`f-steps__i${i < cur ? " is-done" : i === cur ? (err ? " is-err" : " is-cur") : ""}`} aria-current={i === cur ? "step" : undefined}>
          <span className="f-steps__dot">{i < cur ? <Icon name="check" size={10} /> : i + 1}</span>
          {t(k)}
        </li>
      ))}
    </ol>
  );
}

export interface SheetHostProps {
  bridge: Bridge;
  provider: AccountProvider;
  view: AccountView;
  /** **Use an API Key Instead**: opens that provider's key sheet where there is one. */
  onUseKey?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-accounts-sign-in:p1
/** The sheet of `provider` while its machine says it is on screen; null otherwise (a hidden session stays in the store). */
export function AccountSignInSheet({ bridge, provider, view, onUseKey }: SheetHostProps) {
  const { state: s, machines: m } = useSignIn(bridge, provider);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [agents, setAgents] = useState<Record<string, boolean> | null>(null);
  const [first, setFirst] = useState(false);
  const waiting = s.phase === "BROWSER" && !!s.session;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);
  // a step that replaces the focused control would leave focus outside the sheet, where Esc is not heard
  const open = sheetOpen(s);
  useEffect(() => {
    if (!open) return;
    const sheet = [...(globalThis.document?.querySelectorAll<HTMLElement>(".f-sheet") ?? [])].find((e) => e.dataset.variant === PROVIDER_TEXT[provider].variant)?.closest<HTMLElement>(".np-sheet");
    if (sheet && !sheet.contains(globalThis.document.activeElement)) sheet.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, s.phase, provider]);
  // Esc is also heard when focus is not in the sheet yet (a step just replaced the focused control); inside the sheet the
  // Sheet's own handler stops the event first
  const phase = s.phase;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      m.dispatch(provider, { type: phase === "BROWSER" || phase === "CHECK" ? "hide" : "cancelled" });
    };
    globalThis.document?.addEventListener("keydown", onKey);
    return () => globalThis.document?.removeEventListener("keydown", onKey);
  }, [open, phase, provider, m]);
  if (!open) return null;

  const account = t(PROVIDER_TEXT[provider].account);
  const tool = toolName(provider);
  const site = t(PROVIDER_TEXT[provider].site);
  const names = { account, tool, site, provider: providerName(provider), plans: t(PROVIDER_TEXT[provider].plans), key: t(KEY_NAME[provider]) };
  const title = t("signin.title", { account });
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-cancel
  const cancel = () => void m.cancel(provider);
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-cancel
  const close = () => m.dispatch(provider, { type: "cancelled" });
  // Esc: a waiting or checking sheet is hidden, the others close
  const onEsc = s.phase === "BROWSER" || s.phase === "CHECK" ? () => m.dispatch(provider, { type: "hide" }) : close;
  const copy = (kind: "code" | "link", text: string) => {
    void globalThis.navigator?.clipboard?.writeText(text);
    setCopied(kind);
  };
  const reopen = () => s.session && void bridge.core.openExternal({ target: { type: "url", url: s.session.url } });
  const bound = agents ?? Object.fromEntries(view.agents.map((a) => [a.id, true]));
  const picked = view.agents.filter((a) => bound[a.id]).map((a) => a.id);

  const head = (heading: string, sub?: string) => (
    <div className="np-sheet__head">
      <div className="np-sheet__title">{heading}</div>
      {sub && <div className="np-sheet__sub">{sub}</div>}
      <Stepper s={s} />
    </div>
  );
  const cancelButton = <PushButton label={t("signin.cancel")} onAction={cancel} />;

  let body: ReactNode;
  let footer: ReactNode;
  let onDefault: (() => void) | undefined;
  if (s.phase === "PREPARE" || s.phase === "INSTALLING") {
    const cli = s.prepare?.cli;
    const installing = s.phase === "INSTALLING";
    const unsupported = s.cliUnsupported || (!!cli && cli.installed && !cli.supported);
    const missing = s.cliMissing || (!!cli && !cli.installed);
    // a refused prepare carries no CliInfo: the row's last look at the tool names the version
    const version = (cli ?? view.cli).version;
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-existing
    const existing = s.prepare?.existing && !missing && !unsupported ? s.prepare.existing : null;
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-existing
    const useExisting = !!existing && s.choice === "existing";
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-prepare-ui
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-browser-choice
    const needsBox = s.prepare?.needs_personal_use_confirmation ?? provider === "claude";
    const go = canContinue(s) && !installing;
    onDefault = go ? () => void m.proceed(provider) : undefined;
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-browser-choice
    body = (
      <div className="np-sheet__body">
        {installing ? (
          <div className="f-check" role="status">
            <Progress variant="spinner" />
            <div>
              <strong>{t("signin.cli_installing", names)}</strong>
            </div>
          </div>
        ) : missing || unsupported ? (
          <div className="f-check is-warn" role="alert">
            <Icon name="warning" size={14} />
            <div>
              <div>
                <strong>{missing ? t("signin.cli_missing", names) : version ? t("signin.cli_unsupported_version", { ...names, version }) : t("signin.cli_unsupported", names)}</strong>
              </div>
              <div className="np-dim">{t(missing && s.installFailed ? "signin.cli_install_failed" : missing ? "signin.cli_missing_note" : "signin.cli_unsupported_note", names)}</div>
            </div>
            {missing && <PushButton label={t("signin.install", names)} size="small" onAction={() => void m.install(provider)} />}
          </div>
        ) : cli ? (
          <div className="f-check is-ok">
            <Icon name="check" size={14} />
            <div>
              <div>
                <strong>{t("signin.cli_found", names)}</strong>
              </div>
              {cli.path && <div className="np-dim np-mono">{cli.path}</div>}
            </div>
          </div>
        ) : null}
        {existing && (
          <div className="f-existing">
            <RadioGroup
              name={`signin-existing-${provider}`}
              label={t("signin.existing_label")}
              value={s.choice}
              options={[
                { value: "existing", label: t("signin.use_existing", { email: existing.email }), note: t("signin.use_existing_note", names) },
                { value: "other", label: t("signin.use_other"), note: t("signin.use_other_note") },
              ]}
              onAction={(v) => m.dispatch(provider, { type: "choose", choice: v as "existing" | "other" })}
            />
          </div>
        )}
        <ul className="f-facts">
          <li>
            <Icon name="lock" size={13} />
            <span>{t("signin.fact_password", names)}</span>
          </li>
          <li>
            <Icon name="person" size={13} />
            <span>{t("signin.fact_agents")}</span>
          </li>
          <li>
            <Icon name="info" size={13} />
            <span>{t("signin.fact_privacy")}</span>
          </li>
        </ul>
        {needsBox && (
          <>
            <Checkbox label={t("signin.personal_use")} checked={s.confirmed} onAction={(on) => m.dispatch(provider, { type: "confirm", on })} />
            <div className="f-fine">{t("signin.personal_use_note")}</div>
          </>
        )}
      </div>
    );
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-missing
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-install
    footer = (
      <SheetFooter
        defaultButton={<PushButton label={t(useExisting ? "signin.use_this" : "signin.continue")} variant="primary" disabled={!go} onAction={() => void m.proceed(provider)} />}
      >
        {cancelButton}
      </SheetFooter>
    );
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-install
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-missing
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-prepare-ui
  } else if (s.phase === "BROWSER") {
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-wait
    body = (
      <div className="np-sheet__body">
        <div className="f-wait" role="status">
          <Progress variant="spinner" label={t("signin.waiting")} />
          <span>{t("signin.waiting")}</span>
          {s.session && <span className="np-dim np-tnum">{t("signin.left", { time: clock(secondsLeft(s.session.expires_at, now)) })}</span>}
        </div>
        {s.session ? (
          <>
            {s.session.code && (
              <div className="f-code">
                <div className="np-dim">{t("signin.code_hint")}</div>
                <div className="f-code__val np-mono">{s.session.code}</div>
                <PushButton label={t("signin.copy_code")} size="small" flash={copied === "code" ? t("signin.copied") : undefined} onAction={() => copy("code", s.session!.code!)} />
              </div>
            )}
            <div className="f-links">
              <Link label={t("signin.open_again")} onAction={reopen} />
              <Link label={t("signin.copy_link")} onAction={() => copy("link", s.session!.url)} />
            </div>
          </>
        ) : (
          <div className="np-dim">{t("signin.recovered")}</div>
        )}
      </div>
    );
    footer = (
      <SheetFooter defaultButton={<PushButton label={t("signin.waiting_button")} variant="primary" disabled />}>
        {cancelButton}
      </SheetFooter>
    );
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-wait
  } else if (s.phase === "CHECK") {
    body = (
      <div className="np-sheet__body">
        <ul className="f-chks">
          <li className="f-chk is-done">
            <Icon name="check" size={14} />
            {t("signin.check_signed_in", { email: s.identity?.email ?? "" })}
          </li>
          <li className="f-chk is-done">
            <Icon name="check" size={14} />
            {t("signin.check_plan", { provider: names.provider, plan: s.identity?.plan ?? "" })}
          </li>
          <li className={`f-chk ${s.done ? "is-done" : "is-run"}`}>
            {s.done ? <Icon name="check" size={14} /> : <Progress variant="spinner" />}
            {s.done ? t("signin.check_test_done", names) : t("signin.check_test")}
          </li>
        </ul>
      </div>
    );
    footer = (
      <SheetFooter defaultButton={<PushButton label={t("signin.checking")} variant="primary" loading disabled />}>
        {cancelButton}
      </SheetFooter>
    );
  } else if (s.phase === "USE") {
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-use
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-finish
    const finish = () => m.dispatch(provider, { type: "finish" });
    const use = () => void m.bind(provider, picked, first);
    onDefault = use;
    body = (
      <div className="np-sheet__body">
        <div className="f-done">
          <Icon name="check" size={22} />
          <div>
            <div>
              <strong>{s.identity ? t("signin.use_who", { email: s.identity.email, provider: names.provider, plan: s.identity.plan }) : account}</strong>
            </div>
            <div className="np-dim">{t("signin.use_note", names)}</div>
          </div>
        </div>
        {view.agents.length ? (
          <div className="f-bind">
            <div className="f-bind__h">{t("signin.use_agents", names)}</div>
            {view.agents.map((a) => (
              <div className="f-bind__row" key={a.id}>
                <Checkbox label={a.name} checked={!!bound[a.id]} onAction={(on) => setAgents({ ...bound, [a.id]: on })} />
              </div>
            ))}
          </div>
        ) : (
          <div className="np-dim">{t("signin.use_none", names)}</div>
        )}
        <Checkbox label={t("signin.offer_first", names)} checked={first} onAction={setFirst} />
      </div>
    );
    footer = (
      <SheetFooter defaultButton={<PushButton label={picked.length ? t("signin.use_for", { count: picked.length }) : t("signin.done")} variant="primary" onAction={use} />}>
        <PushButton label={t("signin.not_now")} onAction={finish} />
      </SheetFooter>
    );
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-finish
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-use
  } else {
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-error
    // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-error
    const code = s.code ?? "";
    const known = code in ERROR_TEXT ? code : "other";
    const plan = known === "plan_not_eligible";
    // the account the plan check refused: the browser sign-in's identity, or the CLI's existing one
    const who = plan ? (s.identity ?? s.prepare?.existing ?? null) : null;
    body = (
      <div className="np-sheet__body">
        <div className="st-banner" role="alert">
          <strong>{who ? t("signin.err.plan_not_eligible_who", { ...names, email: who.email }) : t(ERROR_TEXT[known]!.title, names)}</strong>
          <div>{who ? t("signin.err.plan_not_eligible_who_text", { ...names, plan: who.plan }) : t(ERROR_TEXT[known]!.text, names)}</div>
        </div>
      </div>
    );
    footer = (
      <SheetFooter
        defaultButton={
          plan ? (
            <PushButton label={t("signin.another")} variant="primary" onAction={() => void m.open(provider)} />
          ) : (
            <PushButton label={t(known === "sign_in_timed_out" ? "signin.open_again" : "signin.try_again")} variant="primary" onAction={() => void m.retry(provider)} />
          )
        }
      >
        {cancelButton}
        {plan && onUseKey && <PushButton label={t("signin.use_key")} onAction={() => (close(), onUseKey())} />}
      </SheetFooter>
    );
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-error
    // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-if-error
  }
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-return-sign-in
  return (
    <Sheet title={title} width={520} onCancel={onEsc} onDefault={onDefault}>
      <div className="f-sheet" data-component={COMPONENT} data-variant={PROVIDER_TEXT[provider].variant} data-state={s.phase.toLowerCase()}>
        {head(s.phase === "BROWSER" ? t("signin.browser_title") : s.phase === "CHECK" ? t("signin.check_title") : s.phase === "USE" ? t("signin.use_title", names) : title, s.phase === "PREPARE" || s.phase === "INSTALLING" ? t(PROVIDER_TEXT[provider].what) : s.phase === "BROWSER" ? t("signin.browser_sub", names) : undefined)}
        {body}
        {footer}
      </div>
    </Sheet>
  );
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-return-sign-in
}
