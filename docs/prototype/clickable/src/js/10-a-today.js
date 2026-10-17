/* =====================================================================
   Screen — Today (cpt-noter-component-screen-today), DESIGN 3.2
   Regions TD-R1 (toolbar), TD-R2 (MW-R5 banner), TD-R8, TD-R3..TD-R7
   ===================================================================== */
(function () {
  const { html, raw, act, icon, P, C, data: D, state } = NP;

  const STATES = [
    { id: 'default', label: 'Normal' },
    { id: 'first-use', label: 'First use, nothing recorded' },
    { id: 'calendar-not-asked', label: 'Calendar not asked yet' },
    { id: 'calendar-denied', label: 'Calendar access denied' },
    { id: 'no-calls', label: 'No calls today' },
    { id: 'loading', label: 'Loading' },
    { id: 'calendar-failed', label: 'Calendar read failed' },
    { id: 'self-test', label: 'Self-test not passed' },
    { id: 'quit-recording', label: 'Noter quit during a recording' },
    { id: 'nothing-to-review', label: 'Nothing to review' },
    { id: 'live', label: 'Live call' },
    { id: 'unmatched-live', label: 'Live call with no calendar match' },
    { id: 'open-handoff', label: 'Open handoff' },
    { id: 'evidence-failed', label: 'Evidence check failed' },
  ];

  const decided = () => ((state.local.activity && state.local.activity.decided) || {});
  const isRec = () => state.rec.status === 'recording' || state.rec.status === 'paused';

  /* fallback proposal row when group E is absent */
  const proposalRow = (p) => {
    if (typeof C.proposalRow === 'function') return C.proposalRow(p, { variant: 'compact', key: 'today', where: 'today' });
    return NP.comp('proposal-row', { variant: 'compact', state: 'waiting', cls: 'td-prop' },
      html`<div class="td-prop__text"><div class="td-prop__title">${p.title}</div><div class="td-prop__why">${p.reason}</div></div>
      <div class="td-prop__btns">${P.button('Reject', { size: 'small', action: ['proposal.reject', { id: p.id, where: 'today' }] })}${P.button('Accept', { size: 'small', variant: 'primary', action: ['proposal.accept', { id: p.id, where: 'today' }] })}</div>`);
  };

  const reviewLine = (demo) => {
    if (demo === 'nothing-to-review' || demo === 'first-use') return '';
    const sugg = D.items.filter((i) => i.review === 'suggested' && i.status !== 'done');
    if (!sugg.length) return '';
    const calls = [...new Set(sugg.map((i) => i.callId))];
    if (!calls.includes('c-backend')) calls.push('c-backend');
    const total = sugg.length + 2;
    return NP.region('TD-R8', { cls: 'td-review', label: 'To review' }, html`
      <div><strong>To review:</strong> ${total} suggested items from ${calls.length} calls · 2 unnamed speakers</div>
      <div class="td-review__links">${calls.map((cid) => P.link(html`${D.call(cid).title} ›`, { action: ['nav.go', { screen: 'call-page', params: { callId: cid, view: 'summary', review: true } }], lang: 'en' }))}</div>`);
  };

  const todayCards = (ctx) => {
    const demo = ctx.demo;
    const L = ctx.local;
    if (demo === 'calendar-not-asked') {
      return C.emptyState({ icon: 'calendar', title: "See today's calls here", body: 'Noter reads your macOS Calendar to line up open items before each call.', actionLabel: 'Allow Calendar Access', action: ['today.allowCalendar'] });
    }
    if (demo === 'calendar-denied') return '';
    if (demo === 'loading') return html`<div class="td-skelcard np-card"><div class="td-skel w60"></div><div class="td-skel"></div><div class="td-skel"></div></div><div class="td-skelcard np-card"><div class="td-skel w60"></div><div class="td-skel"></div></div>`;
    if (demo === 'calendar-failed') return html`<div class="td-errline" role="alert">${icon('error', { size: 14 })}<span>Couldn't read today's calendar.</span>${P.button('Try Again', { size: 'small', action: ['today.retryCalendar'] })}</div>`;
    if (demo === 'no-calls') return C.emptyState({ variant: 'section', title: 'No calls today' });
    let events = D.events.slice();
    const out = [];
    if (demo === 'unmatched-live' && isRec()) out.push(C.upcomingCallCard({}, { variant: 'unmatched' }));
    else if (isRec()) {
      const live = events.find((e) => e.callId === state.rec.callId);
      if (live) { events = events.filter((e) => e !== live); out.push(C.upcomingCallCard(live, { variant: 'live' })); }
    }
    const expanded = L.expanded || {};
    events.forEach((e, i) => {
      const isFirst = i === 0 && !out.length;
      const exp = expanded[e.id] != null ? expanded[e.id] : isFirst;
      out.push(C.upcomingCallCard(demo === 'first-use' ? Object.assign({}, e, { items: [], questions: [] }) : e, { variant: 'today', expanded: exp, collapsible: !isFirst && exp }));
    });
    return out;
  };

  const render = (ctx) => {
    const demo = ctx.demo;
    const L = ctx.local;
    const dueNoCall = D.items.filter((i) => i.noCall && i.status !== 'done');
    const done = D.items.filter((i) => i.status === 'done' && i.doneToday);
    const props = D.proposals.filter((p) => !decided()[p.id]);
    const calendarGone = demo === 'calendar-denied';
    const nEvents = demo === 'no-calls' ? 0 : D.events.length;

    const r3 = NP.region('TD-R3', { cls: 'td-r3', label: 'Today' }, html`
      <h2 class="np-section-h">Today${demo === 'calendar-not-asked' || calendarGone ? '' : html` <span class="np-dim">· ${nEvents} call${nEvents === 1 ? '' : 's'}</span>`}</h2>
      <div class="td-cards">${todayCards(ctx)}</div>`);
    const r4 = calendarGone || demo === 'calendar-not-asked' ? '' : NP.region('TD-R4', { cls: 'td-r4', label: 'This week' }, html`
      <h2 class="np-section-h">This week</h2>
      <div class="td-weeklist np-card">${D.week.map((w) => C.upcomingCallCard(w, { variant: 'week' }))}</div>`);
    const r5 = NP.region('TD-R5', { cls: 'td-r5', label: 'Due this week, no call' }, html`
      <h2 class="np-section-h">Due this week, no call</h2>
      ${demo === 'first-use' ? C.emptyState({ icon: 'inbox', title: 'Nothing open yet', body: 'Items from your calls appear here. Noter offers to record when a call starts.' })
        : html`<div class="td-list np-card">${dueNoCall.length ? dueNoCall.map((i) => NP.A.itemRow(i)) : C.emptyState({ variant: 'section', title: 'Nothing due without a call' })}</div>`}`);
    const r6 = NP.region('TD-R6', { cls: 'td-r6', label: 'Proposals waiting' }, html`
      <h2 class="np-section-h">Proposals waiting <span class="np-dim">· ${props.length}</span></h2>
      ${C.undoStrip({ where: 'today' })}
      <div class="td-props np-card">${props.length ? props.slice(0, 3).map(proposalRow) : C.emptyState({ variant: 'section', title: 'Nothing waiting. Noter asks before it changes older records.' })}</div>
      ${P.link('Show All in Activity', { action: ['nav.go', { screen: 'activity', params: { focus: props[3] ? props[3].id : null } }] })}`);
    const r7 = NP.region('TD-R7', { cls: 'td-r7', label: 'Done today' }, html`
      ${P.disclosure(html`Done today <span class="np-dim">· ${done.length}</span>`, !!L.doneOpen, { action: ['today.doneToggle'] })}
      ${L.doneOpen ? html`<div class="td-list np-card">${done.length ? done.map((i) => C.actionItemRow ? C.actionItemRow(i, { variant: 'done', key: 'today-done' }) : NP.comp('action-item-row', { variant: 'done', state: 'ticked', cls: 'td-row is-done' }, html`${P.checkbox('', true, { ariaLabel: 'Done: ' + i.text, action: ['today.untick', { id: i.id }], id: 'done-' + i.id })}${C.personChip(i.owner)}<span class="td-row__text">${i.text}</span><span class="np-tb__spacer"></span>${P.button('Undo', { size: 'small', variant: 'quiet', action: ['today.untick', { id: i.id }] })}`)) : C.emptyState({ variant: 'section', title: 'Nothing ticked today' })}</div>` : ''}`);

    return html`<div class="td">
      ${reviewLine(demo)}
      ${r3}
      <div class="td-cols">
        <div class="td-col">${r4}${r5}${r7}</div>
        <div class="td-col">${r6}</div>
      </div>
    </div>`;
  };

  NP.screen('today', {
    section: 'today',
    title: 'Today',
    subtitle: () => D.today.label,
    states: STATES,
    toolbarActions: () => {
      if (isRec()) return C.recordingIndicator({ variant: 'button', status: state.rec.status === 'paused' ? 'paused' : 'recording' });
      if (!state.setup.audioGranted) return P.button('Finish Setup…', { action: ['today.finishSetup'], help: 'Microphone or system audio access was never granted' });
      return P.button('Record', { icon: 'record', cls: 'td-recbtn', action: ['today.record'], help: 'Start recording (⌃⌥⌘R)' });
    },
    banners: (ctx) => {
      const d = ctx.demo;
      const b = [];
      if (d === 'calendar-denied') b.push({ id: 'cal-denied', severity: 'warning', text: 'Calendar access is off', actions: [{ label: 'Open System Settings…', action: ['today.openCalSettings'] }] });
      if (d === 'self-test' || !state.setup.selfTestPassed) b.push({ id: 'selftest-today', severity: 'warning', text: 'Call detection is off until the audio self-test passes', actions: [{ label: 'Run Audio Self-Test…', action: ['dialogs.selfTest'] }] });
      if (d === 'quit-recording') b.push({ id: 'quit-rec', severity: 'warning', text: 'Noter quit during “Planning: VHI 8.0 drawer redesign” · saved up to 00:47:12', actions: [{ label: 'Open Call', action: ['nav.go', { screen: 'call-page', params: { callId: 'c-live', view: 'transcript' } }] }, { label: 'Resume Recording', variant: 'primary', action: ['today.resume'] }] });
      return b;
    },
    onDemo: (id, ctx) => {
      const L = ctx.local;
      L.handoffAsk = id === 'open-handoff' ? 'i-virt' : null;
      L.evidenceFailed = id === 'evidence-failed' ? 'i-replay' : null;
      L.loadingItems = false;
      if (id === 'live' || id === 'unmatched-live') { if (!isRec()) NP.startRecording(); }
      if (id === 'self-test') state.setup.selfTestPassed = false;
      if (id === 'default') state.setup.selfTestPassed = true;
      if (state.dismissed) { delete state.dismissed['cal-denied']; delete state.dismissed['quit-rec']; }
    },
    render,
  });

  /* ---------------- actions ---------------- */
  NP.onMany({
    'today.record': () => { NP.freshCall(); NP.startRecording({ offsetMs: 0 }); state.surface = 'call'; },
    'today.finishSetup': () => { const F = NP.local('firstrun'); F.step = 2; state.surface = 'firstrun'; },
    'today.resume': () => { NP.startRecording({ offsetMs: 47 * 60000 + 12000 }); state.surface = 'call'; },
    'today.openCalSettings': () => { NP.flash('proto', 'Opens System Settings › Privacy & Security › Calendars'); },
    'today.allowCalendar': () => { NP.openAlert({ title: '“Noter” would like to access your calendars.', body: 'Noter reads your calendar events to line up open items before each call.', variant: 'system', buttons: [{ label: "Don't Allow", action: 'today.calAnswer', args: { ok: false } }, { label: 'Allow Full Access', variant: 'primary', action: 'today.calAnswer', args: { ok: true } }] }); },
    'today.calAnswer': (a) => { state.alert = null; state.demo.today = a.ok ? 'default' : 'calendar-denied'; },
    'today.retryCalendar': () => { state.demo.today = 'loading'; setTimeout(() => { if (state.demo.today === 'loading') { state.demo.today = 'default'; NP.render(); } }, 900); },
    'today.expand': (a) => { const L = NP.local('today'); L.expanded = L.expanded || {}; const cur = L.expanded[a.id]; L.expanded[a.id] = cur == null ? !(D.events[0].id === a.id) : !cur; },
    'today.showAll': (a) => { const L = NP.local('today'); L.showAll = L.showAll || {}; L.showAll[a.id] = true; },
    'today.weekToggle': (a) => { const L = NP.local('today'); L.weekOpen = L.weekOpen || {}; L.weekOpen[a.id] = !L.weekOpen[a.id]; },
    'today.doneToggle': () => { const L = NP.local('today'); L.doneOpen = !L.doneOpen; },
    'today.sensitive': (a) => { const L = NP.local('today'); L.sensitive = L.sensitive || {}; L.sensitive[a.id] = !L.sensitive[a.id]; NP.flash('proto', L.sensitive[a.id] ? 'Marked as sensitive · Local only' : 'No longer sensitive'); },
    'today.tick': (a) => {
      const it = D.item(a.id); if (!it) return;
      if (it.status === 'done') { NP.actions['today.untick'](a); return; }
      if (it.status === 'handed-off') { NP.local('today').handoffAsk = it.id; return; }
      const wasSugg = it.review === 'suggested';
      it.status = 'done'; it.doneToday = true; it.review = 'accepted';
      NP.flash('row-' + it.id, wasSugg ? 'Accepted and done' : 'Done', 10000);
    },
    'today.untick': (a) => {
      const it = D.item(a.id); if (!it) return;
      it.status = it.handoff ? 'handed-off' : 'open'; it.doneToday = false;
      delete state.flash['row-' + it.id];
    },
    'today.handoffAnswer': (a) => {
      const L = NP.local('today'); L.handoffAsk = null;
      const it = D.item(a.id);
      if (a.a === 'keep') return;
      it.status = 'done'; it.doneToday = true;
      NP.flash('row-' + it.id, a.a === 'landed' ? 'Done · handoff landed' : 'Done another way', 10000);
    },
  });
  /* fallbacks for actions owned by other groups (registered only if absent after all modules load) */
  const fallback = (name, fn) => { if (!NP.actions[name]) NP.on(name, fn); };
  setTimeout(() => {
    fallback('item.tick', (a) => NP.actions['today.tick'](a));
    fallback('item.inspect', (a) => { NP.flash('proto', 'Item inspector for “' + (D.item(a.id) || {}).text + '” (group C)'); });
    fallback('item.handoff', (a) => { NP.flash('proto', 'Handoff drawer for “' + (D.item(a.id) || {}).text + '” (group C)'); });
    fallback('dialogs.selfTest', () => { NP.openSheet('a-selftest', {}); });
    fallback('proposal.accept', (a) => {
      const L = NP.local('activity'); L.decided = L.decided || {}; L.decided[a.id] = 'accepted';
      const p = D.proposals.find((x) => x.id === a.id);
      NP.undo('Accepted: ' + p.title, { context: p.reason, where: a.where || 'today', action: 'a.proposalUndo', args: { id: a.id } });
    });
    fallback('proposal.reject', (a) => {
      const L = NP.local('activity'); L.decided = L.decided || {}; L.decided[a.id] = 'rejected';
      const p = D.proposals.find((x) => x.id === a.id);
      NP.undo('Rejected: ' + p.title, { context: p.reason, where: a.where || 'today', action: 'a.proposalUndo', args: { id: a.id } });
    });
  }, 0);
  NP.on('a.proposalUndo', (a) => { const L = NP.local('activity'); if (L.decided) delete L.decided[a.id]; });

  /* fallback self-test sheet (group C owns the real Dialogs entry) */
  NP.overlay('a-selftest', {
    width: 560,
    title: () => 'Audio self-test',
    render: () => html`<div class="np-sheet__head"><div class="np-sheet__title">Audio self-test</div><div class="np-sheet__sub">Play the test clip or any sound in another app, and say a few words.</div></div>
      <div class="np-sheet__body">${C.selfTestPanel({ variant: 'sheet', key: 'sheet' })}</div>
      <div class="np-sheet__foot">${P.button('Done', { variant: 'primary', action: ['sheet.close'] })}</div>`,
  });
})();
