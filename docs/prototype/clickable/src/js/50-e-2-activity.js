/* =====================================================================
   Group E — Screen — Activity (cpt-noter-component-screen-activity)
   Regions AC-R1 … AC-R5; paths cpt-noter-seq-activity-review-proposals,
   cpt-noter-seq-activity-undo-batch.
   ===================================================================== */
(function () {
  const { html, raw, act, comp, icon, P, C, data: D, state } = NP;

  /* Day log for Activity: the change log (NP.data.changes) rendered with group C's change-row.
     Extra example records shown only here: */
  D.activityExtra = [
    { id: 'ax-1', day: 'Today', at: '10:21', actor: 'You', what: 'Pinned “Anna delivers the drawer redesign by Friday”', target: 'Planning: VHI 8.0 drawer redesign · 00:19:58', kind: 'pin', open: ['item.inspect', { id: 'i-spec' }] },
    { id: 'ax-2', day: 'Yesterday', at: '23:40', actor: 'Evidence job', what: 'Closed “Virtualise the 10k-row table in the drawer list”', target: 'Closed: PR #448 merged on 14 Oct', kind: 'evidence', open: ['item.inspect', { id: 'i-virt' }] },
    { id: 'ax-3', day: 'Tue 14 Oct', at: '18:31', actor: 'Codex', what: 'Wrote role reviews for 3 agents', target: 'Design review: notifications panel · Codex · gpt-5-codex · $0.34', kind: 'model' },
  ];
  const actorKind = (c) => (c.actor === 'You' ? 'you' : /job/i.test(c.actor) ? 'jobs' : (c.actor === 'Noter' || c.kind === 'outputs' || c.kind === 'model') ? 'models' : 'you');
  const OPEN = { 'ch-1': ['nav.go', { screen: 'call-page', params: { callId: 'c-live' } }], 'ch-2': ['item.inspect', { id: 'i-virt' }], 'ch-3': ['nav.go', { screen: 'call-page', params: { callId: 'c-live' } }], 'ch-5': ['item.inspect', { id: 'i-tokens' }], 'ch-6': ['nav.go', { screen: 'call-page', params: { callId: 'c-backend' } }], 'ch-7': ['nav.go', { screen: 'person', params: { id: 'p-anna' } }] };
  const BEFORE = { 'ch-6': ['Speaker 2: Реплей буфер я добавлю.', 'Dmitri S.: Реплей буфер я добавлю.'] };

  const AC = () => NP.eloc('activity', { decided: {}, expanded: {}, filter: 'all', outcome: {}, rowState: {}, undone: {}, kept: false, batchOpen: {} });

  const attention = (ctx) => {
    const fixed = NP.local('e-status', {});
    const rows = [];
    if (ctx.demo === 'job-failed') rows.push({ id: 'att-jira', name: 'Evidence check failed: Jira not reachable', status: 'error', statusWord: 'Failed', subtitle: 'job: evidence · last run 03:05', actorKind: 'jobs', actions: [{ label: 'Try Again', action: ['st.retry', { id: 'att-jira' }] }, { label: 'Open Settings', action: ['settings.open', { pane: 'maintenance' }] }] });
    rows.push({ id: 'att-conf', name: 'Confluence DEV sync failed · token expired 02:14', status: 'error', statusWord: 'Failed', subtitle: 'Knowledge source · 1,180 pages · last sync yesterday 02:14', tag: 'Indexed', actorKind: 'jobs', actions: [{ label: 'Try Again', action: ['st.retry', { id: 'att-conf' }] }, { label: 'Open Settings', action: ['settings.open', { pane: 'knowledge' }] }] });
    rows.push({ id: 'att-backup', name: 'Backup failed: backup disk not connected', status: 'error', statusWord: 'Failed', subtitle: 'job: backup · last run yesterday 23:00', actorKind: 'jobs', actions: [{ label: 'Try Again', action: ['st.retry', { id: 'att-backup' }] }, { label: 'Open Settings', action: ['settings.open', { pane: 'maintenance' }] }] });
    return rows.filter((r) => !(fixed[r.id] && fixed[r.id].fixed));
  };

  const changeRows = (ctx, L, filter) => {
    if (ctx.demo === 'log-unreadable' && !L.logRetried) {
      return C.inlineBanner({ id: 'ac-log', severity: 'error', text: 'Couldn\u2019t read the change log', actions: [{ label: 'Try Again', action: ['act.logRetry'] }] });
    }
    if (ctx.demo === 'nothing-changed') return C.emptyState({ variant: 'first-use', icon: 'history', title: 'Nothing has changed yet', body: 'Changes from your calls, jobs and models appear here, each with Undo.' });
    // accepted / rejected proposals older than 10 s join the day log
    const decidedRows = Object.keys(L.decided).filter((id) => L.decided[id].outcome !== 'dismissed' && L.decided[id].at && Date.now() - L.decided[id].at >= 10000).map((id) => {
      const p = D.proposals.find((x) => x.id === id); const det = D.proposalDetail[id] || {};
      return { id: 'dec-' + id, day: 'Today', at: new Date(L.decided[id].at).toTimeString().slice(0, 5), actor: 'You', what: (L.decided[id].outcome === 'accepted' ? 'Accepted: ' : 'Rejected: ') + (det.title || p.title), target: p.reason, kind: 'review' };
    });
    const order = ['Today', 'Yesterday', 'Tue 14 Oct'];
    let log = decidedRows.concat(D.changes.map((c) => Object.assign({}, c, OPEN[c.id] ? { open: OPEN[c.id] } : {}, BEFORE[c.id] ? { before: BEFORE[c.id][0], after: BEFORE[c.id][1] } : {})), D.activityExtra)
      .sort((a, b) => (order.indexOf(a.day) - order.indexOf(b.day)) || b.at.localeCompare(a.at));
    if (filter === 'proposals') log = log.filter((c) => c.id.startsWith('dec-'));
    else if (filter !== 'all') log = log.filter((c) => actorKind(c) === filter);
    if (ctx.demo === 'filter-empty' && filter === 'models') log = [];
    if (!log.length) {
      const word = { proposals: 'decisions on proposals', jobs: 'job changes', models: 'model changes', you: 'changes by you' }[filter] || 'changes';
      return C.emptyState({ variant: 'section', title: `No ${word} in this period.` });
    }
    const days = [];
    log.forEach((c) => { let g = days.find((d) => d.day === c.day); if (!g) days.push(g = { day: c.day, rows: [] }); g.rows.push(c); });
    return days.map((g) => html`<div class="ac-day"><h3 class="ac-day__h">${g.day}</h3><ul class="ac-list">${g.rows.map((c) => NP.c('changeRow', c, { key: c.id, where: 'activity' }))}</ul></div>`);
  };

  NP.screen('activity', {
    section: 'activity',
    title: 'Activity',
    subtitle: 'What Noter changed, proposes and waits for',
    toolbarCenter: (ctx) => P.segmented([{ value: 'all', label: 'All' }, { value: 'proposals', label: 'Proposals' }, { value: 'jobs', label: 'Jobs' }, { value: 'models', label: 'Models' }, { value: 'you', label: 'You' }], AC().filter, { label: 'Filter by actor', action: ['act.filter'] }),
    toolbarActions: () => P.button('Export Log…', { icon: 'export', action: ['act.exportLog'] }),
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'nothing-waiting', label: 'Nothing waiting' },
      { id: 'nothing-changed', label: 'Nothing has changed yet' },
      { id: 'filter-empty', label: 'Filter shows nothing (Models)' },
      { id: 'log-unreadable', label: 'Change log unreadable' },
      { id: 'job-failed', label: 'Job failed (Jira not reachable)' },
      { id: 'applying', label: 'Applying a proposal' },
      { id: 'couldnt-apply', label: 'Couldn’t apply' },
      { id: 'item-changed', label: 'Item changed since' },
      { id: 'batch-undone', label: 'Batch undone (undo strip)' },
      { id: 'partial-undo', label: 'Some changes edited later' },
      { id: 'strip-gone', label: 'Undo strip already gone' },
      { id: 'loading', label: 'Loading' },
    ],
    onDemo: (id) => {
      const L = AC();
      Object.assign(L, { decided: {}, expanded: {}, rowState: {}, showKept: false, logRetried: false, retried: false, filter: id === 'filter-empty' ? 'models' : 'all' });
      NP.local('e-status', {}); Object.keys(state.local['e-status']).forEach((k) => delete state.local['e-status'][k]);
      if (state.undo && state.undo.where === 'activity') state.undo = null;
      if (id === 'nothing-waiting') D.proposals.forEach((p) => { L.decided[p.id] = { outcome: 'accepted', at: 0 }; });
      if (id === 'applying') L.rowState['pr-2'] = 'applying';
      if (id === 'item-changed') { L.rowState['pr-1'] = 'out-of-date'; L.expanded['pr-1'] = true; }
      if (id === 'couldnt-apply') L.rowState['pr-1'] = 'failed';
      const ci = NP.local('c-items', {}); ci.undone = ci.undone || {}; ci.undone['ch-4'] = false;
      if (id === 'batch-undone') { ci.undone['ch-4'] = true; NP.undo('Undone 37 changes', { context: 'reconciliation batch from last night, term “shaman”', label: 'Redo', action: 'chg.redo', args: { id: 'ch-4' }, where: 'activity', ms: 600000 }); }
      if (id === 'partial-undo') { ci.undone['ch-4'] = true; NP.undo('Undone 35 of 37 · 2 kept because you edited them later', { context: 'reconciliation batch from last night, term “shaman”', label: 'Show', action: 'act.showKept', where: 'activity', ms: 600000 }); }
      if (id === 'strip-gone') { ci.undone['ch-4'] = true; L.filter = 'jobs'; }
    },
    render: (ctx) => {
      const L = AC();
      if (ctx.demo === 'loading') return html`<div class="ac-wrap">${[1, 2, 3, 4, 5].map(() => raw('<div class="e-skel"></div>'))}</div>`;
      const filter = L.filter;
      const att = attention(ctx).filter((r) => filter === 'all' || filter === 'jobs');
      const waiting = D.proposals.filter((p) => !L.decided[p.id] || (L.decided[p.id].outcome !== 'dismissed' && Date.now() - L.decided[p.id].at < 10000));
      const waitingCount = D.proposals.filter((p) => !L.decided[p.id]).length;
      const showProposals = filter === 'all' || filter === 'proposals';
      return html`<div class="ac-wrap">
        ${NP.region('AC-R2', { cls: 'ac-undo', label: 'Undo' }, C.undoStrip({ where: 'activity', sticky: true }))}
        ${L.showKept ? html`<div class="ac-kept"><div class="t-headline">Kept because you edited them later · 2</div>
          <div class="e-prop__span"><div class="e-prop__where">Backend sync · 2 Oct · 00:18:20</div><div>shaman <span class="np-dim">· you wrote “the shaman agent, not the service” on 3 Oct</span></div></div>
          <div class="e-prop__span"><div class="e-prop__where">OpenStack upgrade planning · 1 Oct · 00:40:11</div><div>Shaman <span class="np-dim">· you capitalised it on 3 Oct</span></div></div>
          ${P.button('Close', { size: 'small', action: ['act.hideKept'] })}</div>` : ''}
        ${NP.flashed('ac-rule') ? html`<div>${C.inlineStatus(NP.flashed('ac-rule'), { variant: 'trailing' })}</div>` : ''}
        ${att.length ? NP.region('AC-R3', { cls: 'ac-sec', label: 'Needs attention' }, html`<h2 class="np-section-h">Needs attention · ${att.length}</h2><div class="e-list">${att.map((r) => C.statusRow(r, { variant: r.id === 'att-conf' ? 'source' : 'job', where: 'activity' }))}</div>`) : ''}
        ${showProposals ? NP.region('AC-R4', { cls: 'ac-sec', label: 'Waiting for you' }, html`<h2 class="np-section-h">Waiting for you · ${waitingCount}<span class="ac-legend">${P.kbd('A')} Accept · ${P.kbd('R')} Reject · ${P.kbd('T')} Always for This Term · ${P.kbd('↩')} details</span></h2>
          ${waiting.length ? html`<div class="e-list">${waiting.map((p) => C.proposalRow(p, { variant: 'full', where: 'activity' }))}</div>` : C.emptyState({ variant: 'section', title: 'Nothing waiting. Noter asks before it changes older records.' })}`) : ''}
        ${NP.region('AC-R5', { cls: 'ac-sec', label: 'Changes' }, changeRows(ctx, L, filter))}
      </div>`;
    },
  });

  NP.on('act.filter', (a) => { AC().filter = a.value; });
  NP.on('act.logRetry', () => { AC().logRetried = true; });
  NP.on('act.showKept', () => { AC().showKept = true; });
  NP.on('act.hideKept', () => { AC().showKept = false; });

  /* Export Log… opens group C's sheet (Screen — Dialogs) */
  NP.on('act.exportLog', () => { if (NP.overlays['dlg-export-log']) NP.openSheet('dlg-export-log', { scope: 'all changes' }); else NP.flash('proto', 'Export Log sheet lives in the dialogs module'); return false; });
})();
