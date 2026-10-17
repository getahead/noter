/* =====================================================================
   Group F — Your own Claude and ChatGPT accounts
   Two separate sign-ins instead of one "Use my own login" switch.
   - Account rows: cpt-noter-component-ui-credential-row, variant "account-login"
   - Sign-in sheet: cpt-noter-component-screen-dialogs, variant "sign-in-claude" / "sign-in-chatgpt",
     data-state = the step (intro | browser | checking | bind | error-*)
   - Agent runtime field: choose API key, your Claude account, your ChatGPT account or the local model
   The CLI (Claude Code / Codex) owns the sign-in and keeps it in the Keychain; Noter only binds to it.
   ===================================================================== */
(function () {
  const { html, raw, act, comp, icon, P, C, data: D, state } = NP;

  /* ---------------- providers ---------------- */
  const PROVIDERS = {
    claude: {
      id: 'claude', name: 'Claude', account: 'Claude account', tool: 'Claude Code', site: 'claude.ai', plans: 'Pro or Max',
      plan: 'Max', email: 'mikhail@example.com', freeEmail: 'mikhail.personal@example.com', path: '~/.local/bin/claude',
      keyRuntime: 'claude-key', accRuntime: 'claude-account', keyName: 'Anthropic API key', keyCred: 'anthropic',
      personalUse: true,
      what: 'Noter runs Claude Code with your Claude Pro or Max plan instead of the Anthropic API key. Requests count against your plan’s usage limits.',
    },
    chatgpt: {
      id: 'chatgpt', name: 'ChatGPT', account: 'ChatGPT account', tool: 'Codex', site: 'chatgpt.com', plans: 'Plus, Pro, Business or Enterprise',
      plan: 'Plus', email: 'mikhail@example.com', freeEmail: 'mikhail.personal@example.com', path: '/opt/homebrew/bin/codex',
      keyRuntime: 'codex-key', accRuntime: 'codex-account', keyName: 'Codex API key', keyCred: 'codex',
      personalUse: false,
      what: 'Noter runs Codex with your ChatGPT Plus, Pro, Business or Enterprise plan instead of a Codex API key. Requests count against your plan’s usage limits.',
    },
  };

  /* shared account state: status signed-out | signing-in | signed-in | expired */
  state.auth = state.auth || {
    claude: { status: 'signed-out', flow: null },
    chatgpt: { status: 'signed-out', flow: null },
  };
  state.agentRuntime = state.agentRuntime || {};   // agentId -> runtime id
  const A = (p) => state.auth[p];
  const signedIn = (p) => A(p).status === 'signed-in';
  const credState = (id) => { const L = NP.local('e-cred', {}); return (L[id] && L[id].state) || (id === 'anthropic' ? (NP.demo('settings') === 'key-rejected' ? 'rejected' : 'configured') : 'not-set'); };

  /* ---------------- runtimes an agent can use ---------------- */
  const RUNTIMES = [
    { id: 'claude-account', group: 'Your accounts', tool: 'Claude Code', label: 'Claude Code · your Claude account', short: 'Claude Code · your account', provider: 'claude' },
    { id: 'codex-account', group: 'Your accounts', tool: 'Codex', label: 'Codex · your ChatGPT account', short: 'Codex · your ChatGPT account', provider: 'chatgpt' },
    { id: 'claude-key', group: 'API keys', tool: 'Claude Code', label: 'Claude Code · Anthropic API key', short: 'Claude Code', key: 'anthropic' },
    { id: 'codex-key', group: 'API keys', tool: 'Codex', label: 'Codex · Codex API key', short: 'Codex', key: 'codex' },
    { id: 'local', group: 'On this Mac', tool: 'Local model', label: 'Local model · Ollama', short: 'Local model' },
  ];
  const rt = (id) => RUNTIMES.find((r) => r.id === id) || RUNTIMES[2];
  const available = (id) => {
    const r = rt(id);
    if (r.provider) return signedIn(r.provider);
    if (r.key) return credState(r.key) === 'configured';
    return true;
  };
  const agentRuntime = (agent) => {
    if (state.agentRuntime[agent.id]) return state.agentRuntime[agent.id];
    return agent.runtime === 'Codex' ? 'codex-key' : agent.runtime === 'Local model' ? 'local' : 'claude-key';
  };
  const runtimeDown = (agent) => !available(agentRuntime(agent));
  const downReason = (agent) => {
    const id = agentRuntime(agent);
    if (id === 'codex-key') return 'Codex key not set';
    if (id === 'claude-key') return 'Anthropic API key rejected';
    if (id === 'claude-account') return A('claude').status === 'expired' ? 'Claude signed you out' : 'Not signed in to your Claude account';
    if (id === 'codex-account') return A('chatgpt').status === 'expired' ? 'ChatGPT signed you out' : 'Not signed in to your ChatGPT account';
    return 'Local model not ready';
  };
  /* one-click fix when the same tool is available through a signed-in account */
  const quickFix = (agent) => {
    const id = agentRuntime(agent);
    if (id === 'codex-key' && signedIn('chatgpt')) return { label: 'Use Your ChatGPT Account', to: 'codex-account' };
    if (id === 'claude-key' && signedIn('claude')) return { label: 'Use Your Claude Account', to: 'claude-account' };
    return null;
  };
  const usedBy = (runtimeId) => D.agents.concat((NP.local('agents', {}).added) || []).filter((a) => agentRuntime(a) === runtimeId);
  const runtimeText = (agent) => rt(agentRuntime(agent)).short;

  NP.auth = { PROVIDERS, RUNTIMES, signedIn, available, agentRuntime, runtimeDown, downReason, quickFix, usedBy, runtimeText, rt };

  /* ---------------- runtime field for the agent editor ----------------
     A pop-up button with grouped choices; choices that are not connected stay visible but disabled. */
  const MODELS = { 'Claude Code': ['Haiku', 'Sonnet', 'Opus'], Codex: ['gpt-5-codex', 'gpt-5-codex-mini'], 'Local model': ['Qwen3 8B', 'Qwen3 14B'] };
  NP.auth.runtimeField = (agent) => {
    const cur = agentRuntime(agent);
    const r = rt(cur);
    const both = signedIn('claude') && signedIn('chatgpt');
    const groups = ['Your accounts', 'API keys', 'On this Mac'];
    const select = html`<span class="np-popup np-popup--form f-rt"${NP.attrs({ 'data-component': P.PRIM, 'data-primitive': 'popup-button', 'data-variant': 'form', 'data-state': available(cur) ? 'default' : 'unavailable' })}><select id="${'ag-rt-' + agent.id}" aria-label="Runtime" ${act('auth.setRuntime', { agent: agent.id })}>${groups.map((g) => html`<optgroup label="${g}">${RUNTIMES.filter((x) => x.group === g).map((x) => html`<option value="${x.id}"${x.id === cur ? raw(' selected') : ''}${!available(x.id) && x.id !== cur ? raw(' disabled') : ''}>${x.label}${available(x.id) ? '' : ' — not connected'}</option>`)}</optgroup>`)}</select>${icon('updown', { size: 11, cls: 'np-popup__chev' })}</span>`;
    const models = MODELS[r.tool] || MODELS['Claude Code'];
    const model = models.includes(agent.model) ? agent.model : models[r.tool === 'Claude Code' ? 1 : 0];
    const note = (() => {
      if (!available(cur)) {
        const fix = quickFix(agent);
        return html`<div class="e-form__warn f-rt__warn">${icon('warning', { size: 12 })} ${downReason(agent)} ${fix ? P.button(fix.label, { size: 'small', variant: 'primary', action: ['auth.setRuntime', { agent: agent.id, value: fix.to }] }) : ''}${P.button('Open Settings', { size: 'small', action: ['settings.open', { pane: 'models' }] })}</div>`;
      }
      if (r.provider) {
        const p = PROVIDERS[r.provider];
        return html`<div class="f-rt__note">${icon('person', { size: 12 })}<span>Uses ${A(r.provider).email || p.email}, ${p.name} ${A(r.provider).plan || p.plan} plan. Counts against the plan’s usage limits; the per-call budget share doesn’t apply.</span></div>`;
      }
      if (both) return html`<div class="f-rt__note">${icon('info', { size: 12 })}<span>Your Claude and ChatGPT accounts are connected. Pick either one above.</span></div>`;
      const missing = !signedIn('claude') ? 'claude' : !signedIn('chatgpt') ? 'chatgpt' : null;
      return missing ? html`<div class="f-rt__note">${icon('info', { size: 12 })}<span>You can also run agents on your own ${PROVIDERS[missing].account}. ${P.link('Sign In with ' + PROVIDERS[missing].name + '…', { action: ['auth.start', { p: missing }] })}</span></div>` : '';
    })();
    return html`<div class="e-form__inline">${select}<span class="e-form__sublabel">Model</span>${P.popup(models, model, { label: 'Model', id: 'ag-model-' + agent.id })}</div>${note}`;
  };

  /* ---------------- account row (credential-row, variant account-login) ---------------- */
  C.accountRow = (pid, o) => {
    o = o || {};
    const p = PROVIDERS[pid];
    const a = A(pid);
    const st = a.status;
    const flash = NP.flashed('acct-' + pid);
    const users = usedBy(p.accRuntime);
    const statusTag = {
      'signed-out': P.badge('Not signed in', { tone: 'neutral' }),
      'signing-in': html`<span class="e-cred__verifying">${P.progress({ variant: 'spinner', label: 'Signing in' })} Finishing in your browser…</span>`,
      'signed-in': P.badge('Signed in', { tone: 'success', icon: 'check' }),
      expired: P.badge('Signed out by ' + p.name, { tone: 'warning', icon: 'warning' }),
    }[st];
    const detail = st === 'signed-in'
      ? html`<div class="f-acct__who">${icon('person', { size: 12 })} <span>${a.email}</span><span class="np-dim">· ${p.name} ${a.plan} · through ${p.tool}</span></div>
        <div class="f-acct__use">${users.length ? `Used by ${users.length} agent${users.length === 1 ? '' : 's'}: ${users.map((u) => u.name).join(', ')}` : 'No agent uses it yet. Choose it in Agents, or for a task below.'}</div>`
      : st === 'expired'
        ? html`<div class="e-cred__reason">${icon('warning', { size: 12 })} ${p.name} ended the session for ${a.email}. ${users.length ? `${users.length} agent${users.length === 1 ? '' : 's'} paused until you sign in again.` : ''}</div>`
        : html`<div class="e-cred__use">${pid === 'claude' ? 'Use your Claude Pro or Max plan through Claude Code. Personal use only.' : 'Use your ChatGPT plan through Codex.'}</div>`;
    const actions = st === 'signed-in'
      ? html`${P.button('Test', { size: 'small', flashKey: 'acct-test-' + pid, action: ['auth.test', { p: pid }] })}${P.button('Sign Out…', { size: 'small', action: ['auth.signOut', { p: pid }] })}`
      : st === 'signing-in'
        ? html`${P.button('Show', { size: 'small', action: ['auth.resume', { p: pid }] })}${P.button('Cancel', { size: 'small', variant: 'quiet', action: ['auth.cancel', { p: pid }] })}`
        : st === 'expired'
          ? P.button('Sign In Again…', { size: 'small', variant: 'primary', action: ['auth.start', { p: pid }] })
          : P.button('Sign In with ' + p.name + '…', { size: o.variant === 'wizard' ? 'regular' : 'small', action: ['auth.start', { p: pid }] });
    return comp('credential-row', { variant: 'account-login', state: st, cls: 'e-cred e-cred--row f-acct f-acct--' + (o.variant || 'settings'), attrs: { 'data-provider': pid } },
      html`<div class="f-acct__logo" aria-hidden="true">${icon(pid === 'claude' ? 'sparkle' : 'bubble', { size: 16 })}</div>
      <div class="e-cred__main">
        <div class="e-cred__head"><span class="e-cred__name">Your ${p.account}</span>${statusTag}${flash ? C.inlineStatus(flash, { variant: 'trailing' }) : ''}</div>
        ${detail}
      </div>
      <div class="e-cred__actions">${actions}</div>`);
  };

  /* ---------------- sign-in sheet ---------------- */
  const CODE = { claude: 'QWRT-7KPL', chatgpt: 'HXDB-42MN' };
  const flow = (pid) => A(pid).flow || (A(pid).flow = { step: 'intro', ack: false, choice: 'existing', existing: false, cli: 'found', bind: {}, makeDefault: false, checks: 0 });

  const stepper = (step) => {
    const steps = [['intro', 'Prepare'], ['browser', 'Sign in'], ['checking', 'Check'], ['bind', 'Use']];
    const idx = Math.max(0, steps.findIndex((s) => step.startsWith(s[0])));
    const errIdx = step.startsWith('error') ? (step === 'error-plan' ? 2 : 1) : -1;
    const cur = errIdx >= 0 ? errIdx : idx;
    return html`<ol class="f-steps" aria-label="Sign-in steps">${steps.map((s, i) => html`<li class="f-steps__i${i < cur ? ' is-done' : i === cur ? (errIdx >= 0 ? ' is-err' : ' is-cur') : ''}"><span class="f-steps__dot">${i < cur ? icon('check', { size: 10 }) : i + 1}</span>${s[1]}</li>`)}</ol>`;
  };

  const sheetBody = (pid) => {
    const p = PROVIDERS[pid];
    const f = flow(pid);
    const step = f.step;
    const head = (title, sub) => html`<div class="np-sheet__head"><div class="f-sheet__brand">${icon(pid === 'claude' ? 'sparkle' : 'bubble', { size: 18 })}</div><div class="np-sheet__title">${title}</div>${sub ? html`<div class="np-sheet__sub">${sub}</div>` : ''}${stepper(step)}</div>`;
    const foot = (inner) => html`<div class="np-sheet__foot">${inner}</div>`;
    const cancel = P.button('Cancel', { action: ['auth.cancel', { p: pid }] });

    if (step === 'intro') {
      const cliRow = f.cli === 'missing'
        ? html`<div class="f-check is-warn">${icon('warning', { size: 14 })}<div><div><strong>${p.tool} isn’t installed</strong></div><div class="np-dim">Noter signs in through ${p.tool}. Installing it takes about a minute.</div></div>${P.button('Install ' + p.tool, { size: 'small', variant: 'primary', action: ['auth.installCli', { p: pid }] })}</div>`
        : f.cli === 'installing'
          ? html`<div class="f-check">${P.progress({ variant: 'spinner' })}<div><div><strong>Installing ${p.tool}…</strong></div><div class="np-dim">${P.progress({ value: 62, label: 'Installing' })}</div></div></div>`
          : html`<div class="f-check is-ok">${icon('checkCircle', { size: 14 })}<div><div><strong>${p.tool} found</strong></div><div class="np-dim np-mono">${p.path}</div></div></div>`;
      const existing = f.existing && f.cli === 'found'
        ? html`<div class="f-existing">${P.radioGroup('auth-existing-' + pid, [
            { value: 'existing', label: `Use ${p.email}`, note: `${p.tool} is already signed in to this ${p.name} ${p.plan} account on this Mac. No browser needed.` },
            { value: 'other', label: 'Sign in with another account', note: 'Opens your browser.' },
          ], f.choice, { label: 'Account', bind: 'auth.' + pid + '.flow.choice' })}</div>`
        : '';
      const useExisting = f.existing && f.cli === 'found' && f.choice === 'existing';
      const ackOk = !p.personalUse || f.ack;
      return html`${head('Sign in with your ' + p.account, p.what)}
        <div class="np-sheet__body">
          ${cliRow}
          ${existing}
          <ul class="f-facts">
            <li>${icon('lock', { size: 13 })}<span>Noter never sees your password. ${p.tool} keeps the sign-in in your Keychain; Noter only asks it which account is signed in.</span></li>
            <li>${icon('agent', { size: 13 })}<span>You choose which agents and tasks use it. Everything else keeps its current runtime.</span></li>
            <li>${icon('cloudLock', { size: 13 })}<span>Your privacy mode still applies: with Cloud, redacted, names and PII are replaced before anything is sent.</span></li>
          </ul>
          ${p.personalUse ? P.checkbox(`I’ll use my ${p.account} only for my own work`, f.ack, { id: 'auth-ack-' + pid, bind: 'auth.' + pid + '.flow.ack' }) : ''}
          ${p.personalUse ? html`<div class="f-fine">${p.name} plans are for personal use. Heavy automated use may be throttled. For a team rollout, use an API key.</div>` : ''}
        </div>
        ${foot(html`${cancel}<span class="np-tb__spacer"></span>${P.button(useExisting ? 'Use This Account' : 'Continue in Browser', { variant: 'primary', disabled: !ackOk || f.cli !== 'found', icon: useExisting ? null : 'external', action: ['auth.continue', { p: pid }] })}`)}`;
    }

    if (step === 'browser') {
      return html`${head('Finish signing in in your browser', `Noter opened ${p.site} in your default browser. Sign in there and allow ${p.tool}. This sheet moves on by itself.`)}
        <div class="np-sheet__body">
          <div class="f-wait">${P.progress({ variant: 'spinner', label: 'Waiting for your browser' })}<span>Waiting for your browser…</span><span class="np-dim np-tnum">4:52 left</span></div>
          <div class="f-code"><div class="np-dim">If the page asks for a code</div><div class="f-code__val np-mono">${CODE[pid]}</div>${P.button('Copy Code', { size: 'small', flashKey: 'auth-code-' + pid, action: ['auth.copyCode', { p: pid }] })}</div>
          <div class="f-links">${P.link('Open the Page Again', { action: ['auth.reopen', { p: pid }] })}${P.link('Copy Link', { action: ['auth.copyLink', { p: pid }] })}</div>
          <div class="f-sim" data-proto-chrome>
            <div class="f-sim__bar">Your browser · simulated by the prototype</div>
            <div class="f-sim__body">
              <div class="f-sim__title">${p.site}</div>
              <p>${p.tool} would like to access your ${p.name} account.</p>
              <div class="f-sim__btns">
                <button type="button" class="np-hbar__btn" ${act('auth.sim', { p: pid, r: 'ok' })}>Allow as ${p.email} (${p.plan})</button>
                <button type="button" class="np-hbar__btn" ${act('auth.sim', { p: pid, r: 'plan' })}>Allow as ${p.freeEmail} (Free)</button>
                <button type="button" class="np-hbar__btn" ${act('auth.sim', { p: pid, r: 'denied' })}>Cancel in the browser</button>
                <button type="button" class="np-hbar__btn" ${act('auth.sim', { p: pid, r: 'timeout' })}>Let it time out</button>
                <button type="button" class="np-hbar__btn" ${act('auth.sim', { p: pid, r: 'network' })}>Lose the connection</button>
              </div>
            </div>
          </div>
        </div>
        ${foot(html`${cancel}<span class="np-tb__spacer"></span>${P.button('Waiting…', { variant: 'primary', disabled: true })}`)}`;
    }

    if (step === 'checking') {
      const c = f.checks;
      const line = (i, text, done) => html`<li class="f-chk${c > i ? ' is-done' : c === i ? ' is-run' : ''}">${c > i ? icon('checkCircle', { size: 14 }) : c === i ? P.progress({ variant: 'spinner' }) : html`<span class="f-chk__dot"></span>`}<span>${c > i ? done : text}</span></li>`;
      return html`${head('Checking your account')}
        <div class="np-sheet__body"><ul class="f-chks">
          ${line(0, 'Signing in…', `Signed in as ${f.email || p.email}`)}
          ${line(1, 'Checking your plan…', `${p.name} ${p.plan} plan`)}
          ${line(2, 'Sending a short test request…', `${p.tool} answered in 1.8 s`)}
        </ul></div>
        ${foot(html`${cancel}<span class="np-tb__spacer"></span>${P.button('Checking…', { variant: 'primary', loading: true, disabled: true })}`)}`;
    }

    if (step === 'bind') {
      const same = D.agents.concat((NP.local('agents', {}).added) || []).filter((a) => {
        const id = agentRuntime(a);
        return id === p.keyRuntime || (id !== p.accRuntime && rt(id).tool === p.tool);
      });
      const count = Object.keys(f.bind).filter((k) => f.bind[k]).length;
      return html`${head(`Connected to your ${p.account}`)}
        <div class="np-sheet__body">
          <div class="f-done">${icon('checkCircle', { size: 22 })}<div><div><strong>${f.email || p.email}</strong> · ${p.name} ${p.plan}</div><div class="np-dim">${p.tool} uses this account for anything you point at it. Nothing changes until you do.</div></div></div>
          ${same.length ? html`<div class="f-bind"><div class="f-bind__h">Switch these agents to your ${p.account}?</div>
            ${same.map((a) => html`<div class="f-bind__row">${P.checkbox('', !!f.bind[a.id], { id: 'auth-bind-' + pid + '-' + a.id, ariaLabel: 'Use for ' + a.name, bind: 'auth.' + pid + '.flow.bind.' + a.id, attrs: { 'data-proto-live': true } })}${C.agentBadge(a.name)}<span class="np-dim">now ${rt(agentRuntime(a)).label}${available(agentRuntime(a)) ? '' : ' · not connected'}</span></div>`)}
          </div>` : html`<div class="np-dim">No agent runs on ${p.tool} yet. You can pick your ${p.account} for any agent in Agents.</div>`}
          ${P.checkbox(`Offer your ${p.account} first when adding an agent`, f.makeDefault, { id: 'auth-default-' + pid, bind: 'auth.' + pid + '.flow.makeDefault' })}
        </div>
        ${foot(html`${P.button('Not Now', { action: ['auth.finish', { p: pid, apply: false }] })}<span class="np-tb__spacer"></span>${P.button(count ? `Use for ${count} Agent${count === 1 ? '' : 's'}` : 'Done', { variant: 'primary', action: ['auth.finish', { p: pid, apply: true }] })}`)}`;
    }

    /* errors */
    const ERR = {
      'error-denied': { title: 'You cancelled in the browser', text: 'Nothing changed. You can try again whenever you like.', btns: [['Try Again', 'auth.retry', 'primary']] },
      'error-timeout': { title: 'The sign-in timed out', text: `The browser didn’t confirm within 5 minutes. Open ${p.site} again and finish there.`, btns: [['Open the Page Again', 'auth.retry', 'primary']] },
      'error-plan': { title: `${p.freeEmail} has no ${p.name} ${p.plans} plan`, text: `${p.tool} can only run on a paid plan. Sign in with another account, or keep using the ${p.keyName}.`, btns: [['Use Another Account', 'auth.retry', 'primary'], ['Use an API Key Instead', 'auth.useKey', 'secondary']] },
      'error-network': { title: `Couldn’t reach ${p.site}`, text: 'Check your connection and try again. Recording and transcription keep working.', btns: [['Try Again', 'auth.retry', 'primary']] },
    }[step] || { title: 'Something went wrong', text: 'Try again.', btns: [['Try Again', 'auth.retry', 'primary']] };
    return html`${head('Sign in with your ' + p.account)}
      <div class="np-sheet__body">${C.inlineBanner({ severity: step === 'error-denied' ? 'info' : 'error', title: ERR.title, text: ERR.text, dismissible: false })}</div>
      ${foot(html`${cancel}<span class="np-tb__spacer"></span>${ERR.btns.map((b) => P.button(b[0], { variant: b[2], action: [b[1], { p: pid }] }))}`)}`;
  };

  ['claude', 'chatgpt'].forEach((pid) => {
    NP.overlay('sign-in-' + pid, {
      width: 520,
      title: () => 'Sign in with your ' + PROVIDERS[pid].account,
      render: () => html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="sign-in-${pid}" data-state="${flow(pid).step}" class="f-sheet">${sheetBody(pid)}</div>`,
    });
  });

  /* ---------------- actions ---------------- */
  const later = (fn, ms) => setTimeout(() => { fn(); NP.render(); }, ms);
  NP.onMany({
    'auth.start': (a) => {
      const pid = a.p;
      const prev = A(pid).flow;
      A(pid).flow = { step: 'intro', ack: prev ? prev.ack : false, choice: 'existing', existing: !!A(pid).existing, cli: A(pid).cliMissing ? 'missing' : 'found', bind: {}, makeDefault: false, checks: 0 };
      state.popover = null; state.menu = null;
      NP.openSheet('sign-in-' + pid, {});
      return false;
    },
    'auth.resume': (a) => { NP.openSheet('sign-in-' + a.p, {}); return false; },
    'auth.installCli': (a) => {
      const f = flow(a.p); f.cli = 'installing';
      later(() => { f.cli = 'found'; A(a.p).cliMissing = false; }, 1600);
    },
    'auth.continue': (a) => {
      const pid = a.p; const f = flow(pid); const p = PROVIDERS[pid];
      if (f.existing && f.choice === 'existing') { f.email = p.email; startChecks(pid); return; }
      f.step = 'browser'; A(pid).status = 'signing-in';
      NP.flash('proto', `Opens ${p.site} in your default browser`, 1800);
    },
    'auth.sim': (a) => {
      const pid = a.p; const f = flow(pid);
      if (a.r === 'ok') { f.email = PROVIDERS[pid].email; startChecks(pid); return; }
      if (a.r === 'plan') { f.email = PROVIDERS[pid].freeEmail; f.step = 'checking'; f.checks = 1; later(() => { f.step = 'error-plan'; A(pid).status = 'signed-out'; }, 900); return; }
      f.step = 'error-' + a.r; A(pid).status = 'signed-out';
    },
    'auth.retry': (a) => { const f = flow(a.p); f.step = 'browser'; A(a.p).status = 'signing-in'; NP.flash('proto', `Opens ${PROVIDERS[a.p].site} again`, 1600); },
    'auth.useKey': (a) => { const p = PROVIDERS[a.p]; A(a.p).flow = null; A(a.p).status = 'signed-out'; state.sheet = null; if (NP.actions['cred.sheet']) NP.actions['cred.sheet']({ id: p.keyCred, mode: credState(p.keyCred) === 'configured' ? 'replace' : 'add' }); },
    'auth.cancel': (a) => { if (A(a.p).status === 'signing-in') A(a.p).status = 'signed-out'; A(a.p).flow = null; state.sheet = null; },
    'auth.copyCode': (a) => { NP.flash('auth-code-' + a.p, 'Copied', 1800); },
    'auth.copyLink': () => { NP.flash('proto', 'Copied the sign-in link', 1600); },
    'auth.reopen': (a) => { NP.flash('proto', `Opens ${PROVIDERS[a.p].site} again`, 1600); },
    'auth.finish': (a) => {
      const pid = a.p; const p = PROVIDERS[pid]; const f = flow(pid);
      let n = 0;
      if (a.apply) Object.keys(f.bind).forEach((id) => { if (f.bind[id]) { state.agentRuntime[id] = p.accRuntime; n++; } });
      A(pid).defaultForNew = !!f.makeDefault;
      A(pid).flow = null; state.sheet = null;
      NP.flash('acct-' + pid, n ? `${n} agent${n === 1 ? '' : 's'} now use it` : 'Connected', 3000);
      if (n) NP.undo(`Switched ${n} agent${n === 1 ? '' : 's'} to your ${p.account}`, { where: 'agents', action: 'auth.undoBind', args: { p: pid, ids: Object.keys(f.bind).filter((k) => f.bind[k]) } });
    },
    'auth.undoBind': (a) => { (a.ids || []).forEach((id) => { delete state.agentRuntime[id]; }); },
    'auth.test': (a) => { NP.flash('acct-test-' + a.p, 'Answered in 1.8 s', 2500); },
    'auth.signOut': (a) => {
      const p = PROVIDERS[a.p]; const users = usedBy(p.accRuntime);
      NP.openAlert({
        title: `Sign out of your ${p.account} in Noter?`,
        body: users.length ? `${users.map((u) => u.name).join(', ')} switch${users.length === 1 ? 'es' : ''} back to the ${p.keyName}${credState(p.keyCred) === 'configured' ? '' : ', which isn’t set, so they pause'}. ${p.tool} stays signed in for your own terminal use.` : `${p.tool} stays signed in for your own terminal use.`,
        checkbox: `Also sign out of ${p.tool} on this Mac`,
        variant: 'warning',
        buttons: [{ label: 'Sign Out', variant: 'primary', action: 'auth.signOutYes', args: { p: a.p } }, { label: 'Cancel', action: 'alert.close' }],
      });
      return false;
    },
    'auth.signOutYes': (a) => {
      const p = PROVIDERS[a.p];
      Object.keys(state.agentRuntime).forEach((id) => { if (state.agentRuntime[id] === p.accRuntime) state.agentRuntime[id] = p.keyRuntime; });
      A(a.p).status = 'signed-out'; A(a.p).existing = true; state.alert = null;
      NP.flash('acct-' + a.p, 'Signed out', 2500);
    },
    'auth.setRuntime': (a) => {
      const id = a.value;
      if (!id) return;
      if (!available(id)) { const r = rt(id); if (r.provider) NP.actions['auth.start']({ p: r.provider }); return false; }
      const before = agentRuntime({ id: a.agent, runtime: (D.agents.find((x) => x.id === a.agent) || {}).runtime });
      state.agentRuntime[a.agent] = id;
      const ag = D.agents.find((x) => x.id === a.agent) || ((NP.local('agents', {}).added || []).find((x) => x.id === a.agent)) || { name: 'Agent' };
      NP.undo(`${ag.name} now runs on ${rt(id).label}`, { where: 'agents', action: 'auth.setRuntimeUndo', args: { agent: a.agent, prev: before } });
    },
    'auth.setRuntimeUndo': (a) => { state.agentRuntime[a.agent] = a.prev; },
  });
  const startChecks = (pid) => {
    const f = flow(pid); const p = PROVIDERS[pid];
    f.step = 'checking'; f.checks = 0; A(pid).status = 'signing-in';
    later(() => { f.checks = 1; }, 600);
    later(() => { f.checks = 2; }, 1200);
    later(() => {
      f.checks = 3;
      A(pid).status = 'signed-in'; A(pid).email = f.email || p.email; A(pid).plan = p.plan; A(pid).existing = true;
      /* preselect agents that are down for this tool */
      D.agents.concat((NP.local('agents', {}).added) || []).forEach((ag) => { if (agentRuntime(ag) === p.keyRuntime && !available(p.keyRuntime)) f.bind[ag.id] = true; });
      f.step = 'bind';
    }, 1900);
  };

  /* demo seeding used by Settings, Agents and the harness */
  NP.auth.connect = (pid, on) => {
    const p = PROVIDERS[pid];
    if (on) Object.assign(A(pid), { status: 'signed-in', email: p.email, plan: p.plan, existing: true, flow: null });
    else { Object.assign(A(pid), { status: 'signed-out', flow: null }); Object.keys(state.agentRuntime).forEach((id) => { if (state.agentRuntime[id] === p.accRuntime) delete state.agentRuntime[id]; }); }
  };
  NP.on('auth.toggleDemo', (a) => { NP.auth.connect(a.p, !signedIn(a.p)); });

  /* ---------------- demo states on existing screens ---------------- */
  const addStates = (def, extra, apply) => {
    if (!def) return;
    def.states = (def.states || [{ id: 'default', label: 'Normal' }]).concat(extra);
    const prev = def.onDemo;
    def.onDemo = (id, ctx) => {
      ['claude', 'chatgpt'].forEach((pid) => { Object.assign(A(pid), { status: 'signed-out', flow: null, existing: false, cliMissing: false }); delete state.flash['acct-' + pid]; });
      state.agentRuntime = {};
      if (prev) prev(id, ctx);
      apply(id);
    };
  };
  const seed = (id) => {
    if (id === 'acct-claude' || id === 'acct-both' || id === 'acct-bound') NP.auth.connect('claude', true);
    if (id === 'acct-chatgpt' || id === 'acct-both' || id === 'acct-bound') NP.auth.connect('chatgpt', true);
    if (id === 'acct-bound') { state.agentRuntime['ag-devils'] = 'codex-account'; state.agentRuntime['ag-pm'] = 'claude-account'; }
    if (id === 'acct-expired') { NP.auth.connect('claude', true); state.agentRuntime['ag-architect'] = 'claude-account'; A('claude').status = 'expired'; }
    if (id === 'acct-existing') { A('claude').existing = true; A('chatgpt').existing = true; }
    if (id === 'acct-cli-missing') { A('chatgpt').cliMissing = true; }
  };
  const ACCOUNT_STATES = [
    { id: 'acct-claude', label: 'Accounts · Claude signed in' },
    { id: 'acct-chatgpt', label: 'Accounts · ChatGPT signed in' },
    { id: 'acct-both', label: 'Accounts · both signed in' },
    { id: 'acct-bound', label: 'Accounts · both signed in, agents bound' },
    { id: 'acct-expired', label: 'Accounts · Claude session ended' },
    { id: 'acct-existing', label: 'Accounts · CLI already signed in' },
    { id: 'acct-cli-missing', label: 'Accounts · Codex not installed' },
  ];
  addStates(NP.surfaces.settings, ACCOUNT_STATES, (id) => { seed(id); if (id.startsWith('acct')) state.settingsPane = 'models'; });
  addStates(NP.screens.agents, ACCOUNT_STATES.filter((s) => /claude|chatgpt|both|bound|expired/.test(s.id)), (id) => {
    seed(id);
    const L = NP.local('agents', {});
    if (id === 'acct-both' || id === 'acct-bound') L.selected = 'ag-devils';
    if (id === 'acct-expired') L.selected = 'ag-architect';
  });
  addStates(NP.surfaces.firstrun, [{ id: 'acct-wizard', label: 'Assistants · sign in with your account' }], (id) => {
    if (id === 'acct-wizard') { const L = NP.local('firstrun'); L.step = 5; }
  });

  /* ---------------- Dialogs gallery: replace the old single "own login" alert ---------------- */
  NP.galleries.dialogs = (NP.galleries.dialogs || []).filter((d) => d.id !== 'al-login').concat([
    { id: 'sh-signin-claude', label: 'Sheet · Sign in with your Claude account', surface: 'settings', open: () => { state.settingsPane = 'models'; NP.actions['auth.start']({ p: 'claude' }); } },
    { id: 'sh-signin-chatgpt', label: 'Sheet · Sign in with your ChatGPT account', surface: 'settings', open: () => { state.settingsPane = 'models'; NP.actions['auth.start']({ p: 'chatgpt' }); } },
    { id: 'al-signout-claude', label: 'Alert · Sign out of your Claude account', surface: 'settings', open: () => { state.settingsPane = 'models'; NP.auth.connect('claude', true); state.agentRuntime['ag-pm'] = 'claude-account'; NP.actions['auth.signOut']({ p: 'claude' }); } },
  ]);
})();
