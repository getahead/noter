/* =====================================================================
   Group C — Screen — Call page (cpt-noter-component-screen-call-page)
   Regions PC-R1..PC-R9; inspectors in MW-R4: Call info (280),
   Item inspector (320, cpt-noter-component-ui-item-inspector),
   Handoff drawer (400, cpt-noter-component-ui-handoff-drawer).
   ===================================================================== */
(function () {
  'use strict';
  const { html, raw, act, comp, region, icon, P, C, data: D } = NP;
  const { KIND_LABEL, plural } = NP.cItem;

  /* ---------- example data owned by this module ---------- */
  // a couple more suggested items so the review flow has something to do
  if (D.item('d-scope')) D.item('d-scope').review = 'suggested';
  if (D.item('q-reconnect')) D.item('q-reconnect').review = 'suggested';
  const ORIG = {};
  D.items.forEach((it) => { ORIG[it.id] = { review: it.review, status: it.status, doneToday: it.doneToday, text: it.text, owner: it.owner }; });

  D.summaries = D.summaries || {
    'c-live': {
      lang: 'en',
      v1: 'The drawer redesign for VHI 8.0 is agreed in scope, but the estimate depends on the backend replay buffer. Drawer events go through the notification service, as decided in the backend sync on 2 Oct. Anna K. owns the redesign spec for Friday; Dmitri S. adds a replay buffer for websocket reconnects (VSTOR-9912). The 10k-row table in the drawer list gets virtualised first. Nobody owns the acceptance criteria for reconnect handling yet.',
      v2: 'The drawer redesign for VHI 8.0 is agreed in scope; its estimate depends on the backend replay buffer. Drawer events go through the notification service, as decided on 2 Oct. Anna K. delivers the redesign spec by Friday 17 Oct, and Dmitri S. adds a replay buffer for websocket reconnects (VSTOR-9912). You virtualise the 10k-row table first. The owner of the reconnect acceptance criteria is still open.',
    },
  };
  const summaryFor = (call) => (D.summaries[call.id] || {
    lang: 'en',
    v1: `${call.title} covered ${call.topics && call.topics.length ? call.topics.map((t) => (D.topics.find((x) => x.id === t) || {}).name).filter(Boolean).join(' and ').toLowerCase() : 'open work'}. ${call.openItems ? plural(call.openItems, 'item') + ' stayed open' : 'Nothing stayed open'}; the decisions and items below link to the moment they were said.`,
  });
  D.callChanges = D.callChanges || [
    { id: 'cc-1', day: 'Today', at: '11:42', actor: 'You', what: 'Accepted 3 action items', target: 'Action items', kind: 'review', callId: 'c-live' },
    { id: 'cc-2', day: 'Today', at: '11:30', actor: 'You', what: 'Added the tag “release”', target: 'Call info › Tags', kind: 'tag', callId: 'c-live' },
    { id: 'cc-3', day: 'Today', at: '11:20', actor: 'You', what: 'Edited the summary', target: 'Summary', kind: 'edit', callId: 'c-live', before: 'Nobody owns the acceptance criteria for reconnect handling yet.', after: 'The owner of the reconnect acceptance criteria is still open.' },
    { id: 'cc-4', day: 'Today', at: '11:05', actor: 'You', what: 'Handed off “Virtualise the 10k-row table” to Claude Code', target: 'VSTOR-1234', kind: 'handoff', callId: 'c-live' },
    { id: 'cc-5', day: 'Today', at: '10:58', actor: 'Archive pass job', what: 'Upgraded the transcript: 41 words and 2 speaker labels', target: 'Transcript', kind: 'batch', batch: 43, callId: 'c-live' },
    { id: 'cc-6', day: 'Today', at: '10:49', actor: 'Noter', what: 'Wrote summary, 4 action items and 2 decisions', target: 'Claude Code · 1 min 40 s after the call', kind: 'outputs', callId: 'c-live' },
    { id: 'cc-7', day: 'Today', at: '03:12', actor: 'Reconciliation job', what: 'Applied term “shaman” to 4 segments', target: 'Transcript', kind: 'batch', batch: 4, callId: 'c-live' },
  ];

  const AGENT_REVIEWS = {
    Architect: 'The plan routes drawer events through the notification service, which keeps one delivery path. The replay buffer on the backend is the critical dependency: without it the drawer shows gaps after a reconnect. Virtualising the 10k-row table first is the right order. Ask for a load test with 10k rows before the spec is final. The reconnect acceptance criteria still have no owner.',
    'Product manager': 'Scope is clear and the Friday date for the spec is realistic. The empty-state copy has no owner, which blocks the design review. Decide who writes the reconnect acceptance criteria before the next planning call. The estimate should be re-checked once VSTOR-9912 is sized. Nothing here changes the release date yet.',
    Designer: 'Keeping the drawer at 480 pt avoids a layout change in three other screens. The empty state needs copy and an illustration decision. Check focus order with VoiceOver as the action item says. The notification badge position was not discussed. Bring two empty-state options to the next review.',
    'QA lead': 'The reconnect case needs test data with dropped connections. The handover checklist from the QA sync is still due on Tuesday. Add the 10k-row scroll to the regression suite. No acceptance criteria means no test plan yet for reconnects. Ask Dmitri S. for a staging toggle that forces reconnects.',
    Scribe: 'Four action items, two decisions and two open questions came out of this call. Anna K. committed to the spec by Friday in Russian; the item is recorded in English. One line by an unnamed speaker is in German. Two speakers are still unnamed. The previous planning call is linked from the decisions.',
  };

  /* ---------- helpers ---------- */
  const L = () => NP.local('call-page', { view: 'summary' });
  const callOf = (ctx) => D.call((ctx.params && ctx.params.callId) || 'c-live');
  const itemsOf = (call, kind) => D.items.filter((i) => i.callId === call.id && (!kind || i.kind === kind));
  const suggestedOf = (call) => itemsOf(call).filter((i) => i.review === 'suggested');
  const isSensitive = (call, ctx) => call.privacy === 'Sensitive' || ctx.demo === 'sensitive' || (L().sensitive && L().sensitive[call.id]);
  const writingStep = (ctx) => (ctx.demo === 'writing' ? (L().writeStep || 0) : 99);
  const peopleLine = (call) => call.people.map((p) => D.person(p).short).join(', ');

  /* ---------- section bodies ---------- */
  const summarySection = (call, ctx) => {
    const l = L();
    const s = summaryFor(call);
    l.summaryEdit = l.summaryEdit || {};
    const edited = l.summaryEdit[call.id];
    const versions = [{ id: 'v1', label: 'v1 · Claude Code · 10:47', short: 'v1' }];
    if (s.v2) versions.push({ id: 'v2', label: 'v2 · Claude Code · 10:49', short: 'v2' });
    if (edited) versions.push({ id: 'edit', label: 'Your Edit · 11:20', short: 'Your Edit' });
    const cur = C.versionOf('sum-' + call.id, edited ? 'edit' : s.v2 ? 'v2' : 'v1');
    const text = cur === 'edit' ? edited : cur === 'v1' ? s.v1 : (s.v2 || s.v1);
    const step = writingStep(ctx);
    const editing = l.editingSummary === call.id;
    const local = ctx.demo === 'local-model';
    let meta = local ? 'Summary · English · Local model · 6 min 10 s after the call' : 'Summary · English · Claude Code · 1 min 40 s after the call';
    let notice = '';
    if (ctx.demo === 'regenerated') notice = html`Regenerated · your 2 edits kept · ${P.link(l.sumDiff ? 'Hide Diff' : 'Show Diff', { action: ['pc.sumDiff'] })}`;
    if (l.namesUpdated && call.id === 'c-live') notice = html`Names updated · ${P.link('Regenerate', { action: ['pc.regenerate', { callId: call.id }] })} for better wording`;
    if (l.regenerating) meta = 'Regenerating…';
    const body = editing
      ? html`<div class="pc-edit">${P.textField({ variant: 'multi', id: 'sum-edit', rows: 6, value: l.summaryDraft != null ? l.summaryDraft : text, bind: 'local.call-page.summaryDraft', ariaLabel: 'Summary', lang: s.lang })}<div class="pc-edit__acts"><span class="np-dim">⌘Return saves · Esc cancels</span><span class="np-tb__spacer"></span>${P.button('Cancel', { size: 'small', variant: 'quiet', action: ['pc.sumCancel'] })}${P.button('Save', { size: 'small', variant: 'primary', action: ['pc.sumSave', { callId: call.id }], kbd: '⌘↩' })}</div></div>`
      : (l.sumDiff && ctx.demo === 'regenerated') ? C.diffView({ before: s.v1, after: text, lang: s.lang, title: 'v1 → current' })
        : C.compareOn('sum-' + call.id) ? C.diffView({ before: s.v1, after: text, lang: s.lang, title: 'v1 → ' + cur })
          : html`<p class="pc-prose" lang="${s.lang}">${text}</p>`;
    const regenItems = [{ label: 'With Current Settings', action: ['pc.regenerate', { callId: call.id }] }, { label: 'With a Different Model…', action: ['dlg.regenerate', { callId: call.id }] }];
    return C.outputSection({
      kind: 'summary', title: 'Summary', key: 'sum', lang: s.lang, edited: !!edited && cur === 'edit',
      state: step < 1 ? 'writing' : editing ? 'editing' : l.regenerating ? 'regenerating' : edited ? 'edited' : 'ready',
      meta: step < 1 ? html`${P.progress({ value: null, label: 'Writing summary' })} ${local ? 'Writing with the local model · up to 10 min · role reviews follow in the background' : 'Writing summary… 1 min 10 s'}` : meta,
      notice,
      actions: step < 1 || editing ? '' : html`${P.button('Edit', { size: 'small', variant: 'quiet', action: ['pc.sumEdit', { callId: call.id }] })}${C.versionSwitcher({ versions, current: cur, key: 'sum-' + call.id })}${P.pulldown('Regenerate', regenItems, { size: 'small', anchorId: 'regen-sum', variant: 'toolbar' })}${P.button('Copy', { size: 'small', variant: 'quiet', flashKey: 'copy-sum', action: ['proto.flash', { key: 'copy-sum', text: 'Copied' }] })}`,
      body,
    });
  };

  const itemSection = (call, ctx, kind, title, idx) => {
    const step = writingStep(ctx);
    const l = L();
    const all = itemsOf(call, kind);
    const failed = ctx.demo === 'section-failed' && kind === 'action' && !l.retried;
    const empty = ctx.demo === 'empty-section' && (kind === 'decision' || kind === 'action');
    const list = empty ? (kind === 'action' ? (l.added || []).map(D.item).filter(Boolean) : []) : all.filter((i) => i.review !== 'rejected' || NP.flashed('row-' + i.id));
    const rejected = empty ? [] : all.filter((i) => i.review === 'rejected' && !NP.flashed('row-' + i.id));
    const toReview = list.filter((i) => i.review === 'suggested').length;
    const key = 'sec-' + kind;
    const writing = step < idx;
    let body;
    if (failed) {
      body = C.inlineBanner({ severity: 'error', text: 'Couldn’t write the action items (Claude Code timed out)', actions: [{ label: 'Try Again', action: ['pc.retry', { how: 'retry' }], loading: !!NP.flashed('retrying') }, { label: 'Use Local Model', action: ['pc.retry', { how: 'local' }] }] });
    } else if (!list.length) {
      const emptyText = { decision: 'No decisions in this call', action: 'No action items in this call', question: 'No open questions in this call', risk: 'No risks in this call' }[kind];
      body = html`${C.emptyState({ variant: 'section', title: emptyText })}${kind === 'action' ? (l.adding ? html`<div class="pc-add">${P.textField({ id: 'add-item', placeholder: 'What needs doing, and who does it?', bind: 'local.call-page.addText', enter: 'pc.addItem', ariaLabel: 'New action item' })}${P.button('Add', { size: 'small', variant: 'primary', action: ['pc.addItem', { callId: call.id }] })}</div>` : P.button('Add Action Item', { size: 'small', icon: 'plus', action: ['pc.addStart'] })) : ''}`;
    } else {
      body = html`<div class="pc-rows">${list.map((it) => (kind === 'action' ? C.actionItemRow(it, { variant: 'full', key: 'pc' }) : C.outputItemRow(it, { variant: 'full' })))}</div>`;
    }
    let notice = '';
    if (ctx.demo === 'regenerated' && kind === 'action') notice = '1 item not suggested again because you rejected it';
    if (failed === false && l.retried === 'local' && kind === 'action' && ctx.demo === 'section-failed') notice = 'Written by the local model after Claude Code timed out';
    const actions = writing || failed ? '' : html`
      ${toReview ? P.button('Accept All', { size: 'small', kbd: '⇧A', action: ['item.acceptMany', { ids: list.filter((i) => i.review === 'suggested').map((i) => i.id), message: 'Accepted ' + plural(toReview, kind === 'action' ? 'action item' : kind === 'decision' ? 'decision' : kind === 'question' ? 'open question' : 'risk'), where: 'call-page' }] }) : ''}
      ${C.shareMenu({ variant: 'section', scope: title, key: key, unreviewed: toReview || null, sensitive: isSensitive(call, ctx) })}`;
    return C.outputSection({ kind: 'items', title, count: writing || failed ? null : empty ? 0 : list.length, toReview: writing || failed ? null : toReview || null, key, rejected, state: writing ? 'writing' : failed ? 'failed' : !list.length ? 'empty' : toReview ? 'review-pending' : 'ready', meta: writing ? html`${P.progress({ value: null, label: 'Writing ' + title })} Waiting for the summary` : '', notice, actions, body });
  };

  const participantsSection = (call, ctx) => {
    const l = L(); l.pp = l.pp || {};
    const said = { 'p-anna': ['Committed to the drawer redesign spec by Friday', 'Offered to own the reconnect criteria during crosstalk'], 'p-pavel': ['Asked who writes the reconnect acceptance criteria', 'Pushed back on changing the drawer width'], 'p-dmitri': ['Committed to a replay buffer, VSTOR-9912', 'Restated the 2 Oct decision on the notification service'], 'p-you': ['Committed to hand off the table virtualisation today'] };
    const body = html`<div class="pc-pp">${call.people.map((p) => {
      const open = !!l.pp[p];
      return html`<div class="pc-pp__p">${P.disclosure(D.person(p).short, open, { variant: 'row', action: ['pc.pp', { p }] })}${open ? html`<ul class="pc-pp__list">${(said[p] || ['Spoke briefly; nothing assigned']).map((s) => html`<li>${s}</li>`)}</ul>` : ''}</div>`;
    })}</div>`;
    return C.outputSection({ kind: 'participants', title: 'Per participant', body, key: 'pp' });
  };

  const momentsSection = (call) => C.outputSection({ kind: 'moments', title: 'Marked moments', count: 1, key: 'mm', body: html`<div class="pc-mark">${icon('flag', { size: 13 })}${C.provenanceChip({ kind: 'this-call', label: '00:21:00', span: '00:21:00', callId: call.id }, { variant: 'timestamp' })}<span>Marked during the call, while Speaker 2 spoke about the reconnect</span></div>` });

  const summaryView = (call, ctx) => {
    const l = L();
    return html`
      ${C.undoStrip({ where: 'call-page' })}
      ${call.unnamed && call.unnamed.length || D.unnamedSpeakers[call.id] ? C.speakerNamingPanel({ callId: call.id, audioGone: ctx.demo === 'audio-gone' }) : ''}
      ${region('PC-R3', { cls: 'pc-col', label: 'Outputs' }, html`
        ${summarySection(call, ctx)}
        ${itemSection(call, ctx, 'decision', 'Decisions', 2)}
        ${itemSection(call, ctx, 'action', 'Action items', 3)}
        ${itemSection(call, ctx, 'question', 'Open questions', 4)}
        ${itemsOf(call, 'risk').length ? itemSection(call, ctx, 'risk', 'Risks', 5) : ''}
        ${writingStep(ctx) >= 5 ? participantsSection(call, ctx) : ''}
        ${writingStep(ctx) >= 5 ? momentsSection(call) : ''}
      `)}`;
  };

  const transcriptView = (call, ctx) => {
    const l = L();
    const audioGone = ctx.demo === 'audio-gone';
    const segs = D.segments.filter((s) => !s.hypothesis);
    const loading = ctx.demo === 'transcript-loading';
    return region('PC-R5', { cls: 'pc-tr', label: 'Transcript' }, html`
      ${C.speakerNamingPanel({ callId: call.id, audioGone })}
      <div class="pc-tr__head">
        <span class="t-headline">Transcript</span>${call.languages.map((c) => C.languageTag(c, { variant: 'call' }))}
        <span class="np-dim">${audioGone ? 'Audio deleted on 15 Nov (kept 30 days) · transcript kept' : call.length + ' · audio kept until 15 Nov'}</span>
        <span class="np-tb__spacer"></span>
        ${audioGone ? '' : P.button(l.playing ? 'Stop' : 'Play from Start', { size: 'small', icon: l.playing ? 'stop' : 'play', action: ['pc.play'] })}
        ${P.button(l.archive ? 'Hide Archive Changes' : 'Show Archive Changes', { size: 'small', variant: 'quiet', action: ['pc.archive'] })}
      </div>
      ${l.archive ? C.diffView({ variant: 'transcript-marks', before: 'Websocket уведомления идут через нотификейшн сервис, как решили второго октября. Fast, ja.', after: 'Websocket уведомления идут через notification service, как решили второго октября. Fast, ja, der Kanal ist da.', title: 'archive pass, 41 words and 2 speaker labels in the whole call', lang: 'ru' }) : ''}
      ${loading ? html`<div class="pc-skel">${[1, 2, 3, 4, 5].map(() => raw('<div class="pc-skel__line" style="width:94%"></div>'))}</div>`
        : NP.c('transcriptView', { callId: call.id, segments: segs, variant: 'post-call', key: 'pc', highlightSpan: ctx.params.span, audioGone })}
      ${l.playing && !audioGone ? region('PC-R6', { cls: 'pc-play', label: 'Playback' }, NP.c('playbackBar', { variant: 'post-call', callId: call.id, at: ctx.params.span || '00:19:40' })) : ''}`);
  };

  const reviewsView = (call, ctx) => {
    const l = L(); l.thumbs = l.thumbs || {};
    const agents = D.agents.filter((a) => a.enabled);
    const step = writingStep(ctx);
    return region('PC-R7', { cls: 'pc-col', label: 'Agent reviews' }, html`
      ${agents.map((a, i) => {
        const t = l.thumbs[a.id];
        const writing = step < 6 || (ctx.demo === 'local-model' && i > 1);
        return C.outputSection({
          kind: 'agent-review', title: a.name + ' review', hideTitle: true, key: 'ar-' + a.id, badge: C.agentBadge(a.name, { variant: 'static' }),
          state: writing ? 'writing' : 'ready',
          meta: writing ? 'Role reviews follow in the background' : `${a.runtime} · ${a.model} · skill ${a.skill} v2 · 10:51`,
          actions: writing ? '' : html`${C.versionSwitcher({ versions: [{ id: 'v1', label: 'v1 · 10:51' }, { id: 'v2', label: 'v2 · 11:02' }], current: C.versionOf('ar-' + a.id, 'v2'), key: 'ar-' + a.id })}${P.iconButton('thumbUp', { label: 'Useful', size: 'inline', pressed: t === 'up', action: ['pc.thumb', { id: a.id, v: 'up' }] })}${P.iconButton('thumbDown', { label: 'Not useful', size: 'inline', pressed: t === 'down', action: ['pc.thumb', { id: a.id, v: 'down' }] })}`,
          body: html`<p class="pc-prose" lang="en">${AGENT_REVIEWS[a.name] || 'No concerns from this role in this call.'}</p>`,
        });
      })}
      ${C.outputSection({ kind: 'items', title: 'Cards from this call', count: D.cards.length + D.earlierCards.length, key: 'cards', body: html`<div class="pc-cards">${D.cards.concat(D.earlierCards).map((k, i) => html`<div class="pc-cards__c">${NP.c('copilotCard', Object.assign({ outcome: k.outcome || ['Pinned', 'Dismissed', 'Expired'][i % 3] }, k), { variant: 'read-only', key: 'pc' })}<span class="pc-cards__out">${k.outcome || ['Pinned', 'Dismissed', 'Expired'][i % 3]}</span></div>`)}</div>` })}`);
  };

  const historyView = (call, ctx) => region('PC-R8', { cls: 'pc-col', label: 'History' },
    C.historyTimeline({ variant: 'call', key: 'call-' + call.id, callTitle: call.title, entries: ctx.demo === 'history-empty' ? [] : D.callChanges.filter((c) => c.callId === call.id || call.id === 'c-live') }));

  /* ---------- screen ---------- */
  const VIEWS = [{ value: 'summary', label: 'Summary' }, { value: 'transcript', label: 'Transcript' }, { value: 'reviews', label: 'Agent Reviews' }, { value: 'history', label: 'History' }];
  const viewOf = (ctx) => (ctx.params && ctx.params.view) || 'summary';

  NP.screen('call-page', {
    section: 'library',
    title: (ctx) => callOf(ctx).title,
    subtitle: (ctx) => { const c = callOf(ctx); return `${c.dateLong} ${c.time} · ${c.length} · ${peopleLine(c)}`; },
    toolbarCenter: (ctx) => P.segmented(VIEWS, viewOf(ctx), { variant: 'view', label: 'Call page view', action: ['pc.view'] }),
    toolbarActions: (ctx) => {
      const call = callOf(ctx);
      const unreviewed = suggestedOf(call).length;
      const insOpen = !!NP.state.inspector || !ctx.local.hideInspector;
      const more = [
        { label: 'Rename…', action: ['proto.flash', { key: 'proto', text: 'Rename edits the title in place' }] },
        { label: 'Call Type ▸', submenu: true, action: ['proto.flash', { key: 'proto', text: 'Call types: Planning, 1:1, Design review, Vendor, QA sync' }] },
        { label: isSensitive(call, ctx) ? 'Sensitive' : 'Mark as Sensitive', checked: !!isSensitive(call, ctx), action: ['pc.sensitive', { callId: call.id }] },
        { label: 'Regenerate Outputs…', action: ['dlg.regenerate', { callId: call.id }] },
        { divider: true },
        { label: 'Show Performance', action: ['nav.go', { screen: 'performance', params: { callId: call.id } }] },
        { label: 'Show in Finder', action: ['proto.flash', { key: 'proto', text: 'Opens the call folder in Finder' }] },
        { divider: true },
        { label: 'Delete Call…', destructive: true, kbd: '⌘⌫', action: ['dlg.deleteCall', { callId: call.id }] },
      ];
      return html`${C.shareMenu({ variant: 'toolbar', scope: 'Whole call', key: 'pc-toolbar', unreviewed: unreviewed || null, sensitive: isSensitive(call, ctx), nothing: ctx.demo === 'writing' && writingStep(ctx) < 4 })}
        ${P.pulldown('More', more, { iconOnly: true, icon: 'ellipsis', size: 'toolbar', anchorId: 'pc-more', ariaLabel: 'More', variant: 'item-menu' })}
        ${P.iconButton('sidebar', { label: insOpen ? 'Hide Inspector' : 'Show Inspector', help: (insOpen ? 'Hide' : 'Show') + ' Inspector (⌥⌘I)', pressed: insOpen, action: ['pc.inspectorToggle'], cls: 'pc-instoggle' })}`;
    },
    banners: (ctx) => {
      const call = callOf(ctx);
      const out = [];
      const n = suggestedOf(call).length;
      if (n && viewOf(ctx) !== 'history' && ctx.demo !== 'writing') out.push({ id: 'review', severity: 'info', dismissible: false, text: `${plural(n, 'suggested item')} to review before sharing`, actions: [{ label: 'Start Review', action: ['pc.startReview', { callId: call.id }] }, { label: 'Accept All', variant: 'primary', action: ['item.acceptMany', { ids: suggestedOf(call).map((i) => i.id), message: 'Accepted ' + plural(n, 'suggested item'), where: 'call-page' }] }] });
      if (ctx.demo === 'local-model') out.push({ id: 'local', severity: 'degraded', text: 'Summary written by the local model', actions: [{ label: 'Regenerate with Claude Code…', action: ['dlg.regenerate', { callId: call.id }] }] });
      if (ctx.demo === 'transcript-upgraded') out.push({ id: 'upgraded', severity: 'info', text: 'Transcript upgraded · the archive pass changed 41 words and 2 speaker labels; summary regenerated', actions: [{ label: 'Show Diff', action: ['pc.showArchiveDiff', { callId: call.id }] }] });
      if (ctx.demo === 'archive-pending') out.push({ id: 'pending', severity: 'info', dismissible: false, text: 'Archive transcript pending' });
      if (isSensitive(call, ctx)) out.push({ id: 'sensitive', severity: 'info', dismissible: false, text: 'Sensitive call · processed on this Mac only' });
      if (ctx.demo === 'first-call') out.push({ id: 'notify', severity: 'info', text: 'Get a notification when a call’s summary is ready.', actions: [{ label: 'Notify Me When Summaries Are Ready', action: ['proto.flash', { key: 'proto', text: 'macOS asks: “Noter” would like to send you notifications' }] }] });
      if (ctx.demo === 'writing' && writingStep(ctx) < 5) out.push({ id: 'writing', severity: 'info', dismissible: false, text: 'Writing the outputs · the transcript is ready to read', actions: [{ label: 'Read Transcript', action: ['pc.view', { value: 'transcript' }] }] });
      return out;
    },
    defaultInspector: (ctx) => ({ kind: 'call-info', props: { callId: callOf(ctx).id } }),
    states: [
      { id: 'default', label: 'Normal · suggested items waiting' },
      { id: 'writing', label: 'Outputs being written (section by section)' },
      { id: 'section-failed', label: 'A section failed' },
      { id: 'local-model', label: 'Written by the local model' },
      { id: 'empty-section', label: 'Empty sections' },
      { id: 'regenerated', label: 'Regenerated with edits kept' },
      { id: 'nothing-to-review', label: 'Nothing to review' },
      { id: 'audio-gone', label: 'Audio no longer kept' },
      { id: 'transcript-upgraded', label: 'Transcript upgraded' },
      { id: 'archive-pending', label: 'Archive transcript pending' },
      { id: 'sensitive', label: 'Sensitive call' },
      { id: 'first-call', label: 'First recorded call (notifications)' },
      { id: 'history-empty', label: 'History · no changes yet' },
      { id: 'handoff-generating', label: 'Handoff · prompt being written' },
      { id: 'handoff-failed', label: 'Handoff · prompt failed' },
      { id: 'handoff-others', label: 'Handoff · item owned by someone else' },
      { id: 'handoff-no-mapping', label: 'Handoff · no repository mapped' },
      { id: 'handoff-no-handler', label: 'Handoff · no link handler' },
      { id: 'handoff-open-failed', label: 'Handoff · automation denied' },
      { id: 'handoff-sensitive', label: 'Handoff · sensitive call' },
    ],
    onDemo: (id, ctx) => {
      const l = L();
      // restore the example data first
      D.items.forEach((it) => { if (ORIG[it.id]) Object.assign(it, ORIG[it.id]); });
      Object.assign(l, { writeStep: 99, retried: null, added: [], adding: false, sumDiff: false, archive: false, playing: false, regenerating: false });
      NP.state.inspector = null; NP.state.undo = null;
      if (l.writeTimer) { clearInterval(l.writeTimer); l.writeTimer = null; }
      if (id === 'writing') {
        l.writeStep = 0;
        l.writeTimer = setInterval(() => { l.writeStep++; if (l.writeStep >= 6) { clearInterval(l.writeTimer); l.writeTimer = null; } NP.render(); }, 1600);
      }
      if (id === 'nothing-to-review') D.items.forEach((it) => { if (it.callId === 'c-live' && it.review === 'suggested') it.review = 'accepted'; });
      if (id === 'audio-gone' || id === 'transcript-upgraded') NP.state.route.params = Object.assign({}, NP.state.route.params, { view: id === 'audio-gone' ? 'transcript' : 'summary' });
      if (id === 'history-empty') NP.state.route.params = Object.assign({}, NP.state.route.params, { view: 'history' });
      if (id.startsWith('handoff-')) {
        const hs = id.replace('handoff-', '');
        const itemId = hs === 'others' ? 'i-replay' : 'i-virt';
        const H = NP.local('c-handoff', {});
        H[itemId] = { state: hs === 'generating' ? 'generating' : hs === 'failed' ? 'failed' : hs === 'open-failed' ? 'open-failed' : 'ready', noMapping: hs === 'no-mapping', noHandler: hs === 'no-handler', sensitive: hs === 'sensitive' };
        NP.state.inspector = { kind: 'handoff', props: { itemId } };
      }
    },
    render: (ctx) => {
      const call = callOf(ctx);
      const v = viewOf(ctx);
      const body = v === 'transcript' ? transcriptView(call, ctx) : v === 'reviews' ? reviewsView(call, ctx) : v === 'history' ? historyView(call, ctx) : summaryView(call, ctx);
      return html`<div class="pc pc--${v}">${body}</div>`;
    },
  });

  NP.onAfterRender(() => {
    const l = NP.state.local['call-page'];
    if (l && l.focusPending && l.focus) { const el = document.getElementById('row-' + l.focus); if (el) { el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'center' }); } l.focusPending = false; }
  });

  /* ---------- actions ---------- */
  NP.onMany({
    'pc.view': (a) => { NP.go('call-page', Object.assign({}, NP.state.route.params, { view: a.value }), { replace: true, keepInspector: true }); return false; },
    'pc.inspectorToggle': () => {
      const l = L();
      const open = !!NP.state.inspector || !l.hideInspector;
      if (open) { NP.state.inspector = null; l.hideInspector = true; } else l.hideInspector = false;
    },
    'pc.startReview': (a) => {
      const l = L(); const first = suggestedOf(D.call(a.callId)).find((i) => i.kind === 'action') || suggestedOf(D.call(a.callId))[0];
      if (NP.state.route.params.view && NP.state.route.params.view !== 'summary') NP.state.route.params = Object.assign({}, NP.state.route.params, { view: 'summary' });
      l.focus = first ? first.id : null; l.focusPending = true;
    },
    'pc.sumEdit': () => { const l = L(); l.editingSummary = NP.state.route.params.callId || 'c-live'; l.summaryDraft = null; },
    'pc.sumCancel': () => { L().editingSummary = null; },
    'pc.sumSave': (a) => {
      const l = L(); const s = summaryFor(D.call(a.callId));
      l.summaryEdit[a.callId] = l.summaryDraft != null ? l.summaryDraft : (s.v2 || s.v1);
      l.versions = l.versions || {}; (NP.local('c-items').versions = NP.local('c-items').versions || {})['sum-' + a.callId] = 'edit';
      l.editingSummary = null; NP.flash('copy-sum', 'Saved', 2000);
    },
    'pc.sumDiff': () => { L().sumDiff = !L().sumDiff; },
    'pc.regenerate': () => { const l = L(); l.regenerating = true; l.namesUpdated = false; setTimeout(() => { l.regenerating = false; NP.flash('copy-sum', 'Regenerated', 2000); NP.render(); }, 1500); },
    'pc.retry': (a) => {
      const l = L();
      if (a.how === 'retry') { NP.flash('retrying', 'Retrying', 1200); setTimeout(() => { l.retried = 'retry'; NP.render(); }, 1200); return; }
      l.retried = 'local';
    },
    'pc.addStart': () => { L().adding = true; L().addText = ''; },
    'pc.addItem': (a) => {
      const l = L(); const text = (a.value || l.addText || '').trim(); if (!text) return;
      const id = 'i-new-' + Date.now();
      D.items.push({ id, kind: 'action', text, owner: 'p-you', due: '', status: 'open', review: 'accepted', callId: a.callId || 'c-live', lang: 'en' });
      l.added = (l.added || []).concat([id]); l.adding = false; l.addText = '';
    },
    'pc.pp': (a) => { const l = L(); l.pp[a.p] = !l.pp[a.p]; },
    'pc.play': () => { L().playing = !L().playing; },
    'pc.archive': () => { L().archive = !L().archive; },
    'pc.showArchiveDiff': () => { L().archive = true; NP.go('call-page', Object.assign({}, NP.state.route.params, { view: 'transcript' }), { replace: true, keepInspector: true }); return false; },
    'pc.thumb': (a) => { const l = L(); l.thumbs[a.id] = l.thumbs[a.id] === a.v ? null : a.v; },
    'pc.sensitive': (a) => { const l = L(); l.sensitive = l.sensitive || {}; l.sensitive[a.callId] = !l.sensitive[a.callId]; },
  });

  /* =========================================================
     Call info inspector (PC-R4, 280)
     ========================================================= */
  NP.inspector('call-info', {
    width: 280,
    render: (props, ctx) => {
      const call = D.call(props.callId);
      const l = L(); l.tags = l.tags || {};
      const tags = l.tags[call.id] || (l.tags[call.id] = call.tags.slice());
      const sens = isSensitive(call, ctx || { demo: NP.demo('call-page') });
      const audioGone = NP.demo('call-page') === 'audio-gone' || (l.audioDeleted && l.audioDeleted[call.id]);
      const unnamed = (D.unnamedSpeakers[call.id] || []).filter((s) => !((NP.local('c-items').naming || {})[call.id] || { named: {} }).named[s.id]);
      return html`<div class="pc-info" data-variant="call-info">
        <header class="it-ins__head"><span class="t-headline">Call info</span><span class="np-tb__spacer"></span>${P.iconButton('x', { label: 'Close inspector', size: 'inline', action: ['shell.closeInspector'] })}</header>
        <div class="pc-info__sec"><h3 class="pc-info__h">Participants</h3>
          <div class="pc-info__people">${call.people.map((p) => C.personChip(p))}${unnamed.map((s) => C.personChip(s.id, { variant: 'unnamed', callId: call.id, key: 'ci' }))}</div></div>
        <div class="pc-info__sec"><h3 class="pc-info__h">Call</h3>
          <dl class="np-kv"><dt>Type</dt><dd>${P.popup(['Planning', '1:1', 'Design review', 'Backend sync', 'Vendor', 'QA sync'], call.type, { variant: 'inline', label: 'Call type', id: 'ci-type' })}</dd>
          <dt>App</dt><dd>${call.platform}</dd><dt>When</dt><dd>${call.dateLong} · ${call.time}</dd><dt>Length</dt><dd class="np-tnum">${call.length}</dd>
          <dt>Languages</dt><dd>${call.languages.map((c) => C.languageTag(c, { variant: 'call' }))}</dd></dl></div>
        <div class="pc-info__sec"><h3 class="pc-info__h">Tags</h3>
          ${P.searchField({ variant: 'token-field', id: 'ci-tags', placeholder: 'Add tag…', tokens: tags.map((t) => ({ label: t, kind: 'tag' })), tokenAction: 'pc.tagRemove', bind: 'local.call-page.tagDraft', enter: 'pc.tagAdd', ariaLabel: 'Tags' })}
          ${NP.flashed('tag') ? C.inlineStatus(NP.flashed('tag'), { variant: 'trailing', actionLabel: 'Undo', action: ['pc.tagUndo', { callId: call.id }] }) : ''}</div>
        <div class="pc-info__sec"><h3 class="pc-info__h">Privacy</h3>
          <div class="pc-info__row">${C.modeIndicator({ variant: 'call-info', mode: sens ? 'Sensitive · local' : call.mode, key: 'ci' })}</div>
          ${P.toggle('Sensitive', !!sens, { size: 'small', id: 'ci-sens', action: ['pc.sensitive', { callId: call.id }] })}
          ${P.link('What left this Mac: 3 requests · 41 KB', { action: ['settings.open', { pane: 'privacy' }] })}</div>
        <div class="pc-info__sec"><h3 class="pc-info__h">Audio</h3>
          ${audioGone ? html`<p class="np-dim">Audio deleted on 15 Nov · transcript kept</p>` : html`<p>Kept until 15 Nov</p>${P.button('Delete Audio Now…', { size: 'small', variant: 'destructive', action: ['dlg.deleteAudio', { callId: call.id }] })}`}</div>
        <div class="pc-info__sec"><h3 class="pc-info__h">Processing</h3>
          <p class="np-dim">${call.runtime} · summary 1 min 40 s after the call · $0.31</p>
          ${P.link('Show Performance', { action: ['nav.go', { screen: 'performance', params: { callId: call.id } }] })}</div>
      </div>`;
    },
  });
  NP.onMany({
    'pc.tagAdd': (a) => {
      const l = L(); const callId = (NP.state.route.params.callId) || 'c-live';
      const v = String(a.value || '').replace(/,/g, '').trim().slice(0, 32); if (!v) return;
      const tags = l.tags[callId];
      if (!tags.some((t) => t.toLowerCase() === v.toLowerCase())) { tags.push(v); l.lastTag = { op: 'add', v }; NP.flash('tag', 'Added “' + v + '”', 10000); }
      l.tagDraft = '';
    },
    'pc.tagRemove': (a) => { const l = L(); const callId = NP.state.route.params.callId || 'c-live'; const v = l.tags[callId][a.index]; l.tags[callId].splice(a.index, 1); l.lastTag = { op: 'remove', v }; NP.flash('tag', 'Removed “' + v + '”', 10000); },
    'pc.tagUndo': (a) => { const l = L(); const t = l.tags[a.callId]; const lt = l.lastTag; if (!lt) return; if (lt.op === 'add') t.splice(t.indexOf(lt.v), 1); else t.push(lt.v); delete NP.state.flash.tag; },
  });

  /* =========================================================
     28. Item inspector (320)
     ========================================================= */
  NP.inspector('item', {
    width: 320,
    render: (props) => {
      const it = D.item(props.itemId);
      if (!it) return html`<div class="np-pad">Item not found.</div>`;
      const IL = NP.local('c-inspector', {}); const st = IL[it.id] = IL[it.id] || { tab: props.tab || 'details', draft: { text: it.text, issue: it.issue || '', due: it.due || '' } };
      const kind = KIND_LABEL[it.kind] || 'Item';
      const closed = it.status === 'closed';
      const seg = D.segments.find((s) => s.t === it.span);
      const proposal = D.proposals.find((p) => p.target === it.id);
      const people = D.people.map((p) => ({ value: p.id, label: p.short }));
      const details = html`
        ${P.textField({ variant: 'multi', id: 'ii-text', rows: 3, value: st.draft.text, bind: 'local.c-inspector.' + it.id + '.draft.text', ariaLabel: 'Text', lang: it.lang })}
        <dl class="np-kv it-ins__kv">
          ${it.kind === 'action' ? html`<dt>Owner</dt><dd>${C.personChip(it.owner || 'p-you', { variant: 'owner-picker', key: 'ii-' + it.id, itemId: it.id })}</dd>
          <dt>Due</dt><dd>${P.textField({ id: 'ii-due', value: st.draft.due, bind: 'local.c-inspector.' + it.id + '.draft.due', ariaLabel: 'Due', cls: 'it-ins__due', trailing: P.iconButton('calendar', { label: 'Show calendar', size: 'inline', anchor: 'ii-due-cal', action: ['dlg.duePopover', { anchor: 'ii-due-cal', itemId: it.id }] }) })}</dd>
          <dt>Status</dt><dd>${P.popup([{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'carried', label: 'Carried' }, { value: 'handed-off', label: 'Handed Off' }, { value: 'closed', label: 'Closed' }], it.status, { label: 'Status', id: 'ii-status', action: ['ii.status', { id: it.id }] })}</dd>` : ''}
          <dt>Linked issue</dt><dd>${P.textField({ id: 'ii-issue', value: st.draft.issue, placeholder: 'VSTOR-1234', bind: 'local.c-inspector.' + it.id + '.draft.issue', ariaLabel: 'Linked issue' })}<div class="it-ins__help">Closes automatically when ${st.draft.issue || 'the issue'} moves to Done or a merged pull request carries it</div></dd>
          ${it.kind === 'action' ? html`<dt></dt><dd>${P.checkbox('Engineering', !!it.engineering, { id: 'ii-eng', action: ['ii.eng', { id: it.id }] })}${it.engineering ? html` ${P.button('Handoff', { size: 'small', icon: 'terminal', action: ['item.handoff', { id: it.id }] })}` : ''}</dd>` : ''}
        </dl>
        ${it.review === 'suggested' ? html`<div class="it-ins__review">${P.badge('Suggested', { kind: 'status', tone: 'neutral' })}${P.button('Accept', { size: 'small', action: ['item.accept', { id: it.id }] })}${P.button('Reject', { size: 'small', variant: 'quiet', action: ['item.reject', { id: it.id }] })}</div>` : ''}
        ${closed ? html`<div class="it-ins__closed">${icon('checkCircle', { size: 13 })}Closed: PR #448 merged on 14 Oct · ${P.link('Reopen', { action: ['item.reopen', { id: it.id }] })}</div>` : ''}
        ${proposal ? html`<div class="it-ins__closed">${P.badge('Close proposed', { kind: 'status', tone: 'neutral' })} decided in ${P.link('Activity', { action: ['nav.go', { screen: 'activity' }] })}</div>` : ''}
        <h3 class="pc-info__h">Evidence</h3>
        <ul class="it-ins__ev">
          <li>${icon('wave', { size: 12 })}<span>${C.provenanceChip({ kind: 'this-call', label: D.call(it.callId).title + ' · ' + (it.span || ''), span: it.span, callId: it.callId }, { variant: 'inline' })}</span></li>
          ${it.issue ? html`<li>${icon('ticket', { size: 12 })}<span>${it.issue} In Progress · Jira · today 10:14</span></li>` : ''}
          ${proposal ? html`<li>${icon('branch', { size: 12 })}<span>${proposal.reason} · confidence ${proposal.confidence.toLowerCase()}</span></li>` : ''}
        </ul>
        ${seg ? html`<blockquote class="it-ins__quote" lang="${seg.lang.toLowerCase()}"><span class="np-dim">${C.speakerLabel(seg.speaker, { static: true })} · ${seg.t}</span><br>${seg.text}</blockquote>` : ''}
        ${it.handoff ? html`<p class="it-ins__rec">${icon('terminal', { size: 12 })} Handed off to ${it.handoff.tool} · 16 Oct ${it.handoff.at} · ${it.handoff.repo}</p>` : ''}
        <div class="it-ins__save">${NP.flashed('ii-save') ? C.inlineStatus('Saved', { variant: 'trailing' }) : ''}${P.button('Save', { size: 'small', variant: 'primary', action: ['ii.save', { id: it.id }] })}</div>`;
      const history = C.historyTimeline({ variant: 'item', key: 'item-' + it.id, entries: [
        { id: 'ih-1-' + it.id, day: 'Today', at: '11:42', actor: 'You', what: it.review === 'suggested' ? 'Opened for review' : 'Accepted the item', kind: 'review' },
        { id: 'ih-2-' + it.id, day: 'Today', at: '10:49', actor: 'Noter', what: 'Extracted from the call', target: D.call(it.callId).title, kind: 'outputs' },
      ].concat(it.issue ? [{ id: 'ih-3-' + it.id, day: 'Today', at: '03:05', actor: 'Evidence job', what: 'Linked ' + it.issue, kind: 'evidence' }] : []) });
      return comp('item-inspector', { variant: it.kind === 'action' ? 'action-item' : it.kind === 'decision' ? 'decision' : 'open-question', state: closed ? 'closed-by-evidence' : proposal ? 'proposal-pending' : 'viewing', cls: 'it-ins', attrs: { 'aria-label': 'Item inspector' } },
        html`<header class="it-ins__head" data-region="II-R1">${P.badge(kind, { kind: 'kind', tone: 'neutral', icon: NP.cItem.KIND_ICON[it.kind] })}<span class="np-tb__spacer"></span>${C.shareMenu({ variant: 'inspector', scope: '1 ' + kind.toLowerCase(), key: 'ii' })}${P.iconButton('x', { label: 'Close inspector', size: 'inline', action: ['shell.closeInspector'] })}</header>
        <div data-region="II-R2" class="it-ins__tabs">${P.segmented([{ value: 'details', label: 'Details' }, { value: 'history', label: 'History' }], st.tab, { variant: 'view', label: 'Inspector view', action: ['ii.tab', { id: it.id }] })}</div>
        <div class="it-ins__body">${st.tab === 'history' ? history : details}</div>`);
    },
  });
  NP.onMany({
    'ii.tab': (a) => { NP.local('c-inspector')[a.id].tab = a.value; },
    'ii.status': (a) => { const it = D.item(a.id); it.status = a.value; NP.flash('ii-save', 'Saved', 2000); },
    'ii.eng': (a) => { const it = D.item(a.id); it.engineering = !!a.value; },
    'ii.save': (a) => { const it = D.item(a.id); const d = NP.local('c-inspector')[a.id].draft; Object.assign(it, { text: d.text, issue: d.issue || undefined, due: d.due }); NP.flash('ii-save', 'Saved', 2000); },
  });

  /* =========================================================
     24. Handoff drawer (400) — HD-R1..HD-R7
     ========================================================= */
  const promptFor = (it, v) => {
    const call = D.call(it.callId);
    const base = `# ${it.text}\n\nGoal: ${it.text.replace(/\.$/, '')} so that the drawer list in VHI 8.0 scrolls 10k rows smoothly.\n\nContext\n- From “${call.title}”, ${call.dateLong} ${it.span || ''}: “Agreed. I will hand that off today.”\n- Linked issue: ${it.issue || 'none'}\n- Decision: drawer events go through the notification service (Backend sync, 2 Oct).\n\nAcceptance\n- Rows render in a virtualised list; scroll stays at 60 fps with 10k rows.\n- Keyboard focus and VoiceOver order stay correct while scrolling.\n- Add a regression test with 10k generated rows.`;
    return v === 'v1' ? base.replace(' so that the drawer list in VHI 8.0 scrolls 10k rows smoothly', '').replace('\n- Add a regression test with 10k generated rows.', '') : base;
  };
  NP.inspector('handoff', {
    width: 400,
    render: (props) => {
      const it = D.item(props.itemId);
      if (!it) return html`<div class="np-pad">Item not found.</div>`;
      const call = D.call(it.callId);
      const H = NP.local('c-handoff', {});
      const h = H[it.id] = H[it.id] || { state: 'ready' };
      const repos = D.repos;
      if (!h.target) h.target = (repos[0] && repos[0].tool) || 'Claude Code';
      if (!h.repo && !h.noMapping) h.repo = repos[0].path;
      const ver = C.versionOf('hd-' + it.id, h.text != null ? 'edit' : 'v2');
      const gen = promptFor(it, ver === 'v1' ? 'v1' : 'v2');
      const value = ver === 'edit' && h.text != null ? h.text : gen;
      const edited = h.text != null && h.text !== promptFor(it, 'v2');
      const own = (it.owner || 'p-you') === 'p-you';
      const sens = h.sensitive || isSensitive(call, { demo: NP.demo('call-page') });
      const opened = h.state === 'opened';
      const tool = h.target;
      const variant = sens ? 'sensitive-call' : it.review === 'suggested' ? 'suggested-item' : !own ? 'someone-elses-item' : tool === 'Codex' ? 'codex' : 'claude-code';
      const state = h.state === 'generating' ? 'generating' : h.state === 'failed' ? 'generation-failed' : h.noMapping ? 'no-mapping' : h.noHandler ? 'no-link-handler' : h.state === 'open-failed' ? 'open-failed' : opened ? 'opened' : NP.flashed('hd-copy') ? 'copied' : edited ? 'edited' : 'ready';
      const repoOpts = repos.map((r) => ({ value: r.path, label: `${r.path} (${r.jira})` })).concat([{ value: '__add', label: 'Add Mapping…' }]);
      const launch = h.noHandler
        ? `No ${tool} link handler found. Noter will open iTerm and run ${tool === 'Codex' ? 'codex' : 'claude'} in ${h.repo || '~/projects/vhi-frontend'}; macOS asks once to allow Automation.`
        : `Opens ${tool} in your usual terminal with the prompt filled in; nothing is sent until you press Return.`;
      const openLabel = 'Open in ' + tool;
      const copyBtn = P.button('Copy Prompt', { variant: own ? 'secondary' : 'primary', flashKey: 'hd-copy', action: ['hd.copy', { id: it.id }], kbd: own ? null : '⌘↩', icon: 'copy' });
      const openBtn = P.button(openLabel, { variant: own ? 'primary' : 'secondary', action: ['hd.open', { id: it.id }], kbd: own ? '⌘↩' : null, disabled: !!h.noMapping || h.state === 'generating', help: h.noMapping ? 'No repository mapped for VSTOR' : 'Opens through ' + (tool === 'Codex' ? 'codex://' : 'claude-cli://') + 'open · no Automation prompt' });
      let promptBlock;
      if (h.state === 'generating') promptBlock = html`<div class="hd-gen">${P.progress({ variant: 'spinner', label: 'Writing the handoff prompt' })}<span>Writing the handoff prompt…</span>${P.button('Cancel', { size: 'small', variant: 'quiet', action: ['hd.state', { id: it.id, s: 'ready' }] })}</div>${C.promptEditor({ value: '', state: 'generating', caption: 'handoffs/item-2041.md', key: 'hd-' + it.id })}`;
      else if (h.state === 'failed') promptBlock = C.inlineBanner({ severity: 'error', text: 'Couldn’t write the prompt', actions: [{ label: 'Try Again', action: ['hd.regen', { id: it.id }] }] });
      else promptBlock = C.promptEditor({ value, caption: 'handoffs/item-2041.md', key: 'hd-' + it.id, edited, diffWith: promptFor(it, 'v2'), bind: 'local.c-handoff.' + it.id + '.text', versionSwitcher: C.versionSwitcher({ variant: 'caption', key: 'hd-' + it.id, current: ver, versions: [{ id: 'v1', label: 'Generated v1 · 10:52', short: 'v1' }, { id: 'v2', label: 'Generated v2 · 10:56', short: 'v2' }].concat(h.text != null ? [{ id: 'edit', label: 'Your Edit', short: 'Your Edit' }] : []) }) });
      return comp('handoff-drawer', { variant, state, cls: 'hd', attrs: { 'aria-label': 'Handoff' } }, html`
        <header class="hd__head" data-region="HD-R1">
          <div class="hd__titles"><span class="t-headline">Handoff</span><span class="hd__item" title="${it.text}">${it.text}</span></div>
          ${edited ? P.badge('Edited', { kind: 'status', tone: 'neutral' }) : ''}
          ${call.runtime === 'Local model' ? P.badge('Local model', { kind: 'kind', tone: 'neutral' }) : ''}
          ${P.button('Regenerate', { size: 'small', variant: 'quiet', action: ['hd.regen', { id: it.id }] })}
          ${P.iconButton('x', { label: 'Close drawer', size: 'inline', action: ['shell.closeInspector'] })}
        </header>
        <div class="hd__body">
          <div class="hd__row" data-region="HD-R2"><span class="hd__lab">Target</span>${P.segmented(['Claude Code', 'Codex'], tool, { variant: 'option', label: 'Target', action: ['hd.target', { id: it.id }] })}</div>
          <div class="hd__row" data-region="HD-R3"><span class="hd__lab">Repository</span>${h.noMapping ? html`<span class="hd__warn">${icon('warning', { size: 12 })}No repository mapped for VSTOR · ${P.link('Add Mapping…', { action: ['dlg.addMapping', { key: 'VSTOR' }] })}</span>` : P.popup(repoOpts, h.repo, { label: 'Repository', id: 'hd-repo-' + it.id, action: ['hd.repo', { id: it.id }] })}</div>
          <div data-region="HD-R4">${promptBlock}</div>
          <p class="hd__launch" data-region="HD-R5" title="Opens through ${tool === 'Codex' ? 'codex://' : 'claude-cli://'}open · no Automation prompt">${icon('terminal', { size: 12 })}${launch}</p>
          ${sens ? html`<p class="hd__warn">${icon('warning', { size: 12 })}This call is sensitive. The prompt reaches a cloud model when you press Return in the terminal.</p>` : ''}
          ${it.handoff || opened ? html`<p class="hd__rec" data-region="HD-R6">${icon('checkCircle', { size: 12 })}${opened ? 'Opened in iTerm · item marked Handed off' : `Handed off to ${it.handoff.tool} · 16 Oct ${it.handoff.at} · ${it.handoff.repo}`}</p>` : ''}
          ${h.state === 'open-failed' ? html`<p class="hd__err">${icon('error', { size: 12 })}Couldn’t open ${tool} · use Copy Prompt</p>` : ''}
          ${it.review === 'suggested' ? html`<p class="hd__accept">Opening or copying accepts this suggested item.</p>` : ''}
        </div>
        <footer class="hd__foot" data-region="HD-R7">${own ? html`${copyBtn}${openBtn}` : html`${openBtn}${copyBtn}`}</footer>`);
    },
  });
  NP.onMany({
    'hd.target': (a) => { NP.local('c-handoff')[a.id].target = a.value; },
    'hd.repo': (a) => { if (a.value === '__add') { NP.actions['dlg.addMapping']({ key: 'VSTOR' }); return; } NP.local('c-handoff')[a.id].repo = a.value; },
    'hd.state': (a) => { NP.local('c-handoff')[a.id].state = a.s; },
    'hd.regen': (a) => { const h = NP.local('c-handoff')[a.id]; h.state = 'generating'; h.text = null; setTimeout(() => { if (h.state === 'generating') { h.state = 'ready'; NP.render(); } }, 1600); },
    'hd.copy': (a) => {
      const it = D.item(a.id); if (it.review === 'suggested') it.review = 'accepted';
      try { navigator.clipboard && navigator.clipboard.writeText(promptFor(it, 'v2')).catch(() => {}); } catch (e) { /* */ }
      NP.flash('hd-copy', 'Copied', 2000);
    },
    'hd.open': (a) => {
      const it = D.item(a.id); const h = NP.local('c-handoff')[a.id];
      if (h.state === 'open-failed') return;
      if (it.review === 'suggested') it.review = 'accepted';
      h.state = 'opened'; it.status = 'handed-off';
      it.handoff = { tool: h.target, repo: h.repo || '~/projects/vhi-frontend', at: '10:58', state: 'awaiting PR' };
    },
  });
})();
