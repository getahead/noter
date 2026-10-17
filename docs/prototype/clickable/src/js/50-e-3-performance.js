/* =====================================================================
   Group E — Screen — Performance (cpt-noter-component-screen-performance)
   PF-R1 … PF-R5 and the pushed Call performance page (params.callId).
   Targets come from PRD › Success metrics and PRD › Live copilot › Latency budget;
   stage budgets from the PRD's “Where the time goes” table.
   ===================================================================== */
(function () {
  const { html, raw, act, comp, icon, P, C, data: D, state } = NP;

  D.perfTiles = [
    { id: 'hyp', name: 'Hypothesis lag', value: '1.4 s', target: '≤ 2 s', p50: '0.9 s', status: 'ok', trend: [1.7, 1.6, 1.6, 1.5, 1.6, 1.4, 1.5, 1.4, 1.3, 1.4], trendWord: 'Trend: improving', stages: ['confirmed'] },
    { id: 'answer', name: 'Answer card', value: '9.8 s', target: '≤ 9 s', p50: '5.4 s', status: 'over', trend: [8.1, 8.4, 8.0, 8.9, 9.2, 9.0, 9.6, 9.4, 9.9, 9.8], trendWord: 'Trend: worsening', stages: ['first-token', 'cards'] },
    { id: 'confirmed', name: 'Confirmed text lag', value: '3.6 s', target: '≤ 4 s', p50: '2.7 s', status: 'near', trend: [3.2, 3.3, 3.5, 3.4, 3.6, 3.5, 3.7, 3.6, 3.6, 3.6], trendWord: 'Trend: unchanged', stages: ['confirmed'] },
    { id: 'post', name: 'Outputs ready, cloud', value: '58 s', target: '≤ 2 min', p50: '41 s', status: 'ok', trend: [70, 66, 61, 64, 60, 59, 57, 60, 58, 58], trendWord: 'Trend: improving', stages: [] },
    { id: 'capture', name: 'Calls without dropouts', value: '100 %', target: '≥ 99 %', status: 'ok', rate: true, blocker: true, trend: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100], trendWord: 'Trend: unchanged', stages: [] },
    { id: 'privacy', name: 'Cloud requests logged', value: '100 %', target: '100 %', status: 'ok', rate: true, blocker: true, trend: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100], trendWord: 'Trend: unchanged', stages: [] },
  ];
  D.perfStages = [
    { id: 'confirmed', label: 'Confirmed text', p95: 2.3, p50: 1.9, budget: 2.5 },
    { id: 'signals', label: 'Signals', p95: 0.3, p50: 0.2, budget: 0.3 },
    { id: 'retrieval', label: 'Retrieval', p95: 0.09, p50: 0.05, budget: 0.1 },
    { id: 'first-token', label: 'Claude first token', p95: 4.4, p50: 1.6, budget: 1.5 },
    { id: 'cards', label: 'Cards streamed and validated', p95: 1.1, p50: 0.8, budget: 1.0 },
    { id: 'merge', label: 'Merge across agents', p95: 0.08, p50: 0.05, budget: 0.1 },
  ];
  D.perfBottlenecks = [
    { id: 'b1', status: 'over', stage: 'first-token', metric: 'answer', title: 'Claude first token after session reset', where: 'Copilot · LLM tick · 7 of 11 calls', explanation: 'The live session restarts after 30 minutes of a long call, and the first tick after a restart waits 3 to 4 s for a cold start.', examples: [{ callId: 'c-live', label: '16 Oct · Planning: VHI 8.0 drawer redesign' }, { callId: 'c-backend', label: '2 Oct · Backend sync' }], suggestion: 'Keep the session warm with a ping every 20 minutes, or start the next session before the old one ends.' },
    { id: 'b2', status: 'near', stage: 'cards', metric: 'answer', title: 'Post-call parallel reviews on long calls', where: 'Post-call · role reviews · 3 of 11 calls', explanation: 'Calls longer than 50 minutes send the full transcript to six agents at once; the slowest agent decides when outputs are ready.', examples: [{ callId: 'c-openstack', label: '1 Oct · OpenStack upgrade planning' }], suggestion: 'Send each agent the summary and its own spans instead of the full transcript.' },
    { id: 'b3', status: 'near', stage: 'confirmed', metric: 'confirmed', title: 'Confirmed text on mixed Russian and German speech', where: 'Engine · live ASR · 4 of 11 calls', explanation: 'Language switches inside one utterance hold confirmation until the next pause.', examples: [{ callId: 'c-qa', label: '6 Oct · Cross-team QA sync' }], suggestion: 'Confirm on the hypothesis stream after 2 s of stable text.' },
    { id: 'b4', status: 'informational', stage: 'retrieval', metric: null, title: 'Retrieval with the Confluence source', where: 'Copilot · retrieval · all calls', explanation: 'Within budget, but 60 % of retrieval time is the Confluence section filter.', examples: [{ callId: 'c-design', label: '8 Oct · Design review: notifications panel' }], suggestion: 'Precompute the section filter during the nightly index.' },
  ];
  D.perfTicks = [
    { n: 14, t: '00:19:58', trigger: 'Commitment', total: '5.2 s', stages: [1.9, 0.3, 0.1, 1.6, 1.2, 0.1], card: 'Pin · pinned', over: false },
    { n: 15, t: '00:21:00', trigger: 'Hotkey', total: '4.1 s', stages: [1.6, 0.2, 0.1, 1.3, 0.8, 0.1], card: 'Catch-up · used', over: false },
    { n: 16, t: '00:21:40', trigger: 'Question', total: '9.8 s', stages: [2.3, 0.3, 0.1, 4.4, 2.6, 0.1], card: 'Answer · shown late', over: true },
    { n: 17, t: '00:23:40', trigger: 'Topic shift', total: '6.0 s', stages: [2.1, 0.3, 0.1, 2.0, 1.4, 0.1], card: 'Context · dismissed', over: false },
    { n: 18, t: '00:27:15', trigger: 'Decision', total: '5.5 s', stages: [2.0, 0.3, 0.1, 1.7, 1.3, 0.1], card: 'Context · shown', over: false },
    { n: 19, t: '00:31:12', trigger: 'Question', total: '12.4 s', stages: [2.4, 0.3, 0.1, 6.1, 3.4, 0.1], card: 'Dropped · over 12 s', over: true },
  ];

  const L = () => NP.eloc('performance', { period: '7d', type: 'all', tile: null, stage: null, overOnly: false });

  const brief = '# Bring the answer card back under 9 s\n\nGoal: answer cards reach the user within 9 s at p95 (now 9.8 s over 7 days).\n\nEvidence\n- Claude first token: 4.4 s p95 against a budget of 1.5 s, worst right after a session reset (7 of 11 calls).\n- Cards streamed and validated: 1.1 s against 1.0 s.\n\nAsk\n1. Keep the live Claude Code session warm during long calls.\n2. Start partial display as soon as the first card line validates.\n\nFiles: apps/core/src/copilot/session.rs, apps/core/src/copilot/stream.rs';

  const callPerf = (ctx) => {
    const l = L();
    const call = D.call(ctx.params.callId);
    let ticks = D.perfTicks;
    if (l.overOnly) ticks = ticks.filter((t) => t.over);
    if (ctx.demo === 'no-late-ticks' && l.overOnly) ticks = [];
    return html`<div class="pf-wrap">
      <div class="pf-cp-head">${P.checkbox('Over budget only', l.overOnly, { id: 'pf-over-only', bind: 'local.performance.overOnly' })}</div>
      ${ticks.length ? P.table({ variant: 'sortable', label: 'Copilot ticks in this call' }, html`<thead><tr>${P.th('Tick')}${P.th('Time')}${P.th('Trigger')}${P.th('Total')}${P.th('Stages', { width: '34%' })}${P.th('Card')}</tr></thead>
        <tbody>${ticks.map((t) => html`<tr class="${t.over ? 'pf-tick--over' : ''}"><td class="np-tnum">${t.n}</td><td class="np-tnum">${t.t}</td><td>${t.trigger}</td><td class="np-tnum">${t.total}</td>
          <td>${C.stageTimeline({ variant: 'mini', stages: D.perfStages.map((s, i) => Object.assign({}, s, { p95: t.stages[i] })) })}${t.over ? html` <span class="pf-overword">${icon('error', { size: 12 })} over budget</span>` : ''}</td><td>${t.card}</td></tr>`)}</tbody>`)
        : C.emptyState({ variant: 'filtered', title: 'No ticks over budget in this call', actionLabel: 'Show All Ticks', action: ['pf.showAll'] })}
      <p class="np-dim">${call.title} · ${call.date} · ${call.length} · ${D.perfTicks.length} ticks with a card or a drop.</p>
    </div>`;
  };

  NP.screen('performance', {
    section: 'performance',
    title: (ctx) => (ctx.params.callId ? D.call(ctx.params.callId).title : 'Performance'),
    subtitle: (ctx) => (ctx.params.callId ? `${D.call(ctx.params.callId).date} · ${D.call(ctx.params.callId).length} · Call performance` : 'MacBook Pro M5 · 24 GB · macOS 15'),
    toolbarCenter: (ctx) => (ctx.params.callId ? '' : P.segmented([{ value: 'last', label: 'Last Call' }, { value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' }], L().period, { label: 'Period', action: ['pf.period'] })),
    toolbarActions: (ctx) => (ctx.params.callId
      ? P.button('Open Call', { action: ['nav.go', { screen: 'call-page', params: { callId: ctx.params.callId } }] })
      : html`${P.popup([{ value: 'all', label: 'All calls · 11' }, { value: 'planning', label: 'Planning · 4' }, { value: '1on1', label: '1:1 · 3' }, { value: 'sync', label: 'Backend sync · 2' }], L().type, { label: 'Call type', variant: 'toolbar', bind: 'local.performance.type' })}${P.button('Export Improvement Brief…', { action: ['pf.export'] })}`),
    search: false,
    banners: (ctx) => (ctx.demo === 'rollup-failed' ? [{ id: 'pf-rollup', severity: 'error', text: 'Last night’s roll-up failed', actions: [{ label: 'Run Now', action: ['pf.rollup'] }] }] : []),
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'no-calls', label: 'No calls yet' },
      { id: 'not-enough', label: 'Not enough data' },
      { id: 'loading', label: 'Loading' },
      { id: 'rollup-failed', label: 'Roll-up failed' },
      { id: 'no-repo', label: 'Noter repository not mapped' },
      { id: 'brief-fails', label: 'Brief does not open' },
      { id: 'no-late-ticks', label: 'Call performance: no tick over budget' },
    ],
    onDemo: (id) => { const l = L(); l.tile = null; l.stage = null; l.overOnly = id === 'no-late-ticks'; if (id === 'no-late-ticks') NP.go('performance', { callId: 'c-backend' }, { replace: true }); },
    render: (ctx) => {
      if (ctx.params.callId) return callPerf(ctx);
      const l = L();
      if (ctx.demo === 'no-calls') return C.emptyState({ variant: 'large', icon: 'gauge', title: 'Performance appears after your first call.', body: 'Noter measures every stage of each call on this Mac and compares it with the targets in the PRD.' });
      if (ctx.demo === 'loading') return html`<div class="pf-tiles">${[1, 2, 3, 4, 5, 6].map(() => raw('<div class="e-skel e-skel--tile"></div>'))}</div>`;
      const tiles = D.perfTiles.map((t) => (ctx.demo === 'not-enough' && (t.id === 'post' || t.id === 'confirmed') ? Object.assign({}, t, { status: 'more-data', needed: 3 }) : t));
      const tile = tiles.find((t) => t.id === l.tile);
      let bns = D.perfBottlenecks;
      if (tile) bns = bns.filter((b) => b.metric === tile.id || tile.stages.includes(b.stage));
      if (l.stage) bns = bns.filter((b) => b.stage === l.stage);
      const copied = NP.flashed('pf-copy');
      return html`<div class="pf-wrap">
        ${NP.region('PF-R2', { cls: 'pf-sec', label: 'Targets' }, html`<h2 class="np-section-h">Targets · p95 over the period${tile ? html` <span class="np-dim">· filtered to ${tile.name}</span> ${P.button('Clear', { size: 'small', variant: 'quiet', action: ['pf.tile', { id: tile.id }] })}` : ''}</h2>
          <div class="pf-tiles">${tiles.map((t) => C.metricTile(t, { selected: l.tile === t.id }))}</div>`)}
        <div class="pf-mid">
          ${NP.region('PF-R3', { cls: 'pf-sec pf-card', label: 'Stage timeline' }, html`<h2 class="np-section-h">Stage timeline · copilot tick · p95 against budget</h2>${C.stageTimeline({ stages: D.perfStages, selected: l.stage })}<div class="pf-legend"><span class="pf-legend__b"></span> budget · <span class="pf-legend__h"></span> over budget</div>`)}
          ${NP.region('PF-R4', { cls: 'pf-sec pf-card', label: 'Bottlenecks' }, html`<h2 class="np-section-h">Bottlenecks · ranked by overrun${l.stage ? html` ${P.button('Show All', { size: 'small', variant: 'quiet', action: ['pf.stage', { id: l.stage }] })}` : ''}</h2>
            ${bns.length ? html`<div class="e-list">${bns.map((b) => C.bottleneckRow(b))}</div>` : C.emptyState({ variant: 'section', title: 'No bottleneck for this filter.' })}`)}
        </div>
        ${NP.region('PF-R5', { cls: 'pf-bottom', label: 'Quality, cost and brief' }, html`
          <div class="pf-card"><h2 class="np-section-h">Quality</h2><dl class="np-kv pf-kv">
            <dt>Words corrected</dt><dd class="np-tnum">41</dd><dt>Speaker relabels</dt><dd class="np-tnum">6</dd><dt>Language-ID flips</dt><dd class="np-tnum">3</dd><dt>Cards pinned per card shown</dt><dd class="np-tnum">0.24</dd><dt>Cards dismissed in under 3 s</dt><dd class="np-tnum">9 %</dd></dl></div>
          <div class="pf-card"><h2 class="np-section-h">Cost · 7 days</h2><dl class="np-kv pf-kv">
            <dt>Claude Code</dt><dd class="np-tnum">$4.12</dd><dt>Codex</dt><dd class="np-tnum">$1.06</dd><dt>Local share</dt><dd class="np-tnum">18 %</dd><dt>Total</dt><dd class="np-tnum"><b>$5.18</b></dd><dt>Per call</dt><dd class="np-tnum">$0.47 of $1.00 budget</dd></dl></div>
          <div class="pf-card pf-brief"><h2 class="np-section-h">Improvement brief · preview</h2>
            ${NP.c('promptEditor', { value: brief, variant: 'read-only', key: 'pf-brief' })}
            ${ctx.demo === 'no-repo' ? html`<div class="pf-line">${icon('warning', { size: 12 })} No repository mapped for Noter ${P.button('Add Mapping…', { size: 'small', action: ['settings.open', { pane: 'repositories' }] })}</div>` : ''}
            ${NP.flashed('pf-open-fail') ? html`<div class="pf-line pf-line--err">${icon('error', { size: 12 })} Couldn’t open Claude Code · use Copy as Prompt</div>` : ''}
            <div class="pf-brief__actions">${P.button('Preview', { size: 'small', action: ['pf.export'] })}${P.button('Copy as Prompt', { size: 'small', flashKey: 'pf-copy', action: ['pf.copy'] })}${P.button('Open in Claude Code', { size: 'small', disabled: ctx.demo === 'no-repo', action: ['pf.open', { tool: 'Claude Code' }] })}${P.button('Open in Codex', { size: 'small', disabled: ctx.demo === 'no-repo', action: ['pf.open', { tool: 'Codex' }] })}</div>
          </div>`)}
      </div>`;
    },
  });

  NP.on('pf.period', (a) => { L().period = a.value; });
  NP.on('pf.tile', (a) => { const l = L(); l.tile = l.tile === a.id ? null : a.id; l.stage = null; });
  NP.on('pf.stage', (a) => { const l = L(); l.stage = l.stage === a.id ? null : a.id; });
  NP.on('pf.showAll', () => { L().overOnly = false; });
  NP.on('pf.copy', () => { NP.flash('pf-copy', 'Copied', 2000); });
  NP.on('pf.rollup', () => { state.dismissed = state.dismissed || {}; state.dismissed['pf-rollup'] = true; NP.flash('proto', 'Roll-up runs now · Performance updates when it finishes', 2500); });
  NP.on('pf.open', (a) => {
    if (NP.demo('performance') === 'brief-fails') { NP.flash('pf-open-fail', 'fail', 6000); return; }
    NP.flash('proto', `Opens ${a.tool} in your usual terminal in ~/projects/noter with the brief filled in; nothing runs until you press Return.`, 3500);
  });
  NP.on('pf.export', () => { if (NP.overlays['dlg-brief']) NP.openSheet('dlg-brief', {}); else NP.flash('proto', 'Export Improvement Brief sheet lives in the dialogs module'); return false; });

})();
