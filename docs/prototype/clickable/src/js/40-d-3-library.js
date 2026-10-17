/* =====================================================================
   Screen — Library (cpt-noter-component-screen-library)
   Views (params.view): calls · search (params.q) · topics · thread (params.topicId)
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, C, data: D, region } = NP;
  const KEY = 'library';
  const L = () => NP.dLocal(KEY, () => ({ filters: blankFilters(), sel: {}, q: null, topicQ: '', more: {}, playing: null, deleted: {}, hidden: {} }));
  const blankFilters = () => ({ people: [], types: [], tags: [], langs: [], date: 'any', open: false });
  const view = (ctx) => ctx.params.view || 'calls';

  /* ---------- filtering ---------- */
  const visibleCalls = (ctx) => {
    const l = L();
    if (ctx.demo === 'empty') return [];
    const f = l.filters;
    let calls = D.calls.filter((c) => !l.deleted[c.id]);
    if (f.people.length) calls = calls.filter((c) => f.people.some((p) => c.people.includes(p)));
    if (f.types.length) calls = calls.filter((c) => f.types.includes(c.type));
    if (f.tags.length) calls = calls.filter((c) => f.tags.some((t) => (c.tags || []).includes(t)));
    if (f.langs.length) calls = calls.filter((c) => f.langs.some((g) => c.languages.includes(g)));
    if (f.date === '7') calls = calls.filter((c) => D.callSortKey(c) >= D.callSortKey({ date: '9 Oct', time: '00:00' }));
    if (f.date === '30') calls = calls.filter((c) => D.callSortKey(c) >= D.callSortKey({ date: '16 Sep', time: '00:00' }));
    if (f.open) calls = calls.filter((c) => c.openItems > 0);
    const s = l.sort || { col: 'when', dir: 'desc' };
    const val = { when: D.callSortKey, call: (c) => c.title, type: (c) => c.type, length: (c) => c.minutes, open: (c) => c.openItems };
    calls = calls.slice().sort((a, b) => { const x = val[s.col](a), y = val[s.col](b); return (x > y ? 1 : x < y ? -1 : 0) * (s.dir === 'asc' ? 1 : -1); });
    return calls;
  };
  const selIds = () => Object.keys(L().sel).filter((k) => L().sel[k]);

  /* ---------- Calls view ---------- */
  const callsView = (ctx) => {
    const l = L();
    const calls = visibleCalls(ctx);
    const s = l.sort || { col: 'when', dir: 'desc' };
    const thSort = (label, col, width) => P.th(label, { sort: s.col === col ? s.dir : null, width, action: ['lib.sort', { col }], cls: 'lb-th' });
    let body;
    if (ctx.demo === 'empty') {
      body = C.emptyState({ variant: 'first-use', icon: 'list', title: 'No calls yet', body: 'Calls you record appear here with their summary, decisions and action items.', actionLabel: NP.state.setup.selfTestPassed === false ? 'Run Audio Self-Test…' : null, action: ['dialogs.selfTest'] });
    } else if (!calls.length) {
      body = C.emptyState({ variant: 'filtered', title: 'No calls match these filters', actionLabel: 'Clear Filters', action: ['lib.clearFilters', { key: KEY }] });
    } else if (ctx.demo === 'loading') {
      body = skeleton(6);
    } else {
      let month = null;
      const rows = [];
      calls.forEach((c) => {
        const m = D.monthName(c);
        if (s.col === 'when' && m !== month) { month = m; rows.push(html`<tr class="lb-month" data-variant="sticky-group-header"><th colspan="7" scope="rowgroup">${m}</th></tr>`); }
        rows.push(C.callRow(c, { variant: 'table', selected: !!l.sel[c.id], key: KEY }));
      });
      body = P.table({ variant: 'sortable', label: 'Calls', cls: 'lb-table', wrapCls: 'lb-tablewrap' }, html`<thead><tr>${thSort('When', 'when', '120px')}${thSort('Call', 'call')}${thSort('Type', 'type', '120px')}${thSort('Length', 'length', '80px')}${thSort('Open', 'open', '60px')}<th scope="col" style="width:200px"><span class="np-sr">Status</span></th><th style="width:36px"><span class="np-sr">Open</span></th></tr></thead><tbody>${rows}</tbody>`);
    }
    return html`
      ${region('LC-R2', { label: 'Filters', cls: 'lb-r-filter' }, C.filterBar({ filters: l.filters, key: KEY, variant: 'calls', noTags: ctx.demo === 'no-tags' }))}
      ${C.undoStrip({ where: KEY })}
      ${region('LC-R3', { label: 'Calls', cls: 'lb-r-table' }, html`${body}${calls.length && ctx.demo !== 'empty' ? html`<p class="lb-hint" data-proto-chrome>Click selects, ⌘ or ⇧-click extends · double-click or › opens · right-click for Add Tag…, Remove Tag and Delete…</p>` : ''}`)}`;
  };
  const skeleton = (n) => html`<div class="lb-skel" data-component="cpt-noter-component-ui-primitives" data-primitive="table" data-state="loading" aria-busy="true">${Array.from({ length: n }, () => raw('<div class="lb-skel__row"><span></span><span></span><span></span></div>'))}</div>`;

  /* ---------- Search results view ---------- */
  const pickResults = (q, ctx) => {
    if (ctx.demo === 'no-matches') return null;
    if (ctx.demo === 'weak-only') return D.libSearch.weakOnly;
    const s = String(q || '').toLowerCase();
    if (ctx.demo === 'keyword-only' || /vstor/.test(s)) return D.libSearch.vstor;
    if (/übergab|schnittstell/.test(s)) return D.libSearch.weakOnly;
    if (!s || /websocket|уведомл|notif|reconnect|drawer/.test(s)) return D.libSearch.websocket;
    // generic: keyword over items and the transcript of c-live
    const items = D.items.filter((i) => i.text.toLowerCase().includes(s)).map((i) => i.id);
    const spans = D.segments.filter((g) => g.text && g.speaker && !g.hypothesis && g.text.toLowerCase().includes(s)).map((g) => ({ t: g.t, speaker: Array.isArray(g.speaker) ? g.speaker[0] : g.speaker, lang: g.lang, text: g.text.replace(new RegExp('(' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'), '[[$1]]') }));
    if (!items.length && !spans.length) return null;
    return { count: items.length + spans.length, items, transcripts: spans.length ? [{ callId: 'c-live', more: 0, spans }] : [], weak: [], docs: [], how: { words: s, meaning: 'on', languages: 'all' } };
  };
  const searchView = (ctx) => {
    const l = L();
    const q = ctx.params.q || '';
    const f = l.filters;
    const nf = NP.dFilterCount(f);
    const res = pickResults(q, ctx);
    const filterBar = region('LS-R1', { label: 'Filters', cls: 'lb-r-filter' }, C.filterBar({ filters: f, key: KEY, variant: 'search' }));
    if (ctx.demo === 'search-failed' && !l.retried) {
      return html`${filterBar}${region('LS-R2', { cls: 'lb-info' }, C.inlineBanner({ severity: 'error', text: 'Couldn\'t search your calls', actions: [{ label: 'Try Again', action: ['lib.retry'] }] }))}`;
    }
    if (ctx.demo === 'loading') return html`${filterBar}${skeleton(5)}`;
    if (!res) {
      return html`${filterBar}${region('LS-R4', { label: 'No matches', cls: 'lb-nomatch' }, C.emptyState({ variant: 'filtered', title: `No matches for “${q || 'websocket'}”`, body: raw(NP.esc([nf ? `${nf} filter${nf === 1 ? '' : 's'} active` : null, 'Try fewer words'].filter(Boolean).join(' · '))) }))}
        <div class="lb-nomatch__acts">${nf ? P.button('Clear Filters', { action: ['lib.clearFilters', { key: KEY }] }) : ''}${P.button('Ask Instead', { action: ['lib.askInstead', { q }] })}</div>`;
    }
    const allWeak = res.allWeak;
    const items = (res.items || []).map((id) => D.item(id)).filter(Boolean);
    const info = html`<div class="lb-info__line">
      ${res.keywordOnly || ctx.demo === 'keyword-only' ? html`<span class="lb-info__kw">${icon('info', { size: 13 })} Searching by keyword only while the index rebuilds · 64 % ${P.progress({ value: 64, label: 'Index rebuild' })}</span>` : html`<span class="t-headline">Best matches · keyword and meaning</span>`}
      ${res.crossLang && /[\u0400-\u04FF]/.test(q) ? html`<span class="np-muted">· ${res.crossLang}</span>` : ''}
      ${P.link('Show How Noter Searched', { anchor: 'lib-how', action: ['lib.how'], attrs: { 'data-proto-anchor': 'lib-how' } })}
    </div>`;
    const weakBanner = allWeak ? C.inlineBanner({ severity: 'warning', title: `Only weak matches for “${q || 'Übergabe der Schnittstelle'}”`, text: 'None of these contain your words; they are close in meaning.' + (nf ? ` · ${nf} filter${nf === 1 ? '' : 's'} active` : ''), actions: [nf ? { label: 'Clear Filters', action: ['lib.clearFilters', { key: KEY }] } : null, f.langs.length ? { label: 'Search All Languages', action: ['lib.allLangs'] } : null, { label: 'Ask Instead', action: ['lib.askInstead', { q }] }].filter(Boolean) }) : '';
    const group = (g, weak) => {
      const c = D.call(g.callId);
      const spans = g.spans.map((sp) => Object.assign({ callId: g.callId, weak, audioGone: ((D.callExtra || {})[g.callId] || {}).audioDeleted }, sp));
      const more = l.more[g.callId];
      const extra = more ? (g.extra || []).map((s) => Object.assign({ callId: g.callId, weak }, s)) : [];
      return html`<div class="lb-group">${C.callRow(c, { variant: 'header' })}
        ${spans.concat(extra).map((sp) => C.searchResultRow(sp, { playing: l.playing && l.playing.callId === sp.callId && l.playing.t === sp.t }))}
        ${g.more && !more ? html`<div class="lb-group__more">${P.link(`+${g.more} More in This Call`, { action: ['lib.more', { callId: g.callId }] })}</div>` : ''}</div>`;
    };
    const strongTx = (res.transcripts || []);
    const weakTx = (res.weak || []);
    const strongDocs = (res.docs || []).filter((d) => !d.weak);
    const weakDocs = (res.docs || []).filter((d) => d.weak);
    return html`<div class="lb-sv">
      ${filterBar}
      ${region('LS-R2', { label: 'Search info', cls: 'lb-info' }, html`${weakBanner}${info}`)}
      <div class="lb-results">
      ${res.topic ? region('LS-R3', { label: 'Topic suggestion', cls: 'lb-topicsugg' }, html`${C.topicChip(res.topic, { variant: 'suggestion', showMerge: false })}${P.button('Ask About This', { size: 'small', action: ['nav.go', { screen: 'ask', params: { scopeTopic: res.topic } }] })}`) : ''}
      ${items.length ? region('LS-R4', { label: 'Items', cls: 'lb-sec' }, html`<h2 class="np-section-h">Items <span class="np-dim">${items.length}</span></h2><div class="lb-items">${items.map((it) => (it.kind === 'action' ? NP.c('actionItemRow', it, { variant: 'compact', key: 'lib', showCall: true, showReview: true }) : NP.c('outputItemRow', it, { variant: 'compact', key: 'lib', showCall: true })))}</div>`) : ''}
      ${strongTx.length || weakTx.length ? region('LS-R5', { label: 'Transcripts', cls: 'lb-sec' }, html`<h2 class="np-section-h">Transcripts</h2>
        ${strongTx.map((g) => group(g, false))}
        ${weakTx.length && !allWeak ? C.searchResultRow(null, { variant: 'weaker-divider' }) : ''}
        ${weakTx.map((g) => group(g, true))}`) : ''}
      ${strongDocs.length || weakDocs.length ? region('LS-R6', { label: 'Documents', cls: 'lb-sec' }, html`<h2 class="np-section-h">Documents</h2>
        ${strongDocs.map((d) => C.searchResultRow(d, { variant: 'document-chunk' }))}
        ${weakDocs.length && strongDocs.length && !allWeak ? C.searchResultRow(null, { variant: 'weaker-divider' }) : ''}
        ${weakDocs.map((d) => C.searchResultRow(d, { variant: 'document-chunk' }))}`) : ''}
      ${region('LS-R7', { label: 'Ask instead', cls: 'lb-askbridge' }, P.link(`Ask Instead: “${q || 'websocket уведомления'}”`, { icon: 'bubble', action: ['lib.askInstead', { q: q || 'websocket уведомления' }] }))}
      </div>
      ${l.playing ? html`<div class="lb-playbar">${NP.c('playbackBar', { variant: 'result', callId: l.playing.callId, at: l.playing.t, speaker: l.playing.speaker, key: KEY })}</div>` : ''}</div>`;
  };

  /* ---------- Topics view ---------- */
  const topicsView = (ctx) => {
    const l = L();
    const q = (l.topicQ || '').toLowerCase();
    if (ctx.demo === 'no-topics') return region('LT-R2', { label: 'Topics' }, C.emptyState({ icon: 'thread', title: 'No topics yet', body: 'Topics appear after a few calls, when decisions and questions come back to the same subject.' }));
    const topics = D.topics.filter((t) => !l.hidden[t.id] && (!q || t.name.toLowerCase().includes(q)));
    if (!topics.length) return region('LT-R2', { label: 'Topics' }, C.emptyState({ variant: 'filtered', title: `No topics match “${l.topicQ}”`, actionLabel: 'Clear Search', action: ['lib.clearTopicQ'] }));
    return html`${C.undoStrip({ where: KEY })}${region('LT-R2', { label: 'Topics' }, P.table({ variant: 'sortable', label: 'Topics', cls: 'lb-table lb-ttable' }, html`<thead><tr>${P.th('Topic', { sort: 'asc' })}${P.th('Calls', { width: '80px' })}${P.th('Decisions', { width: '100px' })}${P.th('Open questions', { width: '130px' })}${P.th('Last discussed', { width: '130px' })}<th style="width:36px"><span class="np-sr">Open</span></th></tr></thead>
      <tbody>${topics.map((t) => {
        const merge = t.mergeWith && !l.keptSeparate;
        const anchor = 'trow-' + t.id;
        return html`<tr class="lb-trow" data-proto-anchor="${anchor}" data-lib-topic="${t.id}" ${act('nav.go', { screen: KEY, params: { view: 'thread', topicId: t.id } })} data-state="${merge ? 'merge-suggested' : 'default'}">
          <td><span class="lb-trow__name" lang="${t.lang}">${icon('thread', { size: 12, cls: 'np-dim' })} ${t.name}</span>${merge ? html` <span class="lb-merge" title="Looks like the same subject as “${D.topics.find((x) => x.id === t.mergeWith).name}”">${icon('merge', { size: 12, label: 'Merge suggested' })}</span>` : ''}</td>
          <td class="np-tnum">${t.calls}</td><td class="np-tnum">${t.decisions}</td><td class="np-tnum">${t.open}</td><td>${(D.topicExtra[t.id] || {}).last || '—'}</td>
          <td>${P.iconButton('chevronRight', { label: 'Open ' + t.name, size: 'inline', action: ['nav.go', { screen: KEY, params: { view: 'thread', topicId: t.id } }] })}</td></tr>`;
      })}</tbody>`))}
      <p class="lb-hint" data-proto-chrome>Right-click a topic for Rename… and Merge With…</p>`;
  };

  /* ---------- Topic thread view ---------- */
  const topicOf = (ctx) => D.topics.find((t) => t.id === ctx.params.topicId) || D.topics[1];
  const THREAD_EXTRA = { 't-ws': ['d-notif', 'q-notif'] };
  const threadItems = (t) => D.items.filter((i) => i.topic === t.id || (THREAD_EXTRA[t.id] || []).includes(i.id) || (t.id === 't-notif' && L().merged && i.topic === 't-ws'));
  const threadView = (ctx) => {
    const l = L();
    const t = topicOf(ctx);
    const items = ctx.demo === 'nothing-left' ? [] : threadItems(t);
    const mergeTo = t.mergeWith ? D.topics.find((x) => x.id === t.mergeWith) : null;
    const showMerge = mergeTo && !l.keptSeparate && !l.merged;
    const groups = {};
    items.forEach((i) => { const m = D.monthName(D.call(i.callId)); (groups[m] = groups[m] || []).push(i); });
    const order = Object.keys(groups).sort((a, b) => (a === 'September' ? -1 : 1));
    return html`
      ${showMerge ? region('TH-R2', { label: 'Merge suggestion', cls: 'lb-thmerge' }, C.inlineBanner({ id: 'merge-' + t.id, severity: 'info', dismissible: false, text: `Looks like the same subject as “${mergeTo.name}”`, actions: [{ label: 'Merge', action: ['lib.mergeSheet', { from: t.id, to: mergeTo.id }] }, { label: 'Keep Separate', action: ['lib.keepSeparate'] }] })) : ''}
      ${C.undoStrip({ where: KEY })}
      ${region('TH-R3', { label: 'Timeline', cls: 'lb-thread' }, items.length ? order.map((m) => html`<div class="lb-thmonth"><h2 class="lb-thmonth__h">${m}</h2><div class="lb-items">${groups[m].map((it) => html`<div class="lb-thentry">${it.kind === 'action' ? NP.c('actionItemRow', it, { variant: 'full', key: 'th', showCall: true, showReview: true }) : NP.c('outputItemRow', it, { variant: 'full', key: 'th', showCall: true })}</div>`)}</div></div>`)
        : html`${C.emptyState({ icon: 'thread', title: 'Nothing left in this topic', body: 'The calls behind this topic were deleted.', actionLabel: 'Delete Topic', action: ['lib.deleteTopic', { id: t.id }] })}`)}`;
  };

  /* ---------- registration ---------- */
  NP.screen(KEY, {
    section: (ctx) => (view(ctx) === 'topics' || view(ctx) === 'thread' ? 'topics' : 'library'),
    variant: (ctx) => view(ctx),
    title: (ctx) => ({ calls: 'Calls', search: 'Search results', topics: 'Topics', thread: topicOf(ctx).name }[view(ctx)]),
    subtitle: (ctx) => {
      const v = view(ctx);
      if (v === 'calls') { if (ctx.demo === 'empty') return 'No calls yet'; const n = NP.dFilterCount(L().filters); const sel = selIds().length; return (n ? `${visibleCalls(ctx).length} calls match` : '212 calls · 148 hours · since 2 Sep') + (sel > 1 ? ` · ${sel} selected` : ''); }
      if (v === 'search') { const r = pickResults(ctx.params.q, ctx); return r ? `${r.count} results` : 'No results'; }
      if (v === 'topics') return `${D.topics.length} topics`;
      const t = topicOf(ctx);
      return `${t.calls} calls · ${t.decisions} decision${t.decisions === 1 ? '' : 's'} · ${t.open} open question${t.open === 1 ? '' : 's'} · since ${(D.topicExtra[t.id] || {}).since || '2 Sep'}`;
    },
    search: false,
    toolbarActions: (ctx) => {
      const v = view(ctx);
      const l = L();
      if (v === 'topics') return P.searchField({ id: 'lt-search', placeholder: 'Search topics', bind: 'local.library.topicQ', value: l.topicQ, live: true, cls: 'lb-tsearch' });
      if (v === 'thread') {
        const t = topicOf(ctx);
        return html`${P.button('Ask About This Thread', { action: ['nav.go', { screen: 'ask', params: { scopeTopic: t.id } }] })}${P.pulldown('More', [{ label: 'Rename…', action: ['lib.renamePop', { id: t.id, anchor: 'th-more' }] }, { label: 'Merge With…', action: ['lib.mergeSheet', { from: t.id, to: t.mergeWith || 't-notif' }] }], { iconOnly: true, icon: 'ellipsis', anchorId: 'th-more', ariaLabel: 'More', size: 'toolbar' })}`;
      }
      const n = selIds().length;
      const tokens = NP.dTokens(l.filters);
      const qVal = v === 'search' && l.q == null ? ctx.params.q : l.q;
      const sugg = (l.q || '').startsWith('#');
      const tagSugg = sugg ? NP.dTagsInUse().filter((t) => t.startsWith(l.q.slice(1).toLowerCase())) : [];
      return html`${NP.comp('share-menu', { variant: 'list', state: n ? 'enabled' : 'disabled', tag: 'span' }, P.button('Export…', { disabled: !n, action: ['lib.export'], help: n ? null : 'Select calls to export', shortcut: 'Meta+E' }))}
        <span class="lb-searchwrap">${P.searchField({ id: 'lc-search', placeholder: 'Search calls, people, documents', tokens, tokenAction: 'lib.removeToken', bind: 'local.library.q', value: qVal || '', live: true, enter: 'lib.search', cls: 'lb-search' })}
        ${sugg ? html`<div class="lb-sugg" role="listbox" aria-label="Suggestions"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'search-field', 'data-variant': 'suggestions', 'data-state': 'suggestions-open' })}><div class="np-menu__hdr">Tags</div>${tagSugg.length ? tagSugg.map((t) => html`<button type="button" class="np-menu__item" role="option" ${act('lib.pickTag', { tag: t })}>${icon('tag', { size: 12 })}<span class="np-menu__label">${t}</span></button>`) : html`<div class="np-menu__item" aria-disabled="true">No tags yet. Add tags in a call's Call info.</div>`}</div>` : ''}</span>`;
    },
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'empty', label: 'Calls · No calls yet' },
      { id: 'filtered-empty', label: 'Calls · No calls match the filters' },
      { id: 'no-tags', label: 'Calls · No tags yet' },
      { id: 'tagged', label: 'Calls · Several calls tagged' },
      { id: 'selected', label: 'Calls · Several calls selected' },
      { id: 'statuses', label: 'Calls · Status cells' },
      { id: 'loading', label: 'Loading (skeleton rows)' },
      { id: 'cross-language', label: 'Search · Cross-language match' },
      { id: 'keyword-only', label: 'Search · Keyword-only while the index rebuilds' },
      { id: 'no-matches', label: 'Search · No matches' },
      { id: 'weak-only', label: 'Search · Only weak matches' },
      { id: 'search-failed', label: 'Search · Search failed' },
      { id: 'no-topics', label: 'Topics · No topics yet' },
      { id: 'merge', label: 'Thread · Merge suggested' },
      { id: 'nothing-left', label: 'Thread · Nothing left in this topic' },
    ],
    onDemo: (id) => {
      const l = L();
      l.retried = false; l.playing = null; l.more = {}; l.sel = {}; NP.state.undo = null;
      D.calls.forEach((c) => { if (c._st) { c.status = c._st; delete c._st; } });
      const go = (params) => NP.go(KEY, params, { replace: true });
      if (id === 'default' || id === 'empty') { l.filters = blankFilters(); l.sel = {}; go({ view: 'calls' }); }
      if (id === 'filtered-empty') { l.filters = Object.assign(blankFilters(), { types: ['Vendor'], tags: ['release'] }); go({ view: 'calls' }); }
      if (id === 'no-tags') { l.filters = blankFilters(); go({ view: 'calls' }); NP.state.menu = { anchor: 'fb-library-tags', items: [{ label: 'No tags yet. Add tags in a call\'s Call info.', disabled: true }] }; }
      if (id === 'tagged') { l.filters = Object.assign(blankFilters(), { tags: ['release'] }); go({ view: 'calls' }); NP.undo('Tagged 3 calls “release”', { where: KEY, action: 'lib.untag', args: { ids: ['c-live', 'c-design', 'c-qa'], tag: 'release' }, redoAction: 'lib.retag' }); }
      if (id === 'selected') { l.filters = blankFilters(); l.sel = { 'c-live': true, 'c-design': true, 'c-qa': true }; go({ view: 'calls' }); }
      if (id === 'statuses') { l.filters = blankFilters(); [['c-live', 'writing'], ['c-design', 'failed']].forEach(([cid, s]) => { const c = D.call(cid); c._st = c.status; c.status = s; }); go({ view: 'calls' }); }
            if (id === 'cross-language') { l.q = null; go({ view: 'search', q: 'websocket уведомления' }); }
      if (id === 'keyword-only') { l.q = null; go({ view: 'search', q: 'VSTOR-9912' }); }
      if (id === 'no-matches') { l.q = null; l.filters = Object.assign(blankFilters(), { types: ['Planning'] }); go({ view: 'search', q: 'Lizenzprüfung im Installer' }); }
      if (id === 'weak-only') { l.q = null; l.filters = Object.assign(blankFilters(), { types: ['Planning'], date: '30' }); go({ view: 'search', q: 'Übergabe der Schnittstelle' }); }
      if (id === 'search-failed') { l.q = null; go({ view: 'search', q: 'drawer timeout' }); }
      if (id === 'no-topics') go({ view: 'topics' });
      if (id === 'merge') { l.keptSeparate = false; l.merged = false; go({ view: 'thread', topicId: 't-ws' }); }
      if (id === 'nothing-left') go({ view: 'thread', topicId: 't-retention' });
    },
    render: (ctx) => {
      const v = view(ctx);
      if (v === 'search') return searchView(ctx);
      if (v === 'topics') return topicsView(ctx);
      if (v === 'thread') return threadView(ctx);
      return callsView(ctx);
    },
  });

  /* ---------- actions ---------- */
  NP.onMany({
    'lib.select': (a, ev) => {
      const l = NP.local(a.key || KEY);
      const sel = l.sel || (l.sel = {});
      if (ev && (ev.metaKey || ev.ctrlKey)) sel[a.id] = !sel[a.id];
      else if (ev && ev.shiftKey) {
        const ids = visibleCalls(NP.shell.ctx(KEY)).map((c) => c.id);
        const last = l.lastSel && ids.indexOf(l.lastSel) >= 0 ? ids.indexOf(l.lastSel) : 0;
        const cur = ids.indexOf(a.id);
        ids.slice(Math.min(last, cur), Math.max(last, cur) + 1).forEach((id) => { sel[id] = true; });
      } else { Object.keys(sel).forEach((k) => { sel[k] = false; }); sel[a.id] = true; }
      l.lastSel = a.id;
    },
    'lib.sort': (a) => { const l = L(); const s = l.sort || { col: 'when', dir: 'desc' }; l.sort = { col: a.col, dir: s.col === a.col && s.dir === 'desc' ? 'asc' : 'desc' }; },
    'lib.filter': (a) => {
      const f = L().filters;
      if (a.kind === 'open') f.open = !f.open;
      else if (a.kind === 'date') f.date = a.value;
      else { const arr = f[a.kind]; const i = arr.indexOf(a.value); if (i >= 0) arr.splice(i, 1); else arr.push(a.value); }
    },
    'lib.clearFilters': () => { L().filters = blankFilters(); },
    'lib.removeToken': (a) => { const t = NP.dTokens(L().filters)[a.index]; if (!t) return; const f = L().filters; if (t.f[0] === 'open') f.open = false; else if (t.f[0] === 'date') f.date = 'any'; else f[t.f[0]] = f[t.f[0]].filter((x) => x !== t.f[1]); },
    'lib.search': (a) => {
      const q = (a.value || '').trim();
      const l = L();
      if (q.startsWith('#')) { const tag = q.slice(1).toLowerCase(); if (tag && !l.filters.tags.includes(tag)) l.filters.tags.push(tag); l.q = ''; return; }
      l.q = null; l.playing = null; l.more = {}; l.retried = false;
      NP.go(KEY, { view: 'search', q }); return false;
    },
    'lib.pickTag': (a) => { const l = L(); if (!l.filters.tags.includes(a.tag)) l.filters.tags.push(a.tag); l.q = ''; },
    'lib.retry': () => { L().retried = true; },
    'lib.more': (a) => { L().more[a.callId] = true; },
    'lib.play': (a) => {
      const l = NP.local(a.key || KEY);
      if (l.playing && l.playing.callId === a.callId && l.playing.t === a.t) l.playing = null;
      else l.playing = { callId: a.callId, t: a.t, speaker: a.speaker };
    },
    'lib.askInstead': (a) => { NP.go('ask', { q: a.q }); return false; },
    'lib.allLangs': () => { L().filters.langs = []; },
    'lib.how': () => { NP.state.popover = { id: 'lib-how', anchor: 'lib-how', props: {} }; NP.state.menu = null; },
    'lib.export': () => {
      const ids = selIds();
      if (NP.actions['dlg.export']) return NP.actions['dlg.export']({ scope: { kind: 'calls', ids, label: `${ids.length} call${ids.length === 1 ? '' : 's'}` } });
      NP.flash('proto', 'Export sheet comes from the Dialogs module');
    },
    'lib.addTagPop': (a) => { NP.state.popover = { id: 'lib-add-tag', anchor: a.anchor, props: { ids: a.ids } }; },
    'lib.applyTag': (a) => {
      const tag = String(NP.local('libtag').value || '').trim().toLowerCase().slice(0, 32);
      if (!tag) return;
      a.ids.forEach((id) => { const c = D.call(id); c.tags = c.tags || []; if (!c.tags.includes(tag)) c.tags.push(tag); });
      NP.state.popover = null; NP.local('libtag').value = '';
      NP.undo(`Tagged ${a.ids.length} call${a.ids.length === 1 ? '' : 's'} “${tag}”`, { where: KEY, action: 'lib.untag', args: { ids: a.ids, tag }, redoAction: 'lib.retag' });
    },
    'lib.untag': (a) => { a.ids.forEach((id) => { const c = D.call(id); c.tags = (c.tags || []).filter((t) => t !== a.tag); }); },
    'lib.retag': (a) => { a.ids.forEach((id) => { const c = D.call(id); c.tags = c.tags || []; if (!c.tags.includes(a.tag)) c.tags.push(a.tag); }); },
    'lib.removeTag': (a) => { a.ids.forEach((id) => { const c = D.call(id); c.tags = (c.tags || []).filter((t) => t !== a.tag); }); NP.undo(`Removed “${a.tag}” from ${a.ids.length} call${a.ids.length === 1 ? '' : 's'}`, { where: KEY, action: 'lib.retag', args: a, redoAction: 'lib.untag' }); },
    'lib.deleteAsk': (a) => {
      const n = a.ids.length;
      const title = n === 1 ? `Delete “${D.call(a.ids[0]).title}”?` : `Delete ${n} calls?`;
      NP.openAlert({ title, variant: 'destructive', body: n === 1 ? 'This removes its audio, transcript, summary, items and cards. You can’t undo this.' : 'This removes their audio, transcripts, summaries, items and cards. You can’t undo this.', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: n === 1 ? 'Delete' : `Delete ${n} Calls`, variant: 'destructive', action: 'lib.delete', args: a }] });
      return false;
    },
    'lib.delete': (a) => { a.ids.forEach((id) => { L().deleted[id] = true; L().sel[id] = false; }); NP.state.alert = null; NP.flash('proto', `Deleted ${a.ids.length} call${a.ids.length === 1 ? '' : 's'}`); },
    'lib.clearTopicQ': () => { L().topicQ = ''; },
    'lib.renamePop': (a) => { const t = D.topics.find((x) => x.id === a.id); NP.local('libren').value = t.name; NP.state.popover = { id: 'lib-rename-topic', anchor: a.anchor, props: { id: a.id } }; NP.state.menu = null; },
    'lib.rename': (a) => {
      const t = D.topics.find((x) => x.id === a.id);
      const v = String(NP.local('libren').value || '').trim();
      if (!v) return;
      const clash = D.topics.find((x) => x.id !== a.id && x.name.toLowerCase() === v.toLowerCase());
      if (clash && !a.force) { NP.local('libren').clash = clash.id; return; }
      const old = t.name; t.name = v; NP.state.popover = null; NP.local('libren').clash = null;
      NP.undo(`Renamed “${old}” to “${v}”`, { where: KEY, action: 'lib.renameBack', args: { id: a.id, name: old } });
    },
    'lib.renameBack': (a) => { D.topics.find((x) => x.id === a.id).name = a.name; },
    'lib.mergeSheet': (a) => { NP.openSheet('lib-merge-topic', { from: a.from, to: a.to }); return false; },
    'lib.mergeTarget': (a) => { if (a.value) NP.state.sheet.props.to = a.value; },
    'lib.merge': (a) => {
      const from = D.topics.find((x) => x.id === a.from); const to = D.topics.find((x) => x.id === a.to);
      L().merged = true; L().hidden[a.from] = true; NP.state.sheet = null;
      const n = D.items.filter((i) => i.topic === a.from).length;
      NP.go(KEY, { view: 'thread', topicId: to.id }, { replace: true });
      NP.undo(`Merged ${n} items into “${to.name}”`, { where: KEY, context: `from “${from.name}”`, action: 'lib.unmerge', args: a });
      return false;
    },
    'lib.unmerge': (a) => { L().merged = false; L().hidden[a.from] = false; },
    'lib.keepSeparate': () => { L().keptSeparate = true; NP.flash('proto', 'Kept separate. Noter will not suggest this merge again.'); },
    'lib.deleteTopic': (a) => { L().hidden[a.id] = true; NP.go(KEY, { view: 'topics' }); return false; },
  });

  /* ---------- popovers and sheets ---------- */
  NP.overlay('lib-how', {
    width: 340,
    render: () => {
      const ctx = NP.shell.ctx(KEY);
      const r = pickResults(ctx.params.q, ctx) || { how: { words: ctx.params.q, meaning: 'on', languages: 'all' } };
      const f = L().filters;
      const fl = [f.types.join(', '), f.tags.map((t) => 'tag ' + t).join(', '), f.date === '30' ? 'last 30 days' : f.date === '7' ? 'last 7 days' : ''].filter(Boolean).join(', ');
      const kw = r.keywordOnly || ctx.demo === 'keyword-only';
      return html`<div class="np-pop__body"><div class="np-pop__title">${icon('search', { size: 13 })} How Noter searched</div>
        <dl class="np-kv"><dt>Words searched</dt><dd>${r.how.words}</dd><dt>Meaning search</dt><dd>${kw ? 'off while the index rebuilds' : r.how.meaning}</dd><dt>Languages</dt><dd>${f.langs.length ? f.langs.join(', ') : r.how.languages}</dd><dt>Filters</dt><dd>${fl || 'none'}</dd></dl></div>`;
    },
  });
  NP.overlay('lib-add-tag', {
    width: 300,
    render: (p) => html`<div class="np-pop__body" data-component="cpt-noter-component-screen-dialogs" data-variant="add-tag" data-state="open"><div class="np-pop__title">Add tag to ${p.ids.length} call${p.ids.length === 1 ? '' : 's'}</div>
      ${P.searchField({ variant: 'token-field', id: 'lib-tag-field', placeholder: 'Add tag…', bind: 'local.libtag.value', value: NP.local('libtag').value || '', ariaLabel: 'Tag' })}
      <div class="np-dim t-callout">In use: ${NP.dTagsInUse().join(', ') || 'none yet'}</div>
      <div class="np-pop__actions">${P.button('Add Tag', { variant: 'primary', size: 'small', action: ['lib.applyTag', p] })}</div></div>`,
  });
  NP.overlay('lib-rename-topic', {
    width: 320,
    render: (p) => {
      const r = NP.local('libren');
      const clash = r.clash ? D.topics.find((x) => x.id === r.clash) : null;
      return html`<div class="np-pop__body" data-component="cpt-noter-component-screen-dialogs" data-variant="topic-rename" data-state="${clash ? 'clash' : 'open'}"><div class="np-pop__title">Rename topic</div>
        ${P.textField({ id: 'lib-ren-field', value: r.value, bind: 'local.libren.value', ariaLabel: 'Topic name', invalid: !!clash, message: clash ? `A topic called “${clash.name}” already exists` : null })}
        <div class="np-pop__actions">${clash ? P.button('Merge Instead', { size: 'small', action: ['lib.mergeSheet', { from: p.id, to: clash.id }] }) : ''}${P.button('Rename', { variant: 'primary', size: 'small', action: ['lib.rename', p] })}</div></div>`;
    },
  });
  NP.overlay('lib-merge-topic', {
    width: 520,
    title: () => 'Merge topics',
    render: (p) => {
      const from = D.topics.find((x) => x.id === p.from) || D.topics[1]; const to = D.topics.find((x) => x.id === p.to) || D.topics[2];
      const moving = D.items.filter((i) => i.topic === from.id);
      return html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="merge-topic" data-state="open">
        <div class="np-sheet__head"><div class="np-sheet__title">Merge “${from.name}” into “${to.name}”?</div><div class="np-sheet__sub">The items move to “${to.name}”, and “${from.name}” becomes one of its names. You can undo this in History.</div></div>
        <div class="np-sheet__body"><label class="pe-form__row"><span class="np-field__label">Merge into</span>${P.popup(D.topics.filter((x) => x.id !== from.id && !L().hidden[x.id]).map((x) => ({ value: x.id, label: x.name })), to.id, { id: 'lb-merge-to', label: 'Topic to keep', action: ['lib.mergeTarget', {}] })}</label>
        <div class="t-headline">What moves · ${moving.length} items from ${from.calls} calls</div>
        <ul class="lb-movelist">${moving.map((i) => html`<li>${P.badge(i.kind === 'decision' ? 'Decision' : i.kind === 'question' ? 'Question' : 'Action', { kind: 'kind' })} <span lang="${i.lang}">${i.text}</span></li>`)}</ul></div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button('Merge', { variant: 'primary', action: ['lib.merge', { from: from.id, to: to.id }] })}</div></div>`;
    },
  });
  NP.galleries.dialogs.push({ id: 'lib-merge-topic', label: 'Merge topics (sheet)', surface: 'main', open: () => { NP.go(KEY, { view: 'thread', topicId: 't-ws' }); NP.openSheet('lib-merge-topic', { from: 't-ws', to: 't-notif' }); } });

  /* ---------- row interactions the core does not wire: double-click opens, right-click menus ---------- */
  NP.onAfterRender(() => {
    document.querySelectorAll('.np-desk tr[data-lib-open]').forEach((tr) => {
      tr.addEventListener('dblclick', () => { NP.go('call-page', JSON.parse(tr.getAttribute('data-lib-open'))); });
      tr.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const id = tr.getAttribute('data-lib-row');
        const l = L();
        if (!l.sel[id]) { Object.keys(l.sel).forEach((k) => { l.sel[k] = false; }); l.sel[id] = true; }
        const ids = selIds();
        const tags = [...new Set(ids.flatMap((i) => D.call(i).tags || []))];
        NP.state.popover = null;
        NP.state.menu = { anchor: 'crow-' + id, items: [
          { label: 'Open', action: ['nav.go', { screen: 'call-page', params: { callId: id, view: 'summary' } }] },
          { divider: true },
          { label: 'Add Tag…', action: ['lib.addTagPop', { anchor: 'crow-' + id, ids }] },
        ].concat(tags.length ? [{ header: 'Remove Tag' }].concat(tags.map((t) => ({ label: t, action: ['lib.removeTag', { ids, tag: t }] })))
          : [{ label: 'Remove Tag', disabled: true }]).concat([{ divider: true }, { label: 'Export…', kbd: '⌘E', action: ['lib.export'] }, { label: 'Delete…', kbd: '⌘⌫', destructive: true, action: ['lib.deleteAsk', { ids }] }]) };
        NP.render();
      });
    });
    document.querySelectorAll('.np-desk tr[data-lib-topic]').forEach((tr) => {
      tr.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const id = tr.getAttribute('data-lib-topic');
        const t = D.topics.find((x) => x.id === id);
        NP.state.menu = { anchor: 'trow-' + id, items: [{ label: 'Open', action: ['nav.go', { screen: KEY, params: { view: 'thread', topicId: id } }] }, { divider: true }, { label: 'Rename…', action: ['lib.renamePop', { id, anchor: 'trow-' + id }] }, { label: 'Merge With…', action: ['lib.mergeSheet', { from: id, to: t.mergeWith || (id === 't-notif' ? 't-ws' : 't-notif') }] }] };
        NP.render();
      });
    });
    const tf = document.getElementById('lib-tag-field');
    if (tf && !tf._d) { tf._d = true; tf.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); const p = NP.state.popover && NP.state.popover.props; NP.local('libtag').value = tf.value; if (p) { NP.actions['lib.applyTag'](p); NP.render(); } } }); }
  });
})();
