/* =====================================================================
   Group E — Screen — Agents (cpt-noter-component-screen-agents)
   AG-R1 … AG-R4; paths cpt-noter-seq-agents-add-agent, cpt-noter-seq-agents-tune-council.
   ===================================================================== */
(function () {
  const { html, raw, act, comp, icon, P, C, data: D, state } = NP;

  // Built-in vs added (example classification for the prototype)
  const ADDED = { 'ag-security': true, 'ag-devils': true };
  D.agents.forEach((a) => { if (a.builtIn == null) a.builtIn = !ADDED[a.id]; });
  const pmAgent = D.agents.find((a) => a.id === 'ag-pm');

  const AG = () => NP.eloc('agents', { selected: 'council', view: 'settings', enabled: {}, turnedOn: {}, order: null, added: [] });
  const all = () => {
    const L = AG();
    const list = D.agents.concat(L.added);
    if (!L.order) L.order = list.map((a) => a.id);
    list.forEach((a) => { if (!L.order.includes(a.id)) L.order.push(a.id); });
    return L.order.map((id) => list.find((a) => a.id === id)).filter(Boolean);
  };
  const skillVersions = [{ id: 'v-builtin', label: 'Built-in · 1.4' }, { id: 'v-1', label: 'Your edit · 12 Oct' }, { id: 'v-2', label: 'Your edit · 15 Oct' }];
  const skillText = (a) => `# ${a.name}\n\nYou are the ${a.name.toLowerCase()} on a council that listens to a software team's calls.\n\n## Stance\nReads for boundaries, coupling, versioning and what breaks when a component changes.\n\n## Raise a card when\n- a decision changes a public interface or a data format\n- two people describe the same component differently\n- nobody owns a migration\n\n## Never\n- read more than two sentences aloud\n- repeat a card shown in the last 10 minutes`;

  const editorPane = (ctx, a) => {
    const L = AG();
    const live = ctx.demo === 'live-call' || state.rec.status === 'recording';
    const view = L.view;
    const banners = [];
    if (live) banners.push(C.inlineBanner({ severity: 'info', text: 'Changes apply within a minute', dismissible: false }));
    if (ctx.demo === 'skill-missing' && view === 'skill' && !L.restored) banners.push(C.inlineBanner({ severity: 'error', text: 'The skill file is missing', actions: [{ label: 'Restore from Built-In', action: ['ag.restore'] }, { label: 'Choose File…', action: ['proto.flash', { key: 'proto', text: 'Open panel for a .md skill file' }] }] }));
    if (L.resetFor === a.id && view === 'skill') banners.push(C.inlineBanner({ severity: 'success', text: `${a.name} skill reset to built-in`, actions: [{ label: 'Undo', action: ['ag.undoReset'] }], dismissible: false }));
    const removeBtn = a.builtIn ? P.button('Remove Agent…', { disabled: true, help: 'Built-in agents can be disabled but not removed' }) : P.button('Remove Agent…', { variant: 'secondary', cls: 'np-btn--destructive', action: ['ag.remove', { id: a.id, name: a.name }] });
    return html`<div class="ag-editor">
      <header class="ag-editor__head"><h2 class="t-title3">${a.name}</h2>${a.builtIn ? P.badge('Built in', { kind: 'kind' }) : P.badge('Added by you', { kind: 'kind' })}<span class="np-tb__spacer"></span>
        ${P.segmented([{ value: 'settings', label: 'Settings' }, { value: 'skill', label: 'Skill' }], view, { label: 'Editor view', action: ['ag.view'] })}${removeBtn}</header>
      ${banners.length ? html`<div class="ag-banners">${banners}</div>` : ''}
      ${view === 'settings' ? C.agentEditor(a, { live }) : html`<div class="ag-skill">
        <div class="ag-skill__bar">${NP.c('versionSwitcher', { versions: skillVersions, current: L.resetFor === a.id ? 'v-builtin' : 'v-2', key: 'ag-skill-' + a.id })}<span class="np-mono np-dim">${a.skill}</span><span class="np-tb__spacer"></span>${a.builtIn ? P.button('Reset to Built-In', { size: 'small', action: ['ag.reset', { id: a.id }] }) : ''}</div>
        ${ctx.demo === 'skill-missing' && !L.restored ? C.emptyState({ variant: 'section', title: 'No skill text to show.' }) : NP.c('promptEditor', { value: skillText(a), variant: 'editable', key: 'ag-skill-' + a.id })}
        ${a.builtIn && L.resetFor !== a.id ? html`<h3 class="np-section-h ag-skill__h">Your edit against the built-in skill</h3>${NP.c('diffView', { before: 'Reads for boundaries, coupling and versioning.', after: 'Reads for boundaries, coupling, versioning and what breaks when a component changes.', variant: 'inline' })}` : ''}
      </div>`}
    </div>`;
  };

  const councilPane = (ctx) => {
    const L = AG();
    const live = ctx.demo === 'live-call' || state.rec.status === 'recording';
    return html`<div class="ag-editor">
      <header class="ag-editor__head"><h2 class="t-title3">Council</h2><span class="np-dim">Mode per call type, live and after the call</span></header>
      ${live ? C.inlineBanner({ severity: 'info', text: 'Changes apply within a minute', dismissible: false }) : ''}
      ${C.councilModeTable()}
      <div class="e-form__row"><div class="e-form__label">Budget per call</div><div class="e-form__ctl">${P.textField({ id: 'ag-budget-call', value: L.budget || '$1.00', bind: 'local.agents.budget', ariaLabel: 'Budget per call', cls: 'ag-money' })}<div class="e-form__note">The copilot pauses at the cap and says so on the call screen.</div></div></div>
      <p class="np-dim">In parallel mode a slow agent misses the tick, so the tick is never delayed.</p>
    </div>`;
  };

  NP.screen('agents', {
    section: 'agents',
    title: 'Agents',
    subtitle: () => `${all().length} agents · fused live, parallel after the call`,
    toolbarActions: () => P.pulldown('Add Agent', [{ label: 'Security Reviewer', action: ['ag.add', { tpl: 'Security reviewer' }] }, { label: 'QA', action: ['ag.add', { tpl: 'QA' }] }, { label: 'Customer', action: ['ag.add', { tpl: 'Customer' }] }, { label: 'Finance', action: ['ag.add', { tpl: 'Finance' }] }, { divider: true }, { label: 'Blank', action: ['ag.add', { tpl: 'New agent' }] }], { anchorId: 'ag-add', icon: 'plus' }),
    search: false,
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'agent', label: 'Agent selected · Settings' },
      { id: 'skill', label: 'Agent selected · Skill with diff' },
      { id: 'new-agent', label: 'New agent added' },
      { id: 'budget-over', label: 'Budget shares over 100 %' },
      { id: 'runtime', label: 'Runtime unavailable' },
      { id: 'switched-off', label: 'Agent switched itself off' },
      { id: 'skill-missing', label: 'Skill file missing' },
      { id: 'live-call', label: 'During a live call' },
      { id: 'loading', label: 'Loading' },
    ],
    onDemo: (id) => {
      const L = AG();
      Object.assign(L, { view: 'settings', restored: false, resetFor: null, filterType: null });
      pmAgent.switchedOff = id === 'switched-off'; L.turnedOn = {};
      if (id === 'default' || id === 'live-call') L.selected = 'council';
      if (id === 'agent' || id === 'budget-over') L.selected = 'ag-architect';
      if (id === 'skill' || id === 'skill-missing') { L.selected = 'ag-architect'; L.view = 'skill'; }
      if (id === 'runtime') L.selected = 'ag-devils';
      if (id === 'switched-off') L.selected = 'ag-pm';
      if (id === 'live-call') L.selected = 'ag-architect';
      if (id === 'budget-over') { delete L['f-ag-architect']; C.agentEditor(D.agents[0]); L['f-ag-architect'].budget = 37; }
      if (id === 'new-agent' && !L.added.length) NP.actions['ag.add']({ tpl: 'Security reviewer' });
    },
    render: (ctx) => {
      const L = AG();
      if (ctx.demo === 'loading') return html`<div class="ag-split"><div class="ag-list">${[1, 2, 3, 4, 5].map(() => raw('<div class="e-skel"></div>'))}</div><div></div></div>`;
      const agents = all();
      const filtered = L.filterType ? agents.filter((a) => (a.callTypes || []).some((t) => t === L.filterType || t === 'All') || a.isNew) : agents;
      const built = filtered.filter((a) => a.builtIn);
      const added = filtered.filter((a) => !a.builtIn);
      const sel = agents.find((a) => a.id === L.selected);
      return html`${C.undoStrip({ where: 'agents' })}<div class="ag-split">
        ${NP.region('AG-R2', { cls: 'ag-list', label: 'Agents' }, html`
          <button type="button" class="ag-council${L.selected === 'council' ? ' is-sel' : ''}" ${act('ag.select', { id: 'council' })} aria-pressed="${String(L.selected === 'council')}">${icon('gear', { size: 15 })}<span>Council</span><span class="np-dim">Mode per call type</span></button>
          ${L.filterType ? html`<div class="ag-filter">Agents on ${L.filterType} calls ${P.button('Show All', { size: 'small', variant: 'quiet', action: ['ag.filterType', { type: L.filterType }] })}</div>` : ''}
          <div class="ag-group"><div class="ag-group__h">Built in</div><div class="ag-group__cap">Order breaks ties in ranking</div>
            <div role="listbox" aria-label="Built-in agents">${built.map((a) => C.agentListRow(a))}</div></div>
          ${added.length ? html`<div class="ag-group"><div class="ag-group__h">Added by you</div><div role="listbox" aria-label="Agents added by you">${added.map((a) => C.agentListRow(a))}</div></div>` : ''}
          ${NP.flashed('ag-status') ? C.inlineStatus(NP.flashed('ag-status'), { variant: 'trailing' }) : ''}
          ${NP.region('AG-R4', { tag: 'p', cls: 'ag-foot', label: 'About the percentages' }, 'Percentages: cards rated useful or used over the last 20 calls. An agent dismissed in a call type for ten calls switches itself off there.')}
        `)}
        ${NP.region('AG-R3', { cls: 'ag-pane', label: 'Editor' }, sel ? editorPane(ctx, sel) : councilPane(ctx))}
      </div>`;
    },
  });

  NP.on('ag.view', (a) => { AG().view = a.value; });
  NP.on('ag.add', (a) => {
    const L = AG();
    const id = 'ag-new-' + (L.added.length + 1);
    const name = a.tpl === 'QA' ? 'QA reviewer' : a.tpl;
    L.added.push({ id, name, runtime: 'Claude Code', model: 'Sonnet', effort: 'Low', enabled: false, callTypes: ['Planning'], budget: 0, status: 'ok', skill: name.toLowerCase().replace(/\W+/g, '-') + '.md', cards7d: 0, useful: 0, builtIn: false, isNew: true });
    /* "Offer your … account first when adding an agent" (sign-in sheet) picks the new agent's runtime */
    const au = state.auth || {};
    const firstAcct = ['claude', 'chatgpt'].find((p) => au[p] && au[p].defaultForNew && au[p].status === 'signed-in');
    if (firstAcct && state.agentRuntime) state.agentRuntime[id] = firstAcct === 'claude' ? 'claude-account' : 'codex-account';
    L.selected = id; L.view = 'settings';
    L.enabled[id] = false;
    setTimeout(() => { const el = document.getElementById('ag-name-' + id); if (el) el.focus(); }, 80);
  });
  NP.on('ag.remove', (a) => NP.openAlert({ title: `Remove “${a.name}”?`, body: 'Its skill file moves to the Trash. Past cards and reviews keep its name.', variant: 'destructive', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Remove', variant: 'destructive', action: 'ag.removeConfirm', args: { id: a.id } }] }));
  NP.on('ag.removeConfirm', (a) => {
    const L = AG();
    L.added = L.added.filter((x) => x.id !== a.id);
    const i = D.agents.findIndex((x) => x.id === a.id); if (i >= 0 && !D.agents[i].builtIn) D.agents.splice(i, 1);
    L.order = null; L.selected = 'council'; state.alert = null;
  });
  NP.on('ag.reset', (a) => { AG().resetFor = a.id; });
  NP.on('ag.undoReset', () => { AG().resetFor = null; });
  NP.on('ag.restore', () => { AG().restored = true; });
})();
