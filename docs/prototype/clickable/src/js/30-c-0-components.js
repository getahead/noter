/* =====================================================================
   Group C — post-call output components (DESIGN 3.2, table B rows 19–28, 39, 40)
   output-section (19), action-item-row (20), output-item-row (21),
   speaker-naming-panel (22), share-menu (23), handoff-drawer (24),
   prompt-editor (25), version-switcher (26), diff-view (27),
   item-inspector (28), change-row (39), history-timeline (40)
   plus the shared item actions (item.*).
   ===================================================================== */
(function () {
  'use strict';
  const { html, raw, attrs, act, comp, icon, P, C, data: D } = NP;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const L = () => NP.local('c-items', { rowUndo: {}, editing: null, askLanded: {}, rejectedOpen: {}, edit: {} });

  /* ---------------- item state helpers ---------------- */
  const KIND_LABEL = { action: 'Action item', decision: 'Decision', question: 'Open question', risk: 'Risk' };
  const KIND_ICON = { action: 'check', decision: 'decision', question: 'question', risk: 'risk' };
  NP.cItem = { KIND_LABEL, KIND_ICON, plural };

  const snapshot = (it) => ({ status: it.status, review: it.review, doneToday: it.doneToday, owner: it.owner, due: it.due, text: it.text, engineering: it.engineering });
  const rowOutcome = (id, text, ms) => { NP.flash('row-' + id, text, ms || 10000); };

  /* ---------------- 20. Action item row ----------------
     variant: full | compact | done | read-only */
  C.actionItemRow = (it, o) => {
    o = o || {};
    if (!it) return '';
    const variant = o.variant || 'full';
    const l = L();
    const flash = NP.flashed('row-' + it.id);
    const owner = it.owner || 'p-you';
    const done = it.status === 'done' || it.status === 'closed';
    const suggested = it.review === 'suggested';
    const rejected = it.review === 'rejected';
    let state = rejected ? 'rejected' : suggested ? 'suggested' : it.status === 'closed' ? 'closed-by-evidence' : it.status === 'handed-off' ? 'handed-off' : done ? 'done' : (it.due === 'Wed 15 Oct' ? 'overdue' : 'open');
    if (l.editing === it.id && variant === 'full') state = 'editing';
    if (flash) state = 'outcome';
    const callLink = o.showCall && it.callId ? html`<span class="it-row__call">${NP.P.link(D.call(it.callId).title, { action: ['nav.go', { screen: 'call-page', params: { callId: it.callId } }] })}</span>` : '';

    // collapsed outcome (Rejected · Undo, Accepted and done · Undo, Done · Undo)
    if (flash && (rejected || variant !== 'full')) {
      return comp('action-item-row', { variant, state: 'outcome', cls: 'it-row it-row--' + variant + ' is-outcome', attrs: { lang: it.lang, id: 'row-' + it.id } },
        html`${C.inlineStatus(flash, { variant: 'row-outcome', actionLabel: 'Undo', action: ['item.undoRow', { id: it.id }] })}<span class="it-row__ghost">${it.text}</span>`);
    }
    if (state === 'editing') return editRow(it, variant);

    const overdue = !done && it.due === 'Wed 15 Oct';
    const dueText = it.due ? html`<span class="it-row__due${overdue ? ' is-overdue' : ''}">${overdue ? icon('warning', { size: 11 }) : ''}${it.due === 'Today' ? 'due today' : it.due}</span>` : '';
    const tags = html`
      ${it.issue ? P.badge(it.issue, { kind: 'kind', tone: 'neutral', icon: 'ticket' }) : ''}
      ${it.engineering && variant === 'full' ? P.badge('Engineering', { kind: 'kind', tone: 'neutral' }) : ''}
      ${it.status === 'handed-off' ? P.badge('Handed off · ' + ((it.handoff && it.handoff.state) || 'awaiting PR'), { kind: 'status', tone: 'info' }) : ''}
      ${it.status === 'closed' ? html`<span class="it-row__closed">Closed: ${it.closedBy || 'PR #448 merged on 14 Oct'} · ${P.link('Reopen', { action: ['item.reopen', { id: it.id }] })}</span>` : ''}
      ${it.closeProposed ? P.badge('Close proposed', { kind: 'status', tone: 'neutral' }) : ''}
      ${it.carried ? P.badge('Carried from ' + it.carried, { kind: 'status', tone: 'neutral' }) : ''}
      ${suggested ? P.badge('Suggested', { kind: 'status', tone: 'neutral' }) : ''}
      ${it.owedToYou && variant === 'compact' ? html`<span class="it-row__meta">owed to you${it.from ? ' · ' + it.from : ''}</span>` : ''}`;
    const evidence = it.span ? C.provenanceChip({ kind: 'this-call', label: it.span, span: it.span, callId: it.callId }, { variant: 'timestamp' }) : '';
    const handoffBtn = it.engineering && variant !== 'read-only' && !done ? P.button('Handoff', { size: 'small', action: ['item.handoff', { id: it.id }], icon: 'terminal' }) : '';
    const info = variant !== 'read-only' ? P.iconButton('info', { label: 'Show in Item inspector', size: 'inline', action: ['item.inspect', { id: it.id }], help: 'Item inspector (⌘I)' }) : '';
    const check = variant === 'read-only' ? html`<span class="it-row__bullet">${icon('check', { size: 12 })}</span>`
      : P.checkbox('', done, { ariaLabel: 'Done: ' + it.text, action: ['item.tick', { id: it.id }], id: 'chk-' + (o.key || '') + it.id });
    const owner_ = C.personChip(owner, { variant: owner === 'p-you' ? 'you' : 'link', key: it.id });
    const review = variant === 'full' && suggested && !flash ? html`<div class="it-row__review">
        ${P.button('Accept', { size: 'small', action: ['item.accept', { id: it.id }], kbd: 'A' })}
        ${P.button('Edit', { size: 'small', variant: 'quiet', action: ['item.edit', { id: it.id }], kbd: 'E' })}
        ${P.button('Reject', { size: 'small', variant: 'quiet', action: ['item.reject', { id: it.id }], kbd: 'R' })}
      </div>` : '';
    let compactMenu = '';
    if (variant === 'compact' && suggested) {
      compactMenu = P.pulldown('Review', [
        { label: 'Accept', action: ['item.accept', { id: it.id }] },
        { label: 'Edit…', action: ['item.inspect', { id: it.id }] },
        { label: 'Reject', action: ['item.reject', { id: it.id }] },
      ], { iconOnly: true, anchorId: 'rv-' + (o.key || '') + it.id, ariaLabel: 'Review suggested item', variant: 'context-menu' });
    }
    const landed = l.askLanded[it.id] ? html`<div class="it-row__landed" role="group" aria-label="Did the handoff land?">
        <span class="t-headline">Did the handoff land?</span>
        ${P.button('Yes, Landed', { size: 'small', variant: 'primary', action: ['item.landed', { id: it.id, how: 'landed' }] })}
        ${P.button('Done Another Way', { size: 'small', action: ['item.landed', { id: it.id, how: 'other' }] })}
        ${P.button('Keep Open', { size: 'small', variant: 'quiet', action: ['item.landed', { id: it.id, how: 'keep' }] })}
      </div>` : '';
    const outcome = flash ? C.inlineStatus(flash, { variant: 'row-outcome', actionLabel: 'Undo', action: ['item.undoRow', { id: it.id }] }) : '';

    if (variant === 'compact' || variant === 'done') {
      return comp('action-item-row', { variant, state: variant === 'done' ? 'done' : state, cls: 'it-row it-row--compact' + (done ? ' is-done' : ''), attrs: { lang: it.lang, title: it.text } },
        html`<div class="it-row__line">${check}${owner_}<span class="it-row__text">${it.text}</span>${evidence}${dueText}${tags}${callLink}<span class="np-tb__spacer"></span>${variant === 'done' ? P.button('Undo', { size: 'small', variant: 'quiet', action: ['item.untick', { id: it.id }] }) : ''}${handoffBtn}${compactMenu}${info}</div>${landed}${outcome ? html`<div class="it-row__outcome">${outcome}</div>` : ''}`);
    }
    return comp('action-item-row', { variant, state, cls: 'it-row it-row--full' + (done ? ' is-done' : '') + (NP.local('call-page').focus === it.id ? ' is-focus' : ''), attrs: { lang: it.lang, tabindex: '-1', id: 'row-' + it.id } },
      html`<div class="it-row__check">${check}</div>
      <div class="it-row__main">
        <div class="it-row__line1">${owner_}<span class="it-row__text">${it.text}</span></div>
        <div class="it-row__line2">${evidence}${dueText}${tags}${callLink}</div>
        ${landed}
      </div>
      <div class="it-row__actions">${outcome || review}${handoffBtn}${info}</div>`);
  };

  const editRow = (it, variant) => {
    const e = L().edit[it.id] || (L().edit[it.id] = { text: it.text, owner: it.owner || 'p-you', due: it.due || '', engineering: !!it.engineering });
    const people = D.people.map((p) => ({ value: p.id, label: p.short }));
    return comp('action-item-row', { variant, state: 'editing', cls: 'it-row it-row--full it-row--editing', attrs: { lang: it.lang } },
      html`<div class="it-row__edit">
        ${P.textField({ id: 'edit-text-' + it.id, value: e.text, bind: 'local.c-items.edit.' + it.id + '.text', ariaLabel: 'Item text', cls: 'it-row__edit-text' })}
        <div class="it-row__edit-fields">
          <label class="it-field"><span>Owner</span>${P.popup(people, e.owner, { label: 'Owner', bind: 'local.c-items.edit.' + it.id + '.owner', id: 'edit-owner-' + it.id })}</label>
          <label class="it-field"><span>Due</span>${P.textField({ id: 'edit-due-' + it.id, value: e.due, bind: 'local.c-items.edit.' + it.id + '.due', ariaLabel: 'Due', cls: 'it-field__due' })}</label>
          ${P.checkbox('Engineering', e.engineering, { bind: 'local.c-items.edit.' + it.id + '.engineering', id: 'edit-eng-' + it.id })}
          <span class="np-tb__spacer"></span>
          ${P.button('Cancel', { size: 'small', variant: 'quiet', action: ['item.editCancel', { id: it.id }] })}
          ${P.button('Save', { size: 'small', variant: 'primary', action: ['item.save', { id: it.id }], kbd: '⌘↩' })}
        </div>
      </div>`);
  };

  /* ---------------- 21. Output item row ---------------- */
  C.outputItemRow = (it, o) => {
    o = o || {};
    if (!it) return '';
    const variant = o.variant || 'full';
    const kindVariant = it.kind === 'decision' ? 'decision' : it.kind === 'question' ? 'open-question' : it.kind === 'risk' ? 'risk' : 'extra';
    const flash = NP.flashed('row-' + it.id);
    const suggested = it.review === 'suggested';
    if (flash && it.review === 'rejected') {
      return comp('output-item-row', { variant: kindVariant + '-' + variant, state: 'outcome', cls: 'it-row it-row--' + variant + ' is-outcome', attrs: { lang: it.lang, id: 'row-' + it.id } },
        html`${C.inlineStatus(flash, { variant: 'row-outcome', actionLabel: 'Undo', action: ['item.undoRow', { id: it.id }] })}<span class="it-row__ghost">${it.text}</span>`);
    }
    const state = suggested ? 'suggested' : it.answered ? 'answered' : it.carried ? 'carried' : 'open';
    const speakers = it.owner ? C.personChip(it.owner, { variant: it.owner === 'p-you' ? 'you' : 'link' }) : '';
    const evidence = it.span ? C.provenanceChip({ kind: 'this-call', label: it.span, span: it.span, callId: it.callId }, { variant: 'timestamp' }) : '';
    const relation = it.reaffirms ? html`<span class="it-row__meta">reaffirms ${C.provenanceChip({ kind: 'past-call', label: it.reaffirms, callId: 'c-backend' }, { variant: 'inline' })}</span>`
      : it.parked ? html`<span class="it-row__meta">parked on ${it.parked}</span>`
      : it.kind === 'question' && variant === 'full' ? html`<span class="it-row__meta">carried to the next call with these people</span>` : '';
    const answered = it.answered ? html`<span class="it-row__meta">Answered in ${P.link(it.answered, { external: true })}</span>` : '';
    const riskStatus = it.kind === 'risk' ? P.badge(it.resolved ? 'Resolved' : 'Unresolved', { kind: 'status', tone: it.resolved ? 'success' : 'warning' }) : '';
    const review = variant === 'full' && suggested ? html`<div class="it-row__review">
        ${P.button('Accept', { size: 'small', action: ['item.accept', { id: it.id }], kbd: 'A' })}
        ${P.button('Edit', { size: 'small', variant: 'quiet', action: ['item.inspect', { id: it.id }], kbd: 'E' })}
        ${P.button('Reject', { size: 'small', variant: 'quiet', action: ['item.reject', { id: it.id }], kbd: 'R' })}</div>` : '';
    const outcome = flash ? C.inlineStatus(flash, { variant: 'row-outcome', actionLabel: 'Undo', action: ['item.undoRow', { id: it.id }] }) : '';
    const label = (KIND_LABEL[it.kind] || 'Item') + ': ';
    if (variant !== 'full') {
      return comp('output-item-row', { variant: kindVariant + '-' + variant, state, cls: 'it-row it-row--compact', attrs: { lang: it.lang, title: it.text } },
        html`<div class="it-row__line"><span class="it-row__glyph">${icon(KIND_ICON[it.kind] || 'info', { size: 13, label: KIND_LABEL[it.kind] })}</span><span class="it-row__text">${it.text}</span>${relation}${evidence}${suggested ? P.badge('Suggested', { kind: 'status', tone: 'neutral' }) : ''}${it.topic && variant !== 'read-only' ? C.topicChip(it.topic, { variant: 'name', showMerge: false }) : ''}</div>`);
    }
    return comp('output-item-row', { variant: kindVariant, state, cls: 'it-row it-row--full', attrs: { lang: it.lang, id: 'row-' + it.id, tabindex: '-1' } },
      html`<div class="it-row__check it-row__glyph">${icon(KIND_ICON[it.kind] || 'info', { size: 14, label: KIND_LABEL[it.kind] })}</div>
      <div class="it-row__main">
        <div class="it-row__line1"><span class="np-sr">${label}</span><span class="it-row__text">${it.text}</span></div>
        <div class="it-row__line2">${speakers}${evidence}${relation}${answered}${riskStatus}${suggested ? P.badge('Suggested', { kind: 'status', tone: 'neutral' }) : ''}${it.topic ? C.topicChip(it.topic, { variant: 'name', showMerge: false }) : ''}</div>
      </div>
      <div class="it-row__actions">${outcome || review}${P.iconButton('info', { label: 'Show in Item inspector', size: 'inline', action: ['item.inspect', { id: it.id }] })}</div>`);
  };

  /* ---------------- 19. Output section ----------------
     {title, count, toReview, kind:'summary'|'items'|'participants'|'agent-review'|'moments', meta, notice, body, actions, state, key, rejected:[items], badge, lang} */
  C.outputSection = (o) => {
    o = o || {};
    const kind = o.kind || 'items';
    const variant = { summary: 'summary', items: 'item-section', participants: 'per-participant', 'agent-review': 'agent-review', moments: 'marked-moments' }[kind] || kind;
    const state = o.state || 'ready';
    const head = html`<header class="pc-sec__head">
      <h2 class="pc-sec__title">${o.badge || ''}${o.hideTitle ? html`<span class="np-sr">${o.title}</span>` : o.title}${o.count != null ? html`<span class="pc-sec__count"> · ${o.count}</span>` : ''}${o.toReview ? html`<span class="pc-sec__count"> · ${o.toReview} to review</span>` : ''}${o.edited ? P.badge('Edited', { kind: 'status', tone: 'neutral' }) : ''}</h2>
      <div class="pc-sec__actions">${o.actions || ''}</div>
    </header>`;
    const meta = o.meta ? html`<div class="pc-sec__meta">${o.meta}</div>` : '';
    const notice = o.notice ? html`<div class="pc-sec__notice">${o.notice}</div>` : '';
    let body = o.body;
    if (state === 'writing') {
      body = html`<div class="pc-skel" aria-busy="true"><div class="pc-skel__line" style="width:92%"></div><div class="pc-skel__line" style="width:84%"></div><div class="pc-skel__line" style="width:60%"></div></div>`;
    }
    const rej = (o.rejected || []);
    const rejKey = 'rej-' + (o.key || o.title);
    const rejOpen = L().rejectedOpen[rejKey];
    const rejected = rej.length ? html`<div class="pc-sec__rejected">${P.disclosure('Rejected (' + rej.length + ')', rejOpen, { variant: 'row', action: ['item.toggleRejected', { key: rejKey }] })}
      ${rejOpen ? html`<ul class="pc-sec__rejlist">${rej.map((it) => html`<li lang="${it.lang}"><span class="it-row__ghost is-rej">${it.text}</span>${P.button('Restore', { size: 'small', action: ['item.restore', { id: it.id }] })}</li>`)}</ul>` : ''}</div>` : '';
    return comp('output-section', { variant, state, tag: 'section', cls: 'pc-sec pc-sec--' + kind, attrs: { 'aria-label': o.title, lang: o.lang } },
      html`${head}${meta}${notice}<div class="pc-sec__body">${body || ''}</div>${rejected}`);
  };

  /* ---------------- 23. Share menu ----------------
     {variant:'toolbar'|'section'|'inspector'|'row'|'list', scope, key, unreviewed, sensitive, nothing} */
  C.shareMenu = (o) => {
    o = o || {};
    const variant = o.variant || 'toolbar';
    const anchor = 'share-' + (o.key || variant);
    const disabled = !!o.nothing;
    const fk = 'share-' + (o.key || variant);
    const items = [
      { header: o.scope || 'Whole call' },
      o.nothing ? { header: 'Nothing to share yet: outputs are being written' } : null,
      o.unreviewed ? { header: `Includes ${o.unreviewed} suggested item${o.unreviewed === 1 ? '' : 's'} not reviewed yet` } : null,
      o.sensitive ? { header: 'Sensitive call · copying puts the text on your clipboard' } : null,
      variant === 'list' ? null : { label: 'Copy for Slack', kbd: '⌘⇧C', disabled, action: ['share.copy', { fk, text: o.sensitive ? 'Copied' : 'Copied for Slack' }] },
      variant === 'list' ? null : { label: 'Copy for Jira', kbd: '⌥⌘C', disabled, action: ['share.copy', { fk, text: o.sensitive ? 'Copied' : 'Copied for Jira' }] },
      variant === 'list' ? null : { label: 'Copy as Markdown', kbd: '⌥⇧⌘C', disabled, action: ['share.copy', { fk, text: 'Copied as Markdown' }] },
      variant === 'list' ? null : { divider: true },
      { label: 'Export…', kbd: '⌘E', action: ['dlg.export', { scope: o.scope || 'Whole call', fk }] },
    ].filter(Boolean);
    NP._menus[anchor] = items;
    const open = NP.state.menu && NP.state.menu.anchor === anchor;
    const flash = NP.flashed(fk);
    const exported = NP.flashed(fk + '-export');
    if (variant === 'toolbar') {
      return comp('share-menu', { variant, state: exported || flash ? 'done' : open ? 'open' : 'default', tag: 'span', cls: 'pc-share' },
        html`${P.button('Share', { icon: 'export', chevron: true, flashKey: fk, action: ['proto.menu', { anchor }], anchor, expanded: open, attrs: { 'data-primitive': 'pull-down-button', 'aria-haspopup': 'menu', 'data-variant': 'toolbar' } })}${exported ? C.inlineStatus(exported, { variant: 'trailing', actionLabel: 'Show in Finder', action: ['proto.flash', { key: fk, text: 'Opened Finder' }] }) : ''}`);
    }
    return comp('share-menu', { variant, state: flash ? 'done' : open ? 'open' : 'default', tag: 'span', cls: 'pc-share' },
      html`${flash ? C.inlineStatus(flash, { variant: 'on-label' }) : ''}${P.iconButton('export', { label: variant === 'section' ? 'Share ' + (o.scope || '') : 'Share', size: 'inline', action: ['proto.menu', { anchor }], anchor, attrs: { 'data-primitive': 'pull-down-button', 'aria-haspopup': 'menu' } })}`);
  };
  NP.on('share.copy', (a) => {
    try { navigator.clipboard && navigator.clipboard.writeText('Noter prototype: sample outputs of “Planning: VHI 8.0 drawer redesign”').catch(() => {}); } catch (e) { /* */ }
    NP.flash(a.fk, a.text, 2000);
  });

  /* ---------------- 26. Version switcher ----------------
     {versions:[{id,label}], current, key, variant:'section'|'caption'} */
  C.versionSwitcher = (o) => {
    o = o || {};
    const versions = o.versions || [];
    if (versions.length < 2) return '';
    const variant = o.variant || 'section';
    const opts = versions.map((v) => ({ value: v.id, label: variant === 'caption' ? (v.short || v.label) : v.label })).concat([{ value: '__compare', label: 'Compare…' }]);
    return comp('version-switcher', { variant, state: o.current === 'edit' ? 'edited-current' : 'several-versions', tag: 'span', cls: 'pc-ver' },
      P.popup(opts, o.current, { variant: 'inline', label: 'Version', id: 'ver-' + (o.key || 'x'), action: ['ver.pick', { key: o.key }] }));
  };
  NP.on('ver.pick', (a) => {
    const l = L();
    l.versions = l.versions || {};
    if (a.value === '__compare') { l.compare = l.compare || {}; l.compare[a.key] = !l.compare[a.key]; return; }
    l.versions[a.key] = a.value;
  });
  C.versionOf = (key, dflt) => ((L().versions || {})[key] || dflt);
  C.compareOn = (key) => !!((L().compare || {})[key]);

  /* ---------------- 27. Diff view ----------------
     {before, after, variant:'inline'|'side-by-side'|'transcript-marks', title} */
  const diffWords = (a, b) => {
    const A = String(a || '').split(/(\s+)/), B = String(b || '').split(/(\s+)/);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: 'eq', s: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: A[i] }); i++; }
      else { out.push({ t: 'ins', s: B[j] }); j++; }
    }
    while (i < n) out.push({ t: 'del', s: A[i++] });
    while (j < m) out.push({ t: 'ins', s: B[j++] });
    return out;
  };
  C.diffView = (o) => {
    o = o || {};
    const variant = o.variant || 'inline';
    const parts = diffWords(o.before, o.after);
    const changed = parts.filter((p) => p.t !== 'eq' && p.s.trim()).length;
    const head = html`<div class="pc-diff__head">${icon('history', { size: 12 })}${changed ? plural(changed, 'word') + ' changed' : 'No differences'}${o.title ? html` · <span class="np-dim">${o.title}</span>` : ''}</div>`;
    const seg = (p) => (p.t === 'eq' ? p.s : p.t === 'ins' ? html`<ins class="np-ins">${p.s}</ins>` : html`<del class="np-del">${p.s}</del>`);
    if (variant === 'side-by-side') {
      return comp('diff-view', { variant, state: changed ? 'changes' : 'no-changes', cls: 'pc-diff pc-diff--side', attrs: { lang: o.lang } },
        html`${head}<div class="pc-diff__cols"><div><div class="pc-diff__colh">Before</div><p>${parts.filter((p) => p.t !== 'ins').map(seg)}</p></div><div><div class="pc-diff__colh">After</div><p>${parts.filter((p) => p.t !== 'del').map(seg)}</p></div></div>`);
    }
    return comp('diff-view', { variant, state: changed ? 'changes' : 'no-changes', cls: 'pc-diff' + (o.mono ? ' np-mono' : ''), attrs: { lang: o.lang } }, html`${head}<p class="pc-diff__text">${parts.map(seg)}</p>`);
  };

  /* ---------------- 25. Prompt editor ----------------
     {value, variant:'editable'|'read-only', key, caption, edited, diffWith, bind} */
  C.promptEditor = (o) => {
    o = o || {};
    const variant = o.variant || 'editable';
    const key = o.key || 'prompt';
    const diffOn = !!((L().promptDiff || {})[key]);
    const state = o.state || (diffOn ? 'diff-mode' : o.edited ? 'edited' : variant === 'read-only' ? 'read-only' : 'editing');
    const head = html`<div class="pc-prompt__head"><span class="np-mono pc-prompt__cap">${o.caption || 'prompt.md'}</span>${o.edited ? P.badge('Edited', { kind: 'status', tone: 'neutral' }) : ''}${o.versionSwitcher || ''}<span class="np-tb__spacer"></span>${o.diffWith != null ? P.button(diffOn ? 'Hide Diff' : 'Diff', { size: 'small', variant: 'quiet', action: ['prompt.diff', { key }], attrs: { 'aria-pressed': String(diffOn) } }) : ''}</div>`;
    let body;
    if (state === 'generating') body = html`<div class="pc-skel pc-prompt__area"><div class="pc-skel__line" style="width:70%"></div><div class="pc-skel__line" style="width:88%"></div><div class="pc-skel__line" style="width:52%"></div></div>`;
    else if (diffOn) body = html`<div class="pc-prompt__area is-diff"><div class="pc-prompt__diffnote">Showing changes</div>${C.diffView({ before: o.diffWith, after: o.value, mono: true })}</div>`;
    else if (variant === 'read-only') body = html`<pre class="np-mono pc-prompt__area is-ro" tabindex="0">${o.value}</pre>`;
    else body = html`<textarea class="np-mono pc-prompt__area" spellcheck="false" id="${'prompt-' + key}" aria-label="Prompt"${attrs({ 'data-proto-bind': o.bind, 'data-proto-live': o.live ? true : null, 'data-component': P.PRIM, 'data-primitive': 'text-field', 'data-variant': 'multi' })}>${o.value}</textarea>`;
    return comp('prompt-editor', { variant, state, cls: 'pc-prompt' }, html`${head}${body}`);
  };
  NP.on('prompt.diff', (a) => { const l = L(); l.promptDiff = l.promptDiff || {}; l.promptDiff[a.key] = !l.promptDiff[a.key]; });

  /* ---------------- 39. Change row ---------------- */
  const ACTOR_LABEL = (c) => (c.actor === 'You' ? 'you' : /job/i.test(c.actor) ? 'job: ' + c.actor.replace(/ job$/i, '').toLowerCase() : c.actor === 'Noter' ? 'model: Claude Code' : c.actor);
  C.changeRow = (c, o) => {
    o = o || {};
    const l = L();
    l.undone = l.undone || {}; l.expanded = l.expanded || {}; l.diffOpen = l.diffOpen || {};
    const undone = l.undone[c.id];
    const isBatch = !!c.batch;
    const isModel = c.kind === 'outputs' || c.kind === 'model';
    const failed = c.kind === 'failed';
    const variant = o.variant || (undone ? 'undone' : failed ? 'failed-run' : isBatch ? 'batch' : isModel ? 'model-run' : 'single');
    const open = l.expanded[c.id];
    const diffOpen = l.diffOpen[c.id];
    const busy = NP.flashed('undoing-' + c.id);
    return comp('change-row', { variant, state: busy ? 'undoing' : undone ? 'undone' : open ? 'expanded' : isBatch ? 'collapsed' : 'default', tag: 'li', cls: 'pc-chg' + (undone ? ' is-undone' : '') },
      html`<span class="pc-chg__time np-tnum">${c.at}</span>
      <div class="pc-chg__main">
        <div class="pc-chg__line"><span class="pc-chg__actor">${ACTOR_LABEL(c)}</span>${failed ? icon('error', { size: 12, cls: 'pc-chg__err' }) : ''}<span class="pc-chg__what">${c.what}</span>${isBatch ? P.badge('batch · ' + c.batch, { kind: 'kind', tone: 'neutral' }) : ''}</div>
        ${c.target ? html`<div class="pc-chg__meta">${c.target}${isModel ? ' · skill summary.md v3 · $0.31' : ''}</div>` : ''}
        ${undone ? html`<div class="pc-chg__meta">Undone by you at 10:53 · ${P.link('Redo', { action: ['chg.redo', { id: c.id }] })}</div>` : ''}
        ${diffOpen && c.before ? C.diffView({ before: c.before, after: c.after }) : ''}
        ${isBatch ? html`<div>${P.disclosure(open ? 'Hide changes' : 'Show ' + Math.min(50, c.batch) + ' changes', open, { variant: 'row', action: ['chg.toggle', { id: c.id }] })}</div>` : ''}
        ${isBatch && open ? html`<ul class="pc-chg__recs">${[['Planning: VHI 8.0 drawer redesign', '00:21:12', 'шаман', 'shaman'], ['Backend sync', '00:12:40', 'Shaman', 'shaman'], ['Backend sync', '00:31:02', 'шамана', 'shaman'], ['Cross-team QA sync', '00:05:51', 'sha man', 'shaman']].map((r) => html`<li><span class="np-dim np-tnum">${r[1]}</span> ${r[0]} · ${C.diffView({ before: r[2], after: r[3] })}</li>`)}${c.batch > 4 ? html`<li>${P.button('Show 50 More', { size: 'small', variant: 'quiet', action: ['proto.flash', { key: 'proto', text: 'Prototype shows the first rows only' }] })}</li>` : ''}</ul>` : ''}
      </div>
      <div class="pc-chg__actions">
        ${c.before ? P.button('Diff', { size: 'small', variant: 'quiet', action: ['chg.diff', { id: c.id }] }) : ''}
        ${undone ? P.button('Redo', { size: 'small', action: ['chg.redo', { id: c.id }] }) : P.button('Undo', { size: 'small', action: ['chg.undo', { id: c.id }], loading: !!busy })}
        ${c.open ? P.button('Open', { size: 'small', variant: 'quiet', action: c.open }) : ''}
      </div>`);
  };
  NP.onMany({
    'chg.toggle': (a) => { const l = L(); l.expanded[a.id] = !l.expanded[a.id]; },
    'chg.diff': (a) => { const l = L(); l.diffOpen[a.id] = !l.diffOpen[a.id]; },
    'chg.undo': (a) => {
      const l = L(); const c = D.changes.concat(NP.data.callChanges || []).find((x) => x.id === a.id);
      if (c && c.batch) { NP.flash('undoing-' + a.id, 'Undoing', 700); setTimeout(() => { l.undone[a.id] = true; NP.undo('Undone ' + plural(c.batch, 'change'), { context: c.what, label: 'Redo', where: 'any', action: 'chg.redo', args: { id: a.id } }); NP.render(); }, 700); return; }
      l.undone[a.id] = true;
      NP.undo('Undone: ' + (c ? c.what : 'change'), { label: 'Redo', where: 'any', action: 'chg.redo', args: { id: a.id } });
    },
    'chg.redo': (a) => { const l = L(); l.undone[a.id] = false; },
  });

  /* ---------------- 40. History timeline ----------------
     {entries, variant:'call'|'person'|'item', key, state:'ready'|'empty'|'loading'|'error', callTitle} */
  C.historyTimeline = (o) => {
    o = o || {};
    const variant = o.variant || 'call';
    const key = 'hist-' + (o.key || variant);
    const f = (L().histFilter = L().histFilter || {})[key] || 'all';
    const job = ((L().histJob = L().histJob || {})[key]) || 'all';
    let entries = o.entries || [];
    const isJob = (c) => /job/i.test(c.actor);
    const isModel = (c) => c.actor === 'Noter' || c.kind === 'outputs' || c.kind === 'model';
    let list = entries.filter((c) => f === 'all' || (f === 'you' && c.actor === 'You') || (f === 'jobs' && isJob(c)) || (f === 'models' && isModel(c)));
    if (job !== 'all') list = list.filter((c) => c.actor === job);
    const jobs = [...new Set(entries.filter(isJob).map((c) => c.actor))];
    const segItems = [{ value: 'all', label: 'All' }, { value: 'you', label: 'You' }, { value: 'jobs', label: 'Jobs' }, { value: 'models', label: 'Models' }];
    const filterCtl = variant === 'item'
      ? P.popup(segItems, f, { label: 'Show changes by', action: ['hist.filter', { key }], id: key + '-actor' })
      : P.segmented(segItems, f, { variant: 'option', label: 'Show changes by', action: ['hist.filter', { key }] });
    const filters = html`<div class="pc-hist__filters">${filterCtl}${jobs.length && variant !== 'item' ? P.popup([{ value: 'all', label: 'All jobs' }].concat(jobs.map((j) => ({ value: j, label: j }))), job, { label: 'Job', action: ['hist.job', { key }], id: key + '-job' }) : ''}<span class="np-tb__spacer"></span>${variant === 'call' ? P.button('Export Log…', { size: 'small', action: ['dlg.exportLog', { scope: o.callTitle ? '“' + o.callTitle + '”' : 'this call' }] }) : ''}</div>`;
    let body;
    const state = o.state || (entries.length === 0 ? 'empty' : list.length === 0 ? 'filtered-empty' : 'ready');
    if (state === 'empty') body = C.emptyState({ variant: 'section', title: 'No changes yet' });
    else if (state === 'loading') body = html`<div class="pc-skel">${[1, 2, 3].map(() => raw('<div class="pc-skel__line" style="width:90%"></div>'))}</div>`;
    else if (state === 'error') body = C.inlineBanner({ severity: 'error', text: 'Couldn’t read the history of this call.', actions: [{ label: 'Try Again', action: ['proto.flash', { key: 'proto', text: 'Retried' }] }] });
    else if (state === 'filtered-empty') body = C.emptyState({ variant: 'section', title: 'No changes by ' + (f === 'you' ? 'you' : f) + ' in this history' });
    else {
      const groups = [];
      list.forEach((c) => { const g = groups.find((x) => x.day === c.day); if (g) g.items.push(c); else groups.push({ day: c.day, items: [c] }); });
      body = groups.map((g) => html`<div class="pc-hist__group"><h3 class="pc-hist__day">${g.day}</h3><ul class="pc-hist__list">${g.items.map((c) => C.changeRow(c))}</ul></div>`);
    }
    return comp('history-timeline', { variant, state, cls: 'pc-hist pc-hist--' + variant }, html`${filters}${body}`);
  };
  NP.on('hist.filter', (a) => { L().histFilter[a.key] = a.value; });
  NP.on('hist.job', (a) => { L().histJob[a.key] = a.value; });

  /* ---------------- 22. Speaker naming panel ---------------- */
  NP.data.unnamedSpeakers = NP.data.unnamedSpeakers || {
    'c-live': [
      { id: 'Speaker 2', quote: 'Fast, ja. Der Kanal ist da, aber der Reconnect fehlt noch.', lang: 'de', lines: 14, items: 2, suggest: [{ p: 'p-oleg', why: 'From the invite' }, { p: 'p-dmitri' }, { p: 'p-lena' }] },
      { id: 'Speaker 3', quote: 'Я могу взять чеклист для QA, если нужно.', lang: 'ru', lines: 6, items: 0, suggest: [{ p: 'p-lena', why: 'From the invite' }, { p: 'p-oleg' }] },
      { id: 'Speaker 4', quote: 'Sorry, quick one: the 10k-row table needs virtualising first.', lang: 'en', lines: 3, items: 1, suggest: [{ p: 'p-pavel' }] },
    ],
    'c-vendor': [{ id: 'Speaker 2', quote: 'Die Daten bleiben dreißig Tage, danach werden sie gelöscht.', lang: 'de', lines: 22, items: 1, suggest: [{ p: 'p-markus', why: 'From the invite' }] }],
  };
  C.speakerNamingPanel = (o) => {
    o = o || {};
    const callId = o.callId || 'c-live';
    const l = L();
    l.naming = l.naming || {};
    const ns = l.naming[callId] = l.naming[callId] || { named: {}, skipped: {}, pick: {}, hidden: false, voice: {} };
    const all = (NP.data.unnamedSpeakers[callId] || []);
    const open = all.filter((s) => !ns.named[s.id] && !ns.skipped[s.id]);
    const skipped = all.filter((s) => ns.skipped[s.id]);
    const allNamed = all.length && !open.length && !skipped.length;
    if (!all.length) return '';
    if (allNamed && !NP.flashed('naming-all-' + callId)) return '';
    const audio = !o.audioGone;
    if (ns.hidden) {
      return comp('speaker-naming-panel', { variant: 'compact', state: 'hidden', cls: 'pc-name pc-name--compact', region: 'PC-R9' },
        html`<span>${plural(open.length, 'speaker')} not named</span>${P.button('Show', { size: 'small', variant: 'quiet', action: ['name.hide', { callId, v: false }] })}`);
    }
    const rows = open.map((s) => {
      const pick = ns.pick[s.id];
      const flash = NP.flashed('name-' + callId + s.id);
      const voiceEligible = pick && D.person(pick).voiceProfile;
      return html`<li class="pc-name__row" data-state="${pick ? 'suggestion-chosen' : 'unnamed'}">
        <div class="pc-name__label">${C.speakerLabel(s.id, { static: true })}<span class="np-dim">${plural(s.lines, 'line')}</span></div>
        <div class="pc-name__body">
          <q class="pc-name__quote" lang="${s.lang}">${s.quote}</q>
          <div class="pc-name__pick">
            ${audio ? P.button(NP.flashed('sample-' + s.id) ? 'Playing…' : 'Play Sample', { size: 'small', icon: 'play', action: ['name.sample', { id: s.id }] }) : ''}
            ${NP.c('personPicker', { value: pick || null, variant: 'field', key: 'pcname-' + s.id, placeholder: 'Name…', onPick: 'name.pick', args: { callId, id: s.id } })}
            <span class="pc-name__chips">${s.suggest.map((g) => html`<button type="button" class="pc-name__chip${pick === g.p ? ' is-sel' : ''}" aria-pressed="${String(pick === g.p)}" ${act('name.pick', { callId, id: s.id, value: g.p })}>${C.personChip(g.p, { readonly: true })}${g.why ? html`<span class="np-dim">${g.why}</span>` : ''}</button>`)}</span>
          </div>
          ${voiceEligible ? P.checkbox('Also update the voice profile', !!ns.voice[s.id], { bind: 'local.c-items.naming.' + callId + '.voice.' + s.id }) : ''}
        </div>
        <div class="pc-name__acts">${P.button('Name', { size: 'small', variant: 'primary', action: ['name.apply', { callId, id: s.id }], disabled: !pick })}${P.button('Skip', { size: 'small', variant: 'quiet', action: ['name.skip', { callId, id: s.id }] })}</div>
        ${flash ? C.inlineStatus(flash, { variant: 'notice' }) : ''}
      </li>`;
    });
    const results = all.filter((s) => ns.named[s.id] && NP.flashed('named-' + callId + s.id)).map((s) => html`<li class="pc-name__done">${C.inlineStatus(NP.flashed('named-' + callId + s.id), { variant: 'row-outcome', actionLabel: 'Undo', action: ['name.undo', { callId, id: s.id }] })}</li>`);
    const state = allNamed ? 'all-named' : 'unnamed';
    return comp('speaker-naming-panel', { variant: 'full', state, cls: 'pc-name', region: 'PC-R9', tag: 'section', attrs: { 'aria-label': 'Name speakers' } },
      html`<header class="pc-name__head"><h2 class="t-headline">Name speakers · ${open.length} not named</h2><span class="np-tb__spacer"></span>${P.button('Hide ▴', { size: 'small', variant: 'quiet', action: ['name.hide', { callId, v: true }] })}</header>
      ${allNamed ? html`<div>${C.inlineStatus('All speakers named', { variant: 'row-outcome', actionLabel: 'Undo', action: ['name.undoAll', { callId }] })}</div>` : ''}
      <ul class="pc-name__list">${results}${rows}</ul>
      ${skipped.length ? html`<div class="pc-name__skipped">${P.disclosure('Skipped (' + skipped.length + ')', !!ns.skippedOpen, { variant: 'row', action: ['name.toggleSkipped', { callId }] })}${ns.skippedOpen ? html`<ul>${skipped.map((s) => html`<li>${s.id} ${P.button('Name…', { size: 'small', variant: 'quiet', action: ['name.unskip', { callId, id: s.id }] })}</li>`)}</ul>` : ''}</div>` : ''}`);
  };
  const NS = (callId) => L().naming[callId];
  NP.onMany({
    'name.hide': (a) => { NS(a.callId).hidden = a.v; },
    'name.sample': (a) => { NP.flash('sample-' + a.id, 'Playing…', 2000); },
    'name.pick': (a) => { NS(a.callId).pick[a.id] = a.value; },
    'name.skip': (a) => { NS(a.callId).skipped[a.id] = true; },
    'name.unskip': (a) => { NS(a.callId).skipped[a.id] = false; },
    'name.toggleSkipped': (a) => { NS(a.callId).skippedOpen = !NS(a.callId).skippedOpen; },
    'name.apply': (a) => {
      const ns = NS(a.callId); const s = (NP.data.unnamedSpeakers[a.callId] || []).find((x) => x.id === a.id); const p = D.person(ns.pick[a.id]);
      ns.named[a.id] = ns.pick[a.id];
      const msg = `Named ${a.id} as ${p.short} · ${plural(s.lines, 'line')}${s.items ? ', ' + plural(s.items, 'action item') + ' updated' : ''}`;
      NP.flash('named-' + a.callId + a.id, msg, 10000);
      NP.local('call-page').namesUpdated = true;
      const left = (NP.data.unnamedSpeakers[a.callId] || []).filter((x) => !ns.named[x.id] && !ns.skipped[x.id]);
      if (!left.length && !Object.values(ns.skipped).some(Boolean)) NP.flash('naming-all-' + a.callId, 'All speakers named', 10000);
    },
    'name.undo': (a) => { NS(a.callId).named[a.id] = null; delete NP.state.flash['named-' + a.callId + a.id]; },
    'name.undoAll': (a) => { const ns = NS(a.callId); ns.named = {}; delete NP.state.flash['naming-all-' + a.callId]; },
  });

  /* ---------------- shared item actions (contract) ---------------- */
  const saveUndo = (it) => { L().rowUndo[it.id] = snapshot(it); };
  NP.onMany({
    'item.tick': (a) => {
      const it = D.item(a.id); if (!it) return;
      if (a.value === false) { NP.actions['item.untick'](a); return; }
      if (it.status === 'handed-off') { L().askLanded[it.id] = true; return; }
      saveUndo(it);
      const wasSuggested = it.review === 'suggested';
      it.review = 'accepted'; it.status = 'done'; it.doneToday = true;
      rowOutcome(it.id, wasSuggested ? 'Accepted and done' : 'Done');
    },
    'item.untick': (a) => { const it = D.item(a.id); if (!it) return; it.status = 'open'; it.doneToday = false; delete NP.state.flash['row-' + it.id]; },
    'item.landed': (a) => {
      const it = D.item(a.id); L().askLanded[a.id] = false;
      if (a.how === 'keep') return;
      saveUndo(it); it.status = 'done'; it.doneToday = true;
      rowOutcome(it.id, a.how === 'landed' ? 'Done · handoff landed' : 'Done another way');
    },
    'item.accept': (a) => { const it = D.item(a.id); if (!it) return; saveUndo(it); it.review = 'accepted'; rowOutcome(it.id, 'Accepted', 4000); focusNext(it); },
    'item.reject': (a) => { const it = D.item(a.id); if (!it) return; saveUndo(it); it.review = 'rejected'; rowOutcome(it.id, 'Rejected'); focusNext(it); },
    'item.restore': (a) => { const it = D.item(a.id); if (!it) return; it.review = 'suggested'; },
    'item.reopen': (a) => { const it = D.item(a.id); if (!it) return; saveUndo(it); it.status = 'open'; rowOutcome(it.id, 'Reopened'); },
    'item.undoRow': (a) => {
      const it = D.item(a.id); const s = L().rowUndo[a.id];
      if (it && s) Object.assign(it, s);
      delete NP.state.flash['row-' + a.id];
    },
    'item.inspect': (a) => { NP.openInspector('item', { itemId: a.id }); return false; },
    'item.handoff': (a) => { NP.openInspector('handoff', { itemId: a.id }); return false; },
    'item.edit': (a) => { const l = L(); l.editing = a.id; delete l.edit[a.id]; },
    'item.editCancel': () => { L().editing = null; },
    'item.save': (a) => {
      const l = L(); const it = D.item(a.id); const e = l.edit[a.id];
      if (it && e) { saveUndo(it); Object.assign(it, { text: e.text, owner: e.owner, due: e.due, engineering: !!e.engineering, review: 'accepted' }); }
      l.editing = null; rowOutcome(a.id, 'Saved and accepted', 4000);
    },
    'item.toggleRejected': (a) => { const l = L(); l.rejectedOpen[a.key] = !l.rejectedOpen[a.key]; },
    'item.acceptMany': (a) => {
      const ids = a.ids || [];
      const prev = ids.map((id) => [id, D.item(id).review]);
      ids.forEach((id) => { D.item(id).review = 'accepted'; });
      NP.undo(a.message || ('Accepted ' + plural(ids.length, 'item')), { where: a.where || 'call-page', action: 'item.restoreMany', args: { prev, ids, message: a.message, where: a.where }, context: a.context });
      NP.state.undo.redoAction = 'item.acceptMany';
      NP.state.undo.redoMessage = 'Undone: ' + (a.message || 'accepted items').toLowerCase();
    },
    'item.restoreMany': (a) => { (a.prev || []).forEach(([id, r]) => { const it = D.item(id); if (it) it.review = r; }); },
  });
  const focusNext = (it) => {
    const l = NP.local('call-page');
    const next = D.items.find((x) => x.callId === it.callId && x.review === 'suggested' && x.id !== it.id);
    l.focus = next ? next.id : null;
  };
})();
