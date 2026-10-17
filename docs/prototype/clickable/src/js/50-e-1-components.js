/* =====================================================================
   Group E — components (DESIGN 3.2, table B rows 37, 41–48)
   proposal-row (37), status-row (41), credential-row (42),
   agent-list-row (43), agent-editor (44), council-mode-table (45),
   metric-tile (46), stage-timeline (47), bottleneck-row (48)
   plus the shared proposal actions (proposal.accept / proposal.reject).
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, C, data: D, state } = NP;

  /* local view state with defaults filled in (the shell may create an empty one first) */
  const eloc = (key, defs) => { const o = NP.local(key, {}); Object.keys(defs).forEach((k) => { if (o[k] === undefined) o[k] = typeof defs[k] === 'object' && defs[k] !== null ? JSON.parse(JSON.stringify(defs[k])) : defs[k]; }); return o; };
  NP.eloc = eloc;

  /* ---------------- example data for group E ---------------- */
  // Extra detail for the proposals waiting (Activity full rows)
  D.proposalDetail = {
    'pr-1': { time: '10:52', actor: 'job: evidence', title: 'Close “Virtualise the 10k-row table…” · PR #448 merged', reason: 'PR #448 carries VSTOR-1234 and was merged on 16 Oct, after the item was created', confidence: '0.92', kindVariant: 'close',
      evidence: 'Bitbucket · vhi-frontend · PR #448 “Virtualise drawer list (VSTOR-1234)” merged 16 Oct 09:41', spans: [{ where: 'Planning: VHI 8.0 drawer redesign · 00:31:12', before: 'Open · handed off · awaiting PR', after: 'Done · closed by PR #448' }] },
    'pr-2': { time: '02:14', actor: 'job: reconcile', title: 'Apply term “ostor” to 14 older transcripts · 21 spans', reason: 'You corrected “o-store” to “ostor” 3 times this week', confidence: '0.88', kindVariant: 'term', term: 'ostor',
      spans: [
        { where: 'Backend sync · 2 Oct · 00:12:40', before: 'the o-store bucket fills up after the upgrade', after: 'the ostor bucket fills up after the upgrade' },
        { where: 'OpenStack upgrade planning · 1 Oct · 00:33:05', before: 'we keep o store for cold data', after: 'we keep ostor for cold data' },
        { where: 'Installer review · 29 Sep · 00:21:18', before: 'Der O-Store braucht eigene Lizenzprüfung', after: 'Der ostor braucht eigene Lizenzprüfung', lang: 'de' },
      ] },
    'pr-3': { time: '03:20', actor: 'job: topics', title: 'Merge “Websocket notifications” into “Notification service”', reason: 'Same subject in 4 calls; 2 decisions name both', confidence: '0.74', kindVariant: 'merge',
      spans: [{ where: 'Topic “Websocket notifications”', before: '4 calls · 2 decisions · 1 open question', after: 'moves into “Notification service” · 9 calls' }] },
    'pr-4': { time: '03:31', actor: 'job: speakers', title: 'Name Speaker 2 in “Vendor call: MonitorCo” as Markus W.', reason: 'Voice and calendar match; 38 lines', confidence: '0.81', kindVariant: 'name',
      spans: [{ where: 'Vendor call: MonitorCo · 00:04:10', before: 'Speaker 2: Die Daten bleiben dreißig Tage.', after: 'Markus W.: Die Daten bleiben dreißig Tage.', lang: 'de' }] },
  };

  const actLocal = () => NP.eloc('activity', { decided: {}, expanded: {}, filter: 'all', outcome: {}, rowState: {}, undone: {}, kept: false, batchOpen: {} });

  /* ---------------- 37. Proposal row ----------------
     proposalRow(p, {variant:'compact'|'full', key, where}) */
  C.proposalRow = (p, o) => {
    o = o || {};
    const variant = o.variant || 'compact';
    const where = o.where || (variant === 'full' ? 'activity' : 'today');
    const L = actLocal();
    const det = D.proposalDetail[p.id] || {};
    const decided = L.decided[p.id];
    const rs = L.rowState[p.id];  // 'applying' | 'failed' | 'out-of-date'
    const title = det.title || p.title;
    const kindVariant = det.kindVariant === 'term' ? 'term-propagation' : det.kindVariant === 'close' ? 'close-proposal' : null;

    if (variant === 'compact') {
      if (decided) return '';
      return comp('proposal-row', { variant: 'compact', state: rs || 'waiting', cls: 'e-prop e-prop--compact', attrs: { 'data-kind': kindVariant } },
        html`<div class="e-prop__main"><div class="e-prop__title" title="${title}">${title}</div><div class="e-prop__reason">${p.reason}</div></div>
        <div class="e-prop__actions">${P.button('Reject', { size: 'small', action: ['proposal.reject', { id: p.id, where }] })}${P.button('Accept', { size: 'small', action: ['proposal.accept', { id: p.id, where }], loading: rs === 'applying' })}</div>`);
    }

    // full
    const open = !!L.expanded[p.id];
    let st = rs || 'waiting';
    if (decided) st = decided.outcome;
    if (open && st === 'waiting') st = 'expanded';
    let tail;
    if (decided) {
      tail = C.inlineStatus(decided.outcome === 'accepted' ? 'Accepted' : 'Rejected', { variant: 'row-outcome', actionLabel: 'Undo', action: ['proposal.undoDecision', { id: p.id, where }] });
    } else if (rs === 'failed') {
      tail = html`<span class="e-prop__err">${icon('error', { size: 12 })}Couldn't apply</span>${P.button('Try Again', { size: 'small', action: ['proposal.retry', { id: p.id, where }] })}`;
    } else if (rs === 'out-of-date') {
      tail = html`<span class="e-prop__warn">${icon('warning', { size: 12 })}The item changed since</span>${P.button('Dismiss', { size: 'small', action: ['proposal.dismiss', { id: p.id }] })}`;
    } else {
      tail = html`${det.term ? P.button('Always for This Term…', { size: 'small', variant: 'quiet', action: ['proposal.always', { id: p.id }] }) : ''}${P.button('Reject', { size: 'small', action: ['proposal.reject', { id: p.id, where }], disabled: rs === 'applying' })}${P.button('Accept', { size: 'small', action: ['proposal.accept', { id: p.id, where }], loading: rs === 'applying' })}`;
    }
    return comp('proposal-row', { variant: 'full', state: st, cls: 'e-prop e-prop--full' + (open ? ' is-open' : ''), attrs: { 'data-kind': kindVariant } },
      html`<div class="e-prop__line">
        ${P.disclosure('', open, { variant: 'row', action: ['proposal.expand', { id: p.id }], cls: 'e-prop__disc', attrs: { 'aria-label': (open ? 'Hide' : 'Show') + ' details' } })}
        <span class="e-prop__time np-tnum">${det.time || ''}</span>
        <span class="e-prop__actor">${det.actor || 'job'}</span>
        <div class="e-prop__main"><div class="e-prop__title">${title}</div><div class="e-prop__reason">${det.reason || p.reason} · confidence ${det.confidence || '0.80'}</div></div>
        <div class="e-prop__actions">${tail}</div>
      </div>
      ${open ? html`<div class="e-prop__detail">
        ${det.evidence ? html`<div class="e-prop__ev">${icon('link', { size: 12 })} ${det.evidence}</div>` : ''}
        ${rs === 'out-of-date' ? html`<div class="e-prop__ev">${icon('warning', { size: 12 })} Current text: <b>Replay buffer and backoff for websocket reconnects</b> · edited by you at 11:20</div>` : ''}
        <div class="e-prop__spans">${(det.spans || []).map((s) => html`<div class="e-prop__span"><div class="e-prop__where">${s.where}</div>${NP.c('diffView', { before: s.before, after: s.after, variant: 'inline', lang: s.lang })}</div>`)}</div>
        ${det.term && L.always && L.always[p.id] ? html`<div class="e-prop__rule">${icon('wand', { size: 13 })}<span>Glossary rule: always write <b>ostor</b> for “o-store”, “o store”, “O-Store”. New calls use it at once.</span>${P.button('Save Rule', { size: 'small', variant: 'primary', action: ['proposal.saveRule', { id: p.id }] })}</div>` : ''}
      </div>` : ''}`);
  };

  const decide = (outcome) => (a) => {
    const L = actLocal();
    const p = D.proposals.find((x) => x.id === a.id);
    if (!p) return;
    const det = D.proposalDetail[a.id] || {};
    L.decided[a.id] = { outcome, at: Date.now() };
    delete L.rowState[a.id];
    L.expanded[a.id] = false;
    const where = a.where || 'activity';
    if (where !== 'activity') {
      NP.undo((outcome === 'accepted' ? 'Accepted: ' : 'Rejected: ') + (det.title || p.title), { context: p.reason, where, action: 'proposal.undoDecision', args: { id: a.id, where } });
    }
    const at = L.decided[a.id].at;
    setTimeout(() => { const d = actLocal().decided[a.id]; if (d && d.at === at) NP.render(); }, 10050);
  };
  NP.on('proposal.accept', (a) => {
    const L = actLocal();
    if (NP.demo('activity') === 'couldnt-apply' && a.id === 'pr-1' && !L.retried) { L.rowState[a.id] = 'failed'; return; }
    decide('accepted')(a);
  });
  NP.on('proposal.reject', decide('rejected'));
  NP.on('proposal.undoDecision', (a) => { const L = actLocal(); delete L.decided[a.id]; if (state.undo && state.undo.args && state.undo.args.id === a.id && state.undo.label === 'Undo') state.undo = null; });
  NP.on('proposal.retry', (a) => {
    const L = actLocal(); L.retried = true; L.rowState[a.id] = 'applying';
    setTimeout(() => { delete L.rowState[a.id]; decide('accepted')(a); NP.render(); }, 900);
  });
  NP.on('proposal.dismiss', (a) => { const L = actLocal(); L.decided[a.id] = { outcome: 'dismissed', at: 0 }; delete L.rowState[a.id]; });
  NP.on('proposal.expand', (a) => { const L = actLocal(); L.expanded[a.id] = !L.expanded[a.id]; });
  NP.on('proposal.always', (a) => { const L = actLocal(); L.always = L.always || {}; L.always[a.id] = true; L.expanded[a.id] = true; });
  NP.on('proposal.saveRule', (a) => { decide('accepted')(Object.assign({}, a, { where: 'activity' })); NP.flash('ac-rule', 'Saved the glossary rule for “ostor”', 3000); });

  /* ---------------- 41. Status row ----------------
     statusRow(row, {variant:'source'|'job'|'evidence'|'runtime'|'model'|'share-test', where})
     row: {id, name, status:'ok'|'running'|'stale'|'error'|'expired'|'not-configured'|'disabled'|'waiting',
           statusWord, subtitle, message, tag, progress, progressText, enabled, actions:[{label, action, variant}]} */
  const STATUS = {
    ok: { icon: 'checkCircle', word: 'Up to date', cls: 'ok' },
    running: { icon: null, word: 'Running…', cls: 'run' },
    stale: { icon: 'warning', word: 'Out of date', cls: 'warn' },
    error: { icon: 'error', word: 'Failed', cls: 'err' },
    expired: { icon: 'warning', word: 'Sign-in expired', cls: 'warn' },
    'not-configured': { icon: 'info', word: 'Not configured', cls: 'off' },
    disabled: { icon: null, word: 'Off', cls: 'off' },
    waiting: { icon: 'clock', word: 'Waiting', cls: 'off' },
    hidden: { icon: 'checkCircle', word: 'Hidden', cls: 'ok' },
    visible: { icon: 'warning', word: 'Visible', cls: 'warn' },
  };
  C.statusRow = (row, o) => {
    o = o || {};
    const variant = o.variant || 'source';
    const live = NP.local('e-status', {})[row.id];
    const status = (live && live.status) || row.status || 'ok';
    const s = STATUS[status] || STATUS.ok;
    const word = row.statusWord || s.word;
    const running = status === 'running';
    return comp('status-row', { variant, state: status, cls: 'e-status e-status--' + s.cls },
      html`${variant === 'job' ? P.toggle('', status !== 'disabled', { size: 'small', ariaLabel: 'Run ' + row.name, action: ['st.jobToggle', { id: row.id }] }) : ''}
      <span class="e-status__icon">${running ? P.progress({ variant: 'spinner', label: 'Running' }) : s.icon ? icon(s.icon, { size: 14 }) : ''}</span>
      <div class="e-status__main">
        <div class="e-status__name"><span class="e-status__word">${word}</span><span class="e-status__title" title="${row.name}">${row.name}</span>${row.tag ? P.badge(row.tag, { kind: 'kind' }) : ''}</div>
        ${row.subtitle ? html`<div class="e-status__sub">${row.subtitle}</div>` : ''}
        ${status !== 'ok' && row.message && !running ? html`<div class="e-status__msg">${row.message}</div>` : ''}
        ${running ? html`<div class="e-status__prog">${P.progress({ value: live && live.progress != null ? live.progress : null, label: row.progressText || 'Running' })}<span>${row.progressText || 'Running again…'}</span></div>` : ''}
      </div>
      <div class="e-status__actions">${running ? '' : (row.actions || []).map((a) => P.button(a.label, { size: 'small', variant: a.variant || 'secondary', action: a.action }))}</div>`);
  };
  NP.on('st.retry', (a) => {
    const L = NP.local('e-status', {});
    L[a.id] = { status: 'running', progress: null };
    setTimeout(() => { L[a.id] = { status: a.then || 'ok', fixed: true }; if (a.flash) NP.flash(a.flash, a.flashText || 'Fixed', 2500); NP.render(); }, a.ms || 1400);
  });
  NP.on('st.jobToggle', (a) => { const L = NP.local('e-status', {}); const cur = L[a.id] && L[a.id].status === 'disabled'; L[a.id] = { status: cur ? 'ok' : 'disabled' }; });

  /* ---------------- 42. Credential row ----------------
     credentialRow(cred, {variant:'row'|'field', where})
     cred: {id, name, use, state:'not-set'|'configured'|'rejected'|'verifying'|'locked', reason, optional} */
  C.credentialRow = (cred, o) => {
    o = o || {};
    const variant = o.variant || 'row';
    const L = NP.local('e-cred', {});
    const st = (L[cred.id] && L[cred.id].state) || cred.state || 'not-set';
    if (variant === 'field') {
      const f = L['f-' + cred.id] || {};
      const fst = f.state || 'empty';
      return comp('credential-row', { variant: 'field', state: fst === 'empty' ? 'not-set' : fst, cls: 'e-cred e-cred--field' },
        html`<div class="e-cred__name">${cred.name}${cred.optional ? html` <span class="np-dim">· optional</span>` : ''}</div>
        <div class="e-cred__use">${cred.use}</div>
        <div class="e-cred__form">${P.textField({ id: 'cred-' + cred.id, variant: 'secure', placeholder: 'Paste your key', ariaLabel: cred.name, bind: 'local.e-cred.f-' + cred.id + '.value', value: f.value || '', invalid: fst === 'invalid', message: 'Anthropic rejected this key (invalid key)' })}${P.button('Verify', { loading: fst === 'verifying', action: ['cred.verifyField', { id: cred.id }] })}</div>
        ${fst === 'verified' ? html`<div class="e-cred__ok">${icon('checkCircle', { size: 13 })} Verified · stored in the Keychain</div>` : ''}`);
    }
    const tags = {
      'not-set': P.badge('Not set', { tone: 'neutral' }),
      configured: P.badge('Configured', { tone: 'success', icon: 'check' }),
      rejected: P.badge('Rejected', { tone: 'error', icon: 'error' }),
      verifying: html`<span class="e-cred__verifying">${P.progress({ variant: 'spinner', label: 'Verifying' })} Verifying…</span>`,
      locked: P.badge('Configured', { tone: 'success', icon: 'check' }),
    };
    if (L.pending === cred.id && !state.sheet) {
      L.pending = null;
      if ((NP.local('c-dialogs', {}).key || '') === 'ok') { L[cred.id] = { state: 'configured' }; NP.flash('cred-' + cred.id, 'Saved', 2000); return C.credentialRow(cred, o); }
    }
    const locked = st === 'locked' || o.locked;
    const flash = NP.flashed('cred-' + cred.id);
    return comp('credential-row', { variant: 'row', state: locked ? 'keychain-locked' : st, cls: 'e-cred e-cred--row' },
      html`<div class="e-cred__main">
        <div class="e-cred__head"><span class="e-cred__name">${cred.name}</span>${tags[st]}${flash ? C.inlineStatus(flash, { variant: 'trailing' }) : ''}</div>
        <div class="e-cred__use">${cred.use}</div>
        ${st === 'rejected' ? html`<div class="e-cred__reason">${icon('error', { size: 12 })} ${cred.reason || 'Anthropic rejected this key (invalid key)'}</div>` : ''}
        ${st === 'configured' || st === 'locked' ? html`<div class="e-cred__kc"><span class="np-mono">••••••••</span> Stored in the Keychain</div>` : ''}
      </div>
      <div class="e-cred__actions">
        ${st === 'not-set' ? P.button('Add…', { size: 'small', disabled: locked, action: ['cred.sheet', { id: cred.id, mode: 'add' }] }) : html`${P.button('Replace…', { size: 'small', disabled: locked || st === 'verifying', action: ['cred.sheet', { id: cred.id, mode: 'replace' }] })}${P.button('Remove…', { size: 'small', disabled: locked || st === 'verifying', action: ['cred.remove', { id: cred.id, name: cred.name }] })}`}
      </div>`);
  };
  NP.on('cred.verifyField', (a) => {
    const L = NP.local('e-cred', {}); const f = L['f-' + a.id] = L['f-' + a.id] || {};
    f.state = 'verifying';
    setTimeout(() => { f.state = (f.value || '').trim().length < 8 ? 'invalid' : 'verified'; NP.render(); }, 900);
  });
  NP.on('cred.remove', (a) => NP.openAlert({ title: `Remove the ${a.name}?`, body: 'Noter can no longer use this runtime until you add a key again. The key is deleted from the Keychain.', variant: 'destructive', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Remove', variant: 'destructive', action: 'cred.removeConfirm', args: { id: a.id } }] }));
  NP.on('cred.removeConfirm', (a) => { NP.local('e-cred', {})[a.id] = { state: 'not-set' }; state.alert = null; });
  NP.on('cred.sheet', (a) => {
    // The key sheet is group C's dialog (dlg-api-key); remember which row asked so the row updates after Save.
    const L = NP.local('e-cred', {}); L.pending = a.id;
    const cd = NP.local('c-dialogs', {}); cd.key = 'idle';
    if (NP.overlays['dlg-api-key']) NP.openSheet('dlg-api-key', { id: a.id, mode: a.mode });
    else { L[a.id] = { state: 'configured' }; NP.flash('cred-' + a.id, 'Saved', 2000); }
    return false;
  });

  /* ---------------- 43. Agent list row ----------------
     agentListRow(agent, {variant:'built-in'|'added'|'new', selected}) */
  const agLocal = () => NP.eloc('agents', { selected: 'council', view: 'settings', enabled: {}, turnedOn: {}, order: null, added: [] });
  C.agentListRow = (agent, o) => {
    o = o || {};
    const L = agLocal();
    const variant = o.variant || (agent.isNew ? 'new' : agent.builtIn === false ? 'added' : 'built-in');
    const on = L.enabled[agent.id] != null ? L.enabled[agent.id] : agent.enabled;
    const selected = o.selected != null ? o.selected : L.selected === agent.id;
    const runtimeDown = NP.auth ? NP.auth.runtimeDown(agent) : agent.status === 'unavailable';
    const switchedOff = agent.switchedOff && !L.turnedOn[agent.id];
    const st = runtimeDown ? 'runtime-unavailable' : switchedOff ? 'switched-itself-off' : on ? 'enabled' : 'disabled';
    const hit = variant === 'new' || !agent.cards7d ? 'No data yet' : agent.useful + ' %';
    return comp('agent-list-row', { variant, state: (selected ? 'selected ' : '') + st, cls: 'e-agrow' + (selected ? ' is-sel' : '') + (on ? '' : ' is-off'), attrs: { 'data-proto-action': 'ag.select', 'data-proto-args': JSON.stringify({ id: agent.id }), role: 'option', 'aria-selected': String(selected), tabindex: '0' } },
      html`<span class="e-agrow__grip" title="Drag to reorder">${icon('grip', { size: 13 })}</span>
      ${P.toggle('', on, { size: 'small', ariaLabel: (on ? 'Turn off ' : 'Turn on ') + agent.name, action: ['ag.toggle', { id: agent.id }] })}
      <div class="e-agrow__main">
        <div class="e-agrow__top">${C.agentBadge(agent.name)}<span class="e-agrow__hit">${hit}</span></div>
        <div class="e-agrow__sub">${NP.auth ? NP.auth.runtimeText(agent) : agent.runtime} · ${String(agent.model).toLowerCase()} · ${String(agent.effort).toLowerCase()}</div>
        ${runtimeDown ? html`<div class="e-agrow__warn">${icon('warning', { size: 12 })}<span>${NP.auth ? NP.auth.downReason(agent) : 'Codex key not set'}</span>${NP.auth && NP.auth.quickFix(agent) ? P.link(NP.auth.quickFix(agent).label, { action: ['auth.setRuntime', { agent: agent.id, value: NP.auth.quickFix(agent).to }] }) : P.link('Open Settings', { action: ['settings.open', { pane: 'models' }] })}</div>` : ''}
        ${switchedOff ? html`<div class="e-agrow__warn">${icon('warning', { size: 12 })}<span>Switched itself off for 1:1 calls</span>${P.link('Turn On', { action: ['ag.turnOn', { id: agent.id }] })}</div>` : ''}
      </div>`);
  };

  /* ---------------- 44. Agent editor ----------------
     agentEditor(agent, {live}) */
  C.agentEditor = (agent, o) => {
    o = o || {};
    const L = agLocal();
    const f = L['f-' + agent.id] = L['f-' + agent.id] || { name: agent.name, runtime: agent.runtime, model: agent.model, effort: agent.effort, budget: agent.budget, tools: { library: true, jira: true, confluence: false }, runs: { '1:1': false, Planning: true, 'Cross-team': true, Interview: false, Incident: true } };
    const total = D.agents.reduce((s, a) => s + (a.id === agent.id ? Number(f.budget) : Number((L['f-' + a.id] || {}).budget != null ? L['f-' + a.id].budget : a.budget)), 0) + (L.added || []).reduce((s, a) => s + (a.id === agent.id ? 0 : Number((L['f-' + a.id] || {}).budget || 0)), 0);
    const over = total > 100;
    const runtimeDown = NP.auth ? NP.auth.runtimeDown(agent) : agent.status === 'unavailable';
    const row = (label, control, note) => html`<div class="e-form__row"><div class="e-form__label">${label}</div><div class="e-form__ctl">${control}${note || ''}</div></div>`;
    const stance = { Architect: 'Reads for boundaries, coupling, versioning and what breaks when a component changes.', 'Product manager': 'Asks who owns what, by when, and what the user gets out of it.', Designer: 'Looks for states nobody drew: empty, loading, error, long German strings.', 'QA lead': 'Asks how a change is tested and what the acceptance criteria are.', 'Security reviewer': 'Flags data leaving the company, retention and access to credentials.', Scribe: 'Keeps decisions, owners and dates straight.', "Devil's advocate": 'Argues the other side of every decision once.' }[agent.name] || 'Reads the call from its role and raises one point at a time.';
    return comp('agent-editor', { variant: agent.builtIn === false ? 'added-agent' : 'built-in-agent', state: over ? 'validation-error' : runtimeDown ? 'runtime-unavailable' : o.live ? 'live-call' : 'default', cls: 'e-form' },
      html`${row('Name', P.textField({ id: 'ag-name-' + agent.id, value: f.name, bind: 'local.agents.f-' + agent.id + '.name', ariaLabel: 'Name' }))}
      ${row('Skill', html`<span class="np-mono e-form__path">~/Library/Application Support/Noter/skills/${agent.skill}</span>`)}
      ${row('Runtime', NP.auth ? NP.auth.runtimeField(agent) : '')}
      ${row('Effort', P.segmented(['Low', 'Medium', 'High', 'Max'], f.effort, { variant: 'option', label: 'Effort', action: ['ag.field', { id: agent.id, field: 'effort' }] }))}
      ${row('Budget share', P.slider({ id: 'ag-budget-' + agent.id, value: f.budget, min: 0, max: 100, unit: '%', label: 'Budget share', action: ['ag.field', { id: agent.id, field: 'budget' }] }),
        over ? html`<div class="e-form__err">${icon('error', { size: 12 })} Shares add up to ${total} %. Lower one to save.</div>` : '')}
      ${row('Tools', html`<div class="e-form__checks">${P.checkbox('Noter library', f.tools.library, { bind: 'local.agents.f-' + agent.id + '.tools.library' })}${P.checkbox('Jira', f.tools.jira, { bind: 'local.agents.f-' + agent.id + '.tools.jira' })}${P.checkbox('Confluence source', f.tools.confluence, { bind: 'local.agents.f-' + agent.id + '.tools.confluence' })}</div>`,
        html`<div class="e-form__note">Parallel mode only; agents never call tools during a live call.</div>`)}
      ${row('Runs on', html`<div class="e-form__checks">${Object.keys(f.runs).map((k) => P.checkbox(k, f.runs[k], { bind: 'local.agents.f-' + agent.id + '.runs.' + k }))}</div>`)}
      ${row('Stance', html`<div class="e-form__stance">${stance}</div>`)}`);
  };
  NP.on('ag.field', (a) => { const L = agLocal(); const f = L['f-' + a.id]; if (f) f[a.field] = a.field === 'budget' ? Number(a.value) : a.value; });
  NP.on('ag.toggle', (a) => { const L = agLocal(); const ag = D.agents.find((x) => x.id === a.id) || L.added.find((x) => x.id === a.id); const cur = L.enabled[a.id] != null ? L.enabled[a.id] : ag && ag.enabled; L.enabled[a.id] = a.value != null ? !!a.value : !cur; });
  NP.on('ag.select', (a) => { agLocal().selected = a.id; });
  NP.on('ag.turnOn', (a) => { agLocal().turnedOn[a.id] = true; NP.flash('ag-status', 'Turned on for 1:1 calls', 2500); });

  /* ---------------- 45. Council mode table ---------------- */
  C.councilModeTable = (o) => {
    o = o || {};
    const L = agLocal();
    L.council = L.council || [
      { type: '1:1', live: 'Fused', after: 'Parallel', agents: 'Teamlead, Product manager' },
      { type: 'Planning', live: 'Fused', after: 'Parallel', agents: '6 agents' },
      { type: 'Cross-team', live: 'Fused', after: 'Parallel', agents: '5 agents' },
      { type: 'Interview', live: 'Fused', after: 'Fused', agents: '2 agents' },
      { type: 'Incident', live: 'Parallel', after: 'Parallel', agents: 'Backend engineer, Architect, Teamlead' },
    ];
    const opts = [{ value: 'Fused', label: 'Fused' }, { value: 'Parallel', label: 'Parallel (opt-in)' }];
    return comp('council-mode-table', { variant: o.variant || 'wide', state: L.council.some((r) => r.live === 'Parallel') ? 'parallel-live-chosen' : 'default', cls: 'e-council' },
      P.table({ variant: 'sortable', label: 'Council mode per call type' }, html`<thead><tr>${P.th('Call type')}${P.th('Live')}${P.th('After the call')}${P.th('Agents')}</tr></thead>
      <tbody>${L.council.map((r, i) => html`<tr>
        <td>${r.type}</td>
        <td><span class="e-council__cell">${P.popup(opts, r.live, { label: 'Live mode for ' + r.type, action: ['ag.council', { i, field: 'live' }] })}${r.live === 'Parallel' ? P.badge('Opt-in', { tone: 'info' }) : ''}</span></td>
        <td>${P.popup(['Fused', 'Parallel'], r.after, { label: 'After the call for ' + r.type, action: ['ag.council', { i, field: 'after' }] })}</td>
        <td>${P.link(r.agents, { action: ['ag.filterType', { type: r.type }] })}</td>
      </tr>`)}</tbody>`));
  };
  NP.on('ag.council', (a) => { const L = agLocal(); L.council[a.i][a.field] = a.value; });
  NP.on('ag.filterType', (a) => { const L = agLocal(); L.filterType = L.filterType === a.type ? null : a.type; });

  /* ---------------- 46. Metric tile ----------------
     metricTile(m, {variant, selected})  m: {id, name, value, target, p50, status:'ok'|'near'|'over'|'more-data', trend:[], trendWord, blocker, rate} */
  const TILE = { ok: ['checkCircle', 'On budget'], near: ['warning', 'Near'], over: ['error', 'Over'], 'more-data': ['info', 'Not enough data'] };
  const spark = (vals) => {
    if (!vals || !vals.length) return '';
    const w = 96, h = 22, max = Math.max(...vals), min = Math.min(...vals);
    const pts = vals.map((v, i) => `${(i * (w / (vals.length - 1))).toFixed(1)},${(h - 2 - ((v - min) / ((max - min) || 1)) * (h - 4)).toFixed(1)}`);
    const last = pts[pts.length - 1].split(',');
    return raw(`<svg class="e-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.4" points="${pts.join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="currentColor"/></svg>`);
  };
  C.metricTile = (m, o) => {
    o = o || {};
    const st = m.status || 'ok';
    const [ic, word] = TILE[st];
    const variant = m.blocker ? 'release-blocker' : m.rate ? 'rate-metric' : 'timing-metric';
    return comp('metric-tile', { variant, state: (o.selected ? 'selected ' : '') + (st === 'ok' ? 'on-budget' : st === 'more-data' ? 'needs-more-data' : st), tag: 'button', cls: 'e-tile e-tile--' + st + (o.selected ? ' is-sel' : ''), attrs: { type: 'button', 'data-proto-action': 'pf.tile', 'data-proto-args': JSON.stringify({ id: m.id }), 'aria-pressed': String(!!o.selected) } },
      html`<span class="e-tile__status">${icon(ic, { size: 13 })}${word}</span>
      <span class="e-tile__name">${m.name}</span>
      ${st === 'more-data' ? html`<span class="e-tile__need">Needs ${m.needed || 3} more calls</span>` : html`<span class="e-tile__value np-tnum">${m.value}</span>
      <span class="e-tile__target np-tnum">${m.target}${m.p50 ? ' · p50 ' + m.p50 : ''}</span>
      <span class="e-tile__trend">${spark(m.trend)}<span>${m.trendWord || 'Trend: unchanged'}</span></span>`}
      ${m.blocker ? html`<span class="e-tile__blocker">◆ Release blocker</span>` : ''}`);
  };

  /* ---------------- 47. Stage timeline ----------------
     stageTimeline({stages, variant:'aggregate'|'mini', selected, label})  stage: {id,label,p95,budget,unit,p50} */
  const stStatus = (s) => (s.p95 == null ? 'no-data' : s.p95 > s.budget * 1.05 ? 'over' : s.p95 > s.budget * 0.9 ? 'near' : 'on-budget');  /* Settings › Performance defaults: Near above 90 %, Over above 105 % of budget, as the tiles */
  C.stageTimeline = (o) => {
    o = o || {};
    const stages = o.stages || D.perfStages;
    if (o.variant === 'mini') {
      const total = stages.reduce((s, x) => s + (x.p95 || 0), 0);
      const budget = stages.reduce((s, x) => s + x.budget, 0);
      const scale = Math.max(total, budget) || 1;
      return comp('stage-timeline', { variant: 'mini-per-tick', state: total > budget ? 'over' : 'on-budget', tag: 'span', cls: 'e-mini', attrs: { title: stages.map((x) => `${x.label} ${x.p95} s / ${x.budget}`).join(' · ') } },
        html`${stages.map((x) => html`<span class="e-mini__seg${total > budget && x.p95 > x.budget * 1.05 ? ' is-over' : ''}" style="width:${((x.p95 / scale) * 100).toFixed(1)}%"></span>`)}<span class="e-mini__budget" style="left:${((budget / scale) * 100).toFixed(1)}%"></span>`);
    }
    const max = Math.max(...stages.map((x) => Math.max(x.p95 || 0, x.budget))) * 1.08;
    return comp('stage-timeline', { variant: 'aggregate', state: stages.some((s) => stStatus(s) === 'over') ? 'over' : 'on-budget', cls: 'e-stl', attrs: { role: 'list', 'aria-label': 'Stage timeline' } },
      stages.map((s) => {
        const st = stStatus(s);
        const sel = o.selected === s.id;
        return html`<button type="button" class="e-stl__row e-stl__row--${st}${sel ? ' is-sel' : ''}" role="listitem" data-state="${st}" ${act('pf.stage', { id: s.id })} title="${s.label}: p50 ${s.p50 != null ? s.p50 : '–'} ${s.unit || 's'} · p95 ${s.p95 != null ? s.p95 : '–'} ${s.unit || 's'} · budget ${s.budget} ${s.unit || 's'}">
          <span class="e-stl__label">${s.label}</span>
          <span class="e-stl__track">${s.p95 != null ? html`<span class="e-stl__fill" style="width:${((s.p95 / max) * 100).toFixed(1)}%"></span>` : ''}<span class="e-stl__budget" style="left:${((s.budget / max) * 100).toFixed(1)}%" aria-hidden="true"></span></span>
          <span class="e-stl__val np-tnum">${s.p95 != null ? s.p95 + ' ' + (s.unit || 's') : '–'} / ${s.budget}</span>
          <span class="e-stl__st">${st === 'over' ? icon('error', { size: 13, label: 'Over budget' }) : st === 'near' ? icon('warning', { size: 13, label: 'Near budget' }) : ''}</span>
        </button>`;
      }));
  };

  /* ---------------- 48. Bottleneck row ----------------
     bottleneckRow(b, {variant:'over'|'near'|'informational'}) */
  C.bottleneckRow = (b, o) => {
    o = o || {};
    const variant = o.variant || b.status || 'over';
    const ic = { over: 'error', near: 'warning', informational: 'info' }[variant];
    return comp('bottleneck-row', { variant, state: 'default', cls: 'e-bn e-bn--' + variant },
      html`<span class="e-bn__icon">${icon(ic, { size: 14 })}</span>
      <div class="e-bn__main">
        <div class="e-bn__title">${variant !== 'informational' ? html`<span class="e-bn__word">${variant === 'over' ? 'Over' : 'Near'}</span>` : ''}${b.title}</div>
        <div class="e-bn__meta">${b.where}</div>
        <div class="e-bn__expl">${b.explanation}</div>
        <div class="e-bn__ex">Examples: ${b.examples.map((e, i) => html`${i ? ' · ' : ''}${P.link(e.label, { action: ['nav.go', { screen: 'performance', params: { callId: e.callId } }] })}`)}</div>
        <div class="e-bn__sugg">${icon('wand', { size: 12 })} ${b.suggestion}</div>
      </div>`);
  };
})();
