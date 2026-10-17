/* =====================================================================
   Screen — People and Person page (cpt-noter-component-screen-people)
   'people' = People list (PL-R1..R3); 'person' = Person page (PE-R1..R6, Calls, History)
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, C, data: D, region } = NP;
  const fold = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss');
  const PL = () => NP.dLocal('people', () => ({ q: '', sel: {}, named: {}, extra: [], removed: {} }));
  const PE = () => NP.dLocal('person', () => ({ voice: {}, merged: false }));
  const facts = (id) => D.peopleFacts[id] || { theirOpen: 0, youOwe: 0, lastCall: '—', sub: '', langs: '' };
  const peopleList = () => D.people.filter((p) => !p.you && !PL().removed[p.id]);
  const matches = (p, q) => !q || [p.name, p.short].concat(p.aliases || []).some((n) => fold(n).includes(fold(q)));

  /* ---------- New person form (person-picker popover, D92) ---------- */
  NP.overlay('ppl-new', {
    width: 320,
    render: (p) => {
      const f = NP.local('pplnew');
      const name = (f.name || '').trim();
      const dup = name && D.people.find((x) => !x.you && fold(x.name).split(' ')[0] === fold(name).split(' ')[0] && fold(name).split(' ').length === 1);
      return comp('person-picker', { variant: 'new-person-form', state: dup ? 'name-exists' : 'default', cls: 'np-pop__body' }, html`
        <div class="np-pop__title">${p.speaker ? 'New person for ' + (p.label || p.speaker) : 'New person'}</div>
        ${P.textField({ id: 'ppl-new-name', label: 'Name', showLabel: true, value: f.name || p.name || '', bind: 'local.pplnew.name', live: true })}
        ${P.textField({ id: 'ppl-new-email', label: 'Email', showLabel: true, value: f.email || '', bind: 'local.pplnew.email' })}
        ${P.textField({ id: 'ppl-new-role', label: 'Role', showLabel: true, value: f.role || '', bind: 'local.pplnew.role' })}
        ${dup ? html`<div class="pe-dup">${icon('info', { size: 13 })}<span>A person called “${name}” already exists: ${dup.short} (${dup.role})</span></div><div class="np-pop__actions">${P.button('Use ' + dup.short, { size: 'small', action: ['ppl.useExisting', { id: dup.id, speaker: p.speaker }] })}${P.button('Create Anyway', { size: 'small', variant: 'primary', action: ['ppl.create', p] })}</div>`
          : html`<div class="np-pop__actions">${P.button(p.speaker ? 'Create and Name' : 'Create', { variant: 'primary', size: 'small', disabled: !name, action: ['ppl.create', p] })}</div>`}`);
    },
  });

  /* ---------- Name an unnamed speaker (speaker-label popover with person picker) ---------- */
  NP.overlay('ppl-name-speaker', {
    width: 320,
    render: (p) => {
      const f = NP.local('pplname');
      const q = f.q || '';
      const list = peopleList().filter((x) => matches(x, q)).slice(0, 5);
      return comp('speaker-label', { variant: 'unresolved', state: 'popover-open', cls: 'np-pop__body' }, html`
        <div class="np-pop__title">Name ${p.label}</div>
        <div class="np-dim t-callout" lang="${p.lang}">${p.sample}</div>
        ${comp('person-picker', { variant: 'field', state: q ? 'typing' : 'default', cls: 'pe-picker' }, html`
          ${P.textField({ id: 'ppl-name-q', placeholder: 'Name…', value: q, bind: 'local.pplname.q', live: true, ariaLabel: 'Name' })}
          <div class="pe-picker__list" role="listbox">${list.map((x) => html`<button type="button" role="option" class="pe-picker__opt" ${act('ppl.name', { speaker: p.id, person: x.id })}><span class="np-person__ini">${x.initials}</span><span>${x.short}</span><span class="np-dim">${x.role}</span></button>`)}
          ${q && !list.length ? html`<div class="np-dim pe-picker__none">No one called “${q}”</div>` : ''}
          ${q ? html`<button type="button" class="pe-picker__opt pe-picker__new" ${act('ppl.newFor', { speaker: p.id, name: q, anchor: p.anchor })}>${icon('plus', { size: 12 })}<span>New Person “${q}”…</span></button>` : ''}</div>`)}
        <div class="np-dim t-callout">Names ${p.label} in all ${p.calls} calls as one change you can undo.</div>`);
    },
  });

  /* ---------- People list ---------- */
  NP.screen('people', {
    idKey: 'people',
    section: 'people',
    variant: () => 'people-list',
    title: 'People',
    subtitle: (ctx) => (ctx.demo === 'empty' ? 'No people yet' : `${peopleList().length} people`),
    search: false,
    toolbarActions: (ctx) => html`${P.searchField({ id: 'pl-search', placeholder: 'Search people', bind: 'local.people.q', value: PL().q, live: true, cls: 'pe-search' })}${P.iconButton('plus', { label: 'Add Person', anchor: 'pl-add', action: ['ppl.addPop', { anchor: 'pl-add' }] })}`,
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'empty', label: 'No people yet' },
      { id: 'no-match', label: 'No match for “Lena”' },
      { id: 'named', label: 'Speaker named (undo strip)' },
      { id: 'new-person', label: 'New person form · name exists' },
    ],
    onDemo: (id) => {
      const l = PL();
      l.q = id === 'no-match' ? 'Lenara' : '';
      if (id === 'named') { l.named = { 'u-2': 'p-dmitri' }; NP.undo('Named Speaker 2 as Dmitri S. in 3 calls', { where: 'people', action: 'ppl.unname', args: { speaker: 'u-2' } }); }
      if (id === 'default') l.named = {};
      if (id === 'new-person') { NP.local('pplnew').name = 'Lena'; NP.state.popover = { id: 'ppl-new', anchor: 'pl-add', props: {} }; }
    },
    render: (ctx) => {
      const l = PL();
      if (ctx.demo === 'empty') {
        return region('PL-R2', { label: 'People' }, C.emptyState({ icon: 'people', title: 'No people yet', body: 'People appear when you record calls or add them.', actionLabel: 'Add Person', action: ['ppl.addPop', { anchor: 'pl-add' }] }));
      }
      const q = ctx.demo === 'no-match' ? 'Lenara' : l.q;
      const list = peopleList().filter((p) => matches(p, q)).sort((a, b) => a.short.localeCompare(b.short));
      const unnamed = D.unnamedVoices.filter((u) => !l.named[u.id] && matches({ name: u.label, short: u.label }, q));
      const nSel = Object.keys(l.sel).filter((k) => l.sel[k]).length;
      return html`
        ${C.undoStrip({ where: 'people' })}
        ${region('PL-R2', { label: 'People' }, list.length ? P.table({ variant: 'sortable', label: 'People', cls: 'lb-table pe-table' }, html`<thead><tr>${P.th('Name', { sort: 'asc' })}${P.th('Role · org')}${P.th('Their open items', { width: '130px' })}${P.th('You owe', { width: '90px' })}${P.th('Last call', { width: '100px' })}${P.th('Voice profile', { width: '110px' })}</tr></thead>
          <tbody>${list.map((p) => { const f = facts(p.id); const sel = !!l.sel[p.id]; return html`<tr class="pe-row${sel ? ' is-sel' : ''}" aria-selected="${String(sel)}" data-proto-anchor="pl-${p.id}" data-pe-row="${p.id}" ${act('ppl.select', { id: p.id })}>
            <td>${C.personChip(p.id)}</td><td class="np-muted">${p.role}${p.org ? ' · ' + p.org : ''}</td><td class="np-tnum">${f.theirOpen || ''}</td><td class="np-tnum">${f.youOwe || ''}</td><td>${f.lastCall}</td>
            <td>${p.voiceProfile ? html`<span title="Voice profile on">${icon('wave', { size: 14, label: 'Voice profile on' })}</span>` : ''}</td></tr>`; })}</tbody>`)
          : C.emptyState({ variant: 'filtered', title: `No people match “${q}”`, actionLabel: 'Clear Search', action: ['ppl.clearQ'] }))}
        ${nSel >= 2 ? html`<p class="lb-hint" data-proto-chrome>${nSel} selected · right-click for Merge 2 People…</p>` : list.length ? html`<p class="lb-hint" data-proto-chrome>Click selects (⌘-click adds) · double-click or a name opens the Person page</p>` : ''}
        ${unnamed.length ? region('PL-R3', { label: 'Unnamed speakers', cls: 'pe-unnamed' }, html`<h2 class="np-section-h">Unnamed speakers <span class="np-dim">· ${unnamed.length}</span></h2>
          <div class="pe-unnamed__list">${unnamed.map((u) => html`<div class="pe-urow">${C.speakerLabel(u.label, { static: true })}<span class="np-muted">· ${u.calls} call${u.calls === 1 ? '' : 's'} · last on ${u.last}</span><span class="np-dim pe-urow__sample" lang="${u.lang}">${u.sample}</span><span class="np-tb__spacer"></span>${P.button('Name…', { size: 'small', anchor: 'pl-name-' + u.id, action: ['ppl.namePop', { anchor: 'pl-name-' + u.id, id: u.id }] })}</div>`)}</div>`) : ''}`;
    },
  });

  /* ---------- Person page ---------- */
  const personOf = (ctx) => D.person(ctx.params.id || 'p-anna');
  const tab = (ctx) => ctx.params.tab || 'overview';
  const callsWith = (p) => D.calls.filter((c) => c.people.includes(p.id)).sort((a, b) => D.callSortKey(b) - D.callSortKey(a));
  const voiceOn = (p, ctx) => {
    const v = PE().voice[p.id];
    if (ctx.demo === 'voice-off') return v === true;
    return v == null ? !!p.voiceProfile : v;
  };
  const historyFor = (p) => {
    const nm = p.short.split(' ')[0];
    const own = D.changes.filter((c) => (c.what + c.target).includes(nm));
    const calls = callsWith(p).map((c) => c.title);
    return own.concat(D.changes.filter((c) => !own.includes(c) && calls.includes(c.target)));
  };

  const overview = (p, ctx) => {
    if (ctx.demo === 'no-calls') return region('PE-R2', { label: 'Overview' }, C.emptyState({ variant: 'large', icon: 'person', title: `No calls with ${p.short} yet`, body: 'Their commitments, questions and topics appear after your first call together.' }));
    const commit = D.items.filter((i) => i.owner === p.id && i.kind === 'action' && i.status !== 'done');
    const asked = D.items.filter((i) => i.askedBy === p.id && i.status !== 'done');
    const calls = callsWith(p);
    const topics = [...new Set(calls.flatMap((c) => c.topics || []))];
    const f = facts(p.id);
    const on = voiceOn(p, ctx);
    const left = html`
      ${region('PE-R2', { label: 'Open commitments', cls: 'pe-block' }, html`<h2 class="np-section-h">Open commitments <span class="np-dim">· ${commit.length}</span></h2>${commit.length ? html`<div class="lb-items">${commit.map((i) => NP.c('actionItemRow', i, { variant: 'compact', key: 'pe', showCall: true, showReview: true }))}</div>` : C.emptyState({ variant: 'section', title: 'Nothing open' })}`)}
      ${region('PE-R3', { label: 'Asked you', cls: 'pe-block' }, html`<h2 class="np-section-h">Asked you <span class="np-dim">· ${asked.length} open</span></h2>${asked.length ? html`<div class="lb-items">${asked.map((i) => NP.c('actionItemRow', i, { variant: 'compact', key: 'pe', showCall: true }))}</div>` : C.emptyState({ variant: 'section', title: 'Nothing they are waiting for' })}`)}
      ${region('PE-R4', { label: 'Topics you keep returning to', cls: 'pe-block' }, html`<h2 class="np-section-h">Topics you keep returning to</h2><div class="pe-topics">${topics.length ? topics.map((t) => C.topicChip(t, { variant: 'count', showMerge: false })) : C.emptyState({ variant: 'section', title: 'No recurring topics yet' })}</div>`)}`;
    const right = html`
      ${region('PE-R5', { label: 'Identity', cls: 'pe-block pe-identity' }, html`<h2 class="np-section-h">Identity</h2>
        <dl class="np-kv">
          <dt>Voice profile</dt><dd>${on ? html`<div>On since ${f.voiceSince || '3 Oct'} · ${f.voiceDetail || '1 profile matched in 4 calls'}</div><div class="pe-kvact">${P.button('Delete Profile…', { size: 'small', variant: 'destructive', action: ['ppl.deleteVoice', { id: p.id }] })}</div>` : html`<div class="np-muted">Off</div><div class="pe-kvact">${P.button('Set Up Voice Profile…', { size: 'small', action: ['ppl.setupVoice', { id: p.id }] })}</div>`}</dd>
          <dt>Names</dt><dd>${[...new Set([p.short].concat(p.aliases || []))].join(', ')}</dd>
          <dt>Languages</dt><dd>${f.langs || '—'}</dd>
          ${p.email ? html`<dt>Email</dt><dd class="pe-sel">${p.email}</dd>` : ''}
        </dl>`)}
      ${region('PE-R6', { label: 'Last calls', cls: 'pe-block' }, html`<h2 class="np-section-h">Last calls</h2><div class="pe-calls">${calls.slice(0, 5).map((c) => C.callRow(c, { variant: 'compact' }))}</div><div>${P.button('Show All', { size: 'small', action: ['ppl.tab', { tab: 'calls' }] })}</div>`)}`;
    return html`<div class="pe-cols"><div class="pe-col">${left}</div><div class="pe-col">${right}</div></div>`;
  };
  const callsTab = (p) => {
    const calls = callsWith(p);
    const l = NP.local('personCalls', { sel: {} });
    return region('PE-CALLS', { label: 'Calls' }, P.table({ variant: 'sortable', label: 'Calls with ' + p.short, cls: 'lb-table' }, html`<thead><tr>${P.th('When', { sort: 'desc', width: '120px' })}${P.th('Call')}${P.th('Type', { width: '120px' })}${P.th('Length', { width: '80px' })}${P.th('Open', { width: '60px' })}<th style="width:200px"><span class="np-sr">Status</span></th><th style="width:36px"></th></tr></thead><tbody>${calls.map((c) => C.callRow(c, { variant: 'person', key: 'personCalls', selected: !!l.sel[c.id], selectAction: 'ppl.selCall' }))}</tbody>`));
  };
  const historyTab = (p, ctx) => {
    const entries = ctx.demo === 'no-history' ? [] : historyFor(p);
    return html`${C.undoStrip({ where: 'person' })}${region('PE-HISTORY', { label: 'History' }, entries.length ? NP.c('historyTimeline', { entries, variant: 'person', filters: ['All', 'You', 'Jobs', 'Models'], key: 'pe-' + p.id }) : C.emptyState({ variant: 'first-use', icon: 'history', title: 'No changes yet', body: `Changes to ${p.short}'s items, names and voice profile appear here, each with Undo.` }))}`;
  };

  NP.screen('person', {
    idKey: 'people',
    section: 'people',
    variant: () => 'person-page',
    title: (ctx) => (PE().merged && personOf(ctx).id === 'p-anna' ? 'Anna Kuznetsova' : personOf(ctx).short),
    subtitle: (ctx) => facts(personOf(ctx).id).sub || personOf(ctx).role,
    toolbarCenter: (ctx) => P.segmented([{ value: 'overview', label: 'Overview' }, { value: 'calls', label: 'Calls' }, { value: 'history', label: 'History' }], tab(ctx), { label: 'View', action: ['ppl.tab'] }),
    toolbarActions: (ctx) => P.pulldown('More', [
      { label: 'Edit Details…', action: ['ppl.edit', { id: personOf(ctx).id }] },
      { label: 'Merge With…', action: ['ppl.mergeSheet', { from: personOf(ctx).id }] },
      { divider: true },
      { label: 'Delete Person…', destructive: true, action: ['ppl.deleteAsk', { id: personOf(ctx).id }] },
    ], { iconOnly: true, icon: 'ellipsis', anchorId: 'pe-more', ariaLabel: 'More', size: 'toolbar' }),
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'voice-off', label: 'Voice profile off' },
      { id: 'no-calls', label: 'No calls with this person yet' },
      { id: 'no-history', label: 'History · No changes yet' },
      { id: 'merged', label: 'Two entries merged (undo strip)' },
      { id: 'edit', label: 'Edit Details sheet' },
    ],
    onDemo: (id, ctx) => {
      const pid = (ctx && ctx.params && ctx.params.id) || 'p-anna';
      if (id === 'no-history') NP.go('person', { id: pid, tab: 'history' }, { replace: true });
      else if (ctx && ctx.params && ctx.params.tab && ctx.params.tab !== 'overview') NP.go('person', { id: pid }, { replace: true });
      if (id === 'voice-off') PE().voice[pid] = false; else if (id === 'default') PE().voice = {};
      if (id === 'merged') { PE().merged = true; NP.go('person', { id: 'p-anna' }, { replace: true }); NP.undo('Merged Anna K. into Anna Kuznetsova', { where: 'person-ov', action: 'ppl.unmerge', args: {} }); }
      if (id === 'edit') NP.actions['ppl.edit']({ id: pid });
    },
    render: (ctx) => {
      const p = personOf(ctx);
      const t = tab(ctx);
      return html`${t === 'overview' ? C.undoStrip({ where: 'person-ov' }) : ''}${t === 'calls' ? callsTab(p) : t === 'history' ? historyTab(p, ctx) : overview(p, ctx)}`;
    },
  });

  /* ---------- sheets (Dialogs screen) ---------- */
  NP.overlay('ppl-edit', {
    width: 520,
    title: () => 'Edit details',
    render: (props) => {
      const p = D.person(props.id); const f = NP.local('ppledit');
      const changed = f.name != null && f.name.trim() && f.name.trim() !== p.name;
      return html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="edit-details" data-state="${changed ? 'name-changed' : 'open'}">
        <div class="np-sheet__head"><div class="np-sheet__title">Edit details</div></div>
        <div class="np-sheet__body pe-form">
          ${P.textField({ id: 'pe-ed-name', label: 'Name', showLabel: true, value: f.name != null ? f.name : p.name, bind: 'local.ppledit.name', live: true })}
          ${changed ? P.checkbox(`Keep “${p.name}” as an alias`, f.keepAlias !== false, { id: 'pe-ed-keep', bind: 'local.ppledit.keepAlias' }) : ''}
          ${P.textField({ id: 'pe-ed-aka', label: 'Also known as', showLabel: true, value: (p.aliases || []).join(', ') })}
          ${P.textField({ id: 'pe-ed-email', label: 'Email', showLabel: true, value: p.email || '' })}
          <div class="pe-form__2">${P.textField({ id: 'pe-ed-role', label: 'Role', showLabel: true, value: p.role || '' })}${P.textField({ id: 'pe-ed-org', label: 'Organisation', showLabel: true, value: p.org || '' })}</div>
          ${P.textField({ id: 'pe-ed-notes', label: 'Notes', showLabel: true, variant: 'multi', rows: 3, value: '' })}
        </div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button('Save', { variant: 'primary', action: ['ppl.save', { id: p.id }] })}</div></div>`;
    },
  });
  NP.overlay('ppl-merge', {
    width: 540,
    title: () => 'Merge people',
    render: (props) => {
      const a = D.person(props.from || 'p-anna');
      const target = props.to ? D.person(props.to) : null;
      const opts = [{ value: '', label: 'Choose a person…' }].concat(D.people.filter((x) => !x.you && x.id !== a.id).map((x) => ({ value: x.id, label: x.name })));
      const n = D.items.filter((i) => i.owner === a.id).length;
      return html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="merge-people" data-state="${target ? 'preview' : 'choose'}">
        <div class="np-sheet__head"><div class="np-sheet__title">Merge ${a.short} with another entry</div><div class="np-sheet__sub">Use this when one person has two entries. Their calls, items and names move to the person you keep.</div></div>
        <div class="np-sheet__body">
          <div class="pe-form__row"><span class="np-field__label">Keep</span>${NP.c('personPicker', { key: 'merge-' + a.id, variant: 'merge', as: 'field', value: props.to || null, exclude: [a.id], placeholder: 'Choose a person…', onPick: 'ppl.mergeTarget', args: { from: a.id } })}</div>
          ${target ? html`<div class="t-headline">What moves to ${target.name}</div><ul class="lb-movelist"><li>${callsWith(a).length} calls and their speaker labels</li><li>${n} items ${a.short} owns</li><li>The names ${[a.short].concat(a.aliases || []).join(', ')} as aliases</li>${a.voiceProfile ? html`<li>The voice profile</li>` : ''}</ul>` : ''}
        </div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button('Merge', { variant: 'primary', disabled: !target, action: ['ppl.merge', { from: a.id, to: props.to }] })}</div></div>`;
    },
  });
  NP.overlay('ppl-voice', {
    width: 480,
    title: () => 'Voice profile',
    render: (props) => {
      const p = D.person(props.id);
      return html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="voice-profile" data-state="open">
        <div class="np-sheet__head"><div class="np-sheet__title">Create a voice profile for ${p.short}?</div><div class="np-sheet__sub">Noter learns ${p.short}'s voice from the calls where you named them and recognises it in later calls. The profile stays on this Mac. You can delete it at any time.</div></div>
        <div class="np-sheet__body"><div class="np-muted">Built from 6 named calls · about 40 minutes of speech</div></div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button('Create Profile', { variant: 'primary', action: ['ppl.voiceOn', { id: p.id }] })}</div></div>`;
    },
  });
  NP.galleries.dialogs.push(
    { id: 'ppl-merge', label: 'Merge people (sheet)', surface: 'main', open: () => { NP.go('person', { id: 'p-anna' }); NP.openSheet('ppl-merge', { from: 'p-anna', to: 'p-lena' }); } },
    { id: 'ppl-edit', label: 'Edit person details (sheet)', surface: 'main', open: () => { NP.go('person', { id: 'p-pavel' }); NP.local('ppledit').name = 'Pavel Romanov-Smith'; NP.openSheet('ppl-edit', { id: 'p-pavel' }); } },
  );

  /* ---------- actions ---------- */
  NP.onMany({
    'ppl.select': (a, ev) => { const s = PL().sel; if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey)) s[a.id] = !s[a.id]; else { Object.keys(s).forEach((k) => { s[k] = false; }); s[a.id] = true; } },
    'ppl.selCall': (a) => { const s = NP.local('personCalls', { sel: {} }).sel; Object.keys(s).forEach((k) => { s[k] = false; }); s[a.id] = true; },
    'ppl.clearQ': () => { PL().q = ''; NP.state.demo.people = 'default'; },
    'ppl.addPop': (a) => { NP.local('pplnew').name = ''; NP.state.popover = { id: 'ppl-new', anchor: a.anchor, props: {} }; NP.state.menu = null; },
    'ppl.create': (p) => {
      const f = NP.local('pplnew');
      const name = String(f.name || p.name || '').trim();
      if (!name) return;
      const parts = name.split(/\s+/);
      const id = 'p-new-' + Date.now();
      D.people.push({ id, name, short: parts.length > 1 ? parts[0] + ' ' + parts[1][0] + '.' : name, initials: D.initials(name), role: f.role || 'Role not set', email: f.email, aliases: [] });
      D.peopleFacts[id] = { theirOpen: 0, youOwe: 0, lastCall: p.speaker ? D.unnamedVoices.find((u) => u.id === p.speaker).last : '—', sub: f.role || 'New person' };
      NP.state.popover = null; NP.state.local.pplnew = {};
      if (p.speaker) { PL().named[p.speaker] = id; const u = D.unnamedVoices.find((x) => x.id === p.speaker); NP.undo(`Named ${u.label} as ${name} in ${u.calls} call${u.calls === 1 ? '' : 's'}`, { where: 'people', action: 'ppl.unname', args: { speaker: p.speaker } }); }
      else NP.go('person', { id });
      return p.speaker ? undefined : false;
    },
    'ppl.useExisting': (a) => { NP.state.popover = null; if (a.speaker) NP.actions['ppl.name']({ speaker: a.speaker, person: a.id }); else NP.go('person', { id: a.id }); },
    'ppl.namePop': (a) => { const u = D.unnamedVoices.find((x) => x.id === a.id); NP.local('pplname').q = ''; NP.state.popover = { id: 'ppl-name-speaker', anchor: a.anchor, props: Object.assign({ anchor: a.anchor }, u) }; NP.state.menu = null; },
    'ppl.name': (a) => {
      const u = D.unnamedVoices.find((x) => x.id === a.speaker);
      PL().named[a.speaker] = a.person; NP.state.popover = null;
      NP.undo(`Named ${u.label} as ${D.person(a.person).short} in ${u.calls} call${u.calls === 1 ? '' : 's'}`, { where: 'people', action: 'ppl.unname', args: { speaker: a.speaker }, redoAction: 'ppl.rename', context: `${u.calls} calls · last on ${u.last}` });
      NP.state.undo.args.person = a.person;
    },
    'ppl.unname': (a) => { PL().named[a.speaker] = null; },
    'ppl.rename': (a) => { PL().named[a.speaker] = a.person; },
    'ppl.newFor': (a) => { NP.local('pplnew').name = a.name; const u = D.unnamedVoices.find((x) => x.id === a.speaker); NP.state.popover = { id: 'ppl-new', anchor: a.anchor, props: { speaker: a.speaker, name: a.name, label: u.label } }; },
    'ppl.tab': (a) => { const r = NP.state.route; NP.go('person', Object.assign({}, r.params, { tab: a.value || a.tab }), { replace: true }); return false; },
    'ppl.setupVoice': (a) => { if (NP.overlays['voice-profile']) NP.openSheet('voice-profile', { personId: a.id, id: a.id }); else NP.openSheet('ppl-voice', { id: a.id }); return false; },
    'ppl.voiceOn': (a) => { PE().voice[a.id] = true; NP.state.sheet = null; NP.state.demo.person = 'default'; if (!D.peopleFacts[a.id]) D.peopleFacts[a.id] = {}; D.peopleFacts[a.id].voiceSince = '16 Oct'; D.peopleFacts[a.id].voiceDetail = D.peopleFacts[a.id].voiceDetail || '1 profile, matching from the next call'; },
    'ppl.deleteVoice': (a) => { const p = D.person(a.id); NP.openAlert({ title: `Delete ${p.short}'s voice profile?`, variant: 'destructive', body: 'Noter stops recognising this voice in new calls. Names already given in past calls stay.', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Delete Profile', variant: 'destructive', action: 'ppl.voiceOff', args: { id: a.id } }] }); return false; },
    'ppl.voiceOff': (a) => { PE().voice[a.id] = false; NP.state.alert = null; },
    'ppl.edit': (a) => { NP.state.local.ppledit = {}; NP.openSheet('ppl-edit', { id: a.id }); return false; },
    'ppl.save': (a) => {
      const p = D.person(a.id); const f = NP.local('ppledit');
      const nn = String(f.name || '').trim();
      if (nn && nn !== p.name) { const old = p.name; const parts = nn.split(/\s+/); const short = parts.length > 1 ? parts[0] + ' ' + parts[1][0] + '.' : nn; if (f.keepAlias !== false) [old, p.short].forEach((a) => { if (a !== short && a !== nn && !(p.aliases || []).includes(a)) p.aliases = [a].concat(p.aliases || []); }); p.name = nn; p.short = short; p.initials = D.initials(nn); }
      NP.state.sheet = null; NP.flash('proto', 'Saved');
    },
    'ppl.mergeSheet': (a) => { NP.openSheet('ppl-merge', { from: a.from, to: a.to }); return false; },
    'ppl.mergeTarget': (a) => { NP.state.sheet.props.to = a.value || null; },
    'ppl.merge': (a) => {
      const from = D.person(a.from); const to = D.person(a.to);
      NP.state.sheet = null; PL().removed[a.from] = true;
      NP.go('person', { id: a.to });
      NP.undo(`Merged ${from.short} into ${to.name}`, { where: 'person-ov', action: 'ppl.unmergeP', args: { from: a.from } });
      return false;
    },
    'ppl.unmergeP': (a) => { PL().removed[a.from] = false; },
    'ppl.unmerge': () => { PE().merged = false; },
    'ppl.deleteAsk': (a) => { const p = D.person(a.id); NP.openAlert({ title: `Delete ${p.short}?`, variant: 'destructive', body: 'Their name is removed from every call; the speakers become unnamed again. Their voice profile is deleted. This can\'t be undone.', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Delete', variant: 'destructive', action: 'ppl.delete', args: a }] }); return false; },
    'ppl.delete': (a) => { PL().removed[a.id] = true; NP.state.alert = null; NP.go('people', {}); return false; },
  });

  /* double-click a person row opens the Person page; right-click with two selected offers Merge */
  NP.onAfterRender(() => {
    document.querySelectorAll('.np-desk tr[data-pe-row]').forEach((tr) => {
      const id = tr.getAttribute('data-pe-row');
      tr.addEventListener('dblclick', () => NP.go('person', { id }));
      tr.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const l = PL();
        if (!l.sel[id]) { if (!(ev.metaKey || ev.ctrlKey)) Object.keys(l.sel).forEach((k) => { l.sel[k] = false; }); l.sel[id] = true; }
        const ids = Object.keys(l.sel).filter((k) => l.sel[k]);
        NP.state.popover = null;
        NP.state.menu = { anchor: 'pl-' + id, items: [{ label: 'Open', action: ['nav.go', { screen: 'person', params: { id } }] }, { label: 'Edit Details…', action: ['ppl.edit', { id }] }, { divider: true }, { label: 'Merge 2 People…', disabled: ids.length !== 2, action: ['ppl.mergeSheet', { from: ids[0], to: ids[1] }] }, { divider: true }, { label: 'Delete Person…', destructive: true, action: ['ppl.deleteAsk', { id }] }] };
        NP.render();
      });
    });
  });
})();
