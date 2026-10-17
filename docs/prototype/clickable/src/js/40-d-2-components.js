/* =====================================================================
   Group D components: call-row (30), filter-bar (31),
   search-result-row (32), cited-answer (33)
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, C, data: D, esc } = NP;

  /** '…text with [[match]]…' -> Raw with <mark> highlights (text stays escaped). */
  NP.dHl = (text) => raw(esc(text).replace(/\[\[(.+?)\]\]/g, '<mark class="np-hl-match lb-mark">$1</mark>'));
  NP.dPlain = (text) => String(text).replace(/\[\[(.+?)\]\]/g, '$1');

  const statusOf = (c) => {
    const x = (D.callExtra || {})[c.id] || {};
    const st = c.status;
    if (st === 'failed') return { state: 'summary-failed', icon: 'error', text: 'Couldn\'t write the summary', tone: 'error' };
    if (st === 'writing') return { state: 'writing-summary', spin: true, text: 'Writing summary…' };
    if (c.unnamed && c.unnamed.length) return { state: 'speakers-not-named', icon: 'person', text: `${c.unnamed.length} speaker${c.unnamed.length === 1 ? '' : 's'} not named`, action: ['nav.go', { screen: 'call-page', params: { callId: c.id, view: 'summary', naming: true } }] };
    if (x.archivePending) return { state: 'archive-pending', icon: 'clock', text: 'Archive pending' };
    return null;
  };
  const whenOf = (c) => (c.dateLong === 'Today' ? 'Today' : c.date) + ' ' + c.time;
  const names = (ids, max) => {
    const n = ids.filter((i) => i !== 'p-you').map((i) => D.person(i).short.replace(/ [A-Z]\.$/, ''));
    if (ids.includes('p-you')) n.push('You');
    return n.length > (max || 3) ? n.slice(0, max || 3).join(', ') + ' +' + (n.length - (max || 3)) : n.join(', ');
  };

  /* ---------- 30. Call row ----------
     variant: table (LC-R3, Person › Calls) | compact (PE-R6) | header (LS-R5 result group header)
     opts: selected, key, focusTable */
  C.callRow = (c, o) => {
    o = o || {};
    const variant = o.variant === 'person' ? 'table' : (o.variant || 'table');
    const x = (D.callExtra || {})[c.id] || {};
    const sensitive = c.privacy === 'Sensitive';
    const st = statusOf(c);
    const open = ['nav.go', { screen: 'call-page', params: { callId: c.id, view: 'summary' } }];
    const deleted = x.audioDeleted ? html`<span class="lb-audiodel" title="Audio deleted on ${x.audioDeletedOn || '15 Nov'} (kept 30 days)">${icon('speaker', { size: 12, label: 'Audio deleted on ' + (x.audioDeletedOn || '15 Nov') + ' (kept 30 days)' })}<span class="lb-audiodel__x" aria-hidden="true"></span></span>` : '';
    const localTag = sensitive ? P.badge('Local only', { kind: 'status', tone: 'neutral', icon: 'lock' }) : '';
    if (variant === 'header') {
      return comp('call-row', { variant: 'result-group-header', state: sensitive ? 'sensitive' : 'default', cls: 'lb-grouph', attrs: { role: 'heading', 'aria-level': '4' } },
        html`<a href="#" class="lb-grouph__title" ${act(open[0], open[1])} title="${c.title}">${c.title}</a>${localTag}
        <span class="lb-grouph__meta">${c.date} · ${names(c.people)}</span>
        <span class="lb-langs">${c.languages.map((l) => C.languageTag(l, { variant: 'call' }))}</span>`);
    }
    if (variant === 'compact') {
      return comp('call-row', { variant: 'compact', state: sensitive ? 'sensitive' : 'default', tag: 'a', cls: 'lb-crow-c', attrs: { href: '#', 'data-proto-action': open[0], 'data-proto-args': JSON.stringify(open[1]), title: c.title } },
        html`<span class="lb-crow-c__when np-tnum">${whenOf(c)}</span><span class="lb-crow-c__title">${c.title}</span>${localTag}<span class="lb-crow-c__type np-dim">${c.type}</span><span class="lb-crow-c__len np-dim np-tnum">${c.length}</span>${icon('chevronRight', { size: 11, cls: 'np-dim' })}`);
    }
    const tags = c.tags || [];
    const stateName = o.selected ? 'selected' : st ? st.state : (sensitive ? 'sensitive' : (x.audioDeleted ? 'audio-deleted' : 'default'));
    const anchor = 'crow-' + c.id;
    return comp('call-row', { variant: 'table-row', state: stateName, tag: 'tr', cls: 'lb-crow' + (o.selected ? ' is-sel' : ''), attrs: { 'aria-selected': String(!!o.selected), 'data-proto-anchor': anchor, 'data-lib-row': c.id, 'data-proto-action': o.selectAction || 'lib.select', 'data-proto-args': JSON.stringify({ id: c.id, key: o.key || 'library' }), 'data-lib-open': JSON.stringify(open[1].params) } },
      html`<td class="lb-crow__when np-tnum">${whenOf(c)}</td>
      <td class="lb-crow__call"><div class="lb-crow__l1"><span class="lb-crow__title" title="${c.title}">${c.title}</span>${localTag}</div>
        <div class="lb-crow__l2"><span class="lb-crow__people">${names(c.people)}</span><span class="lb-langs">${c.languages.map((l) => C.languageTag(l, { variant: 'call' }))}</span>${tags.slice(0, 2).map((t) => P.badge(t, { kind: 'kind', tone: 'neutral', cls: 'lb-tag' }))}${tags.length > 2 ? html`<span class="np-dim lb-more" title="${tags.slice(2).join(', ')}">+${tags.length - 2}</span>` : ''}</div></td>
      <td class="lb-crow__type">${c.type}</td>
      <td class="lb-crow__len np-tnum">${c.length}</td>
      <td class="lb-crow__open np-tnum">${c.openItems ? P.badge(String(c.openItems), { kind: 'count' }) : ''}</td>
      <td class="lb-crow__status">${st ? html`<span class="lb-status lb-status--${st.tone || 'neutral'}" title="${st.text}">${st.spin ? P.progress({ variant: 'spinner', label: st.text }) : icon(st.icon, { size: 12 })}${st.action ? P.link(st.text, { action: st.action }) : html`<span>${st.text}</span>`}</span>` : ''}${deleted}</td>
      <td class="lb-crow__chev">${P.iconButton('chevronRight', { label: 'Open ' + c.title, size: 'inline', action: open })}</td>`);
  };

  /* ---------- 31. Filter bar ----------
     filters: {people:[], types:[], tags:[], langs:[], date:'any', open:false}; key: local state key; variant: calls | search */
  const DATE_LABEL = { any: 'Any Time', '7': 'Last 7 Days', '30': 'Last 30 Days', custom: 'Custom…' };
  const LANGS = [{ v: 'EN', l: 'English' }, { v: 'RU', l: 'Russian' }, { v: 'DE', l: 'German' }];
  NP.dTagsInUse = () => {
    const count = {};
    D.calls.forEach((c) => (c.tags || []).forEach((t) => { count[t] = (count[t] || 0) + 1; }));
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  };
  NP.dFilterCount = (f) => (f.people.length ? 1 : 0) + (f.types.length ? 1 : 0) + (f.tags.length ? 1 : 0) + (f.langs.length ? 1 : 0) + (f.date !== 'any' ? 1 : 0) + (f.open ? 1 : 0);
  C.filterBar = (o) => {
    o = o || {};
    const f = o.filters;
    const key = o.key || 'library';
    const variant = o.variant || 'calls';
    const noTags = o.noTags;
    const multi = (arr, fmt) => (arr.length ? fmt(arr[0]) + (arr.length > 1 ? ' +' + (arr.length - 1) : '') : null);
    const pop = (kind, name, value, items) => {
      const anchor = 'fb-' + key + '-' + kind;
      NP._menus[anchor] = items;
      return P.button(value || name, { size: 'small', chevron: true, cls: 'lb-fb__btn' + (value ? ' is-set' : ''), anchor, action: ['proto.menu', { anchor }], attrs: { 'data-primitive': 'popup-button', 'data-variant': 'toolbar', 'data-state': value ? 'mixed' : 'default', 'aria-haspopup': 'menu', 'aria-label': name + (value ? ': ' + value : '') } });
    };
    const ppl = D.people.filter((p) => !p.you).sort((a, b) => a.short.localeCompare(b.short));
    const types = [...new Set(D.calls.map((c) => c.type))];
    const tags = noTags ? [] : NP.dTagsInUse();
    const n = NP.dFilterCount(f);
    return comp('filter-bar', { variant, state: n ? 'some-set' : 'none-set', cls: 'lb-fb', attrs: { role: 'toolbar', 'aria-label': 'Filters' } }, html`
      ${pop('people', 'People', multi(f.people, (id) => D.person(id).short.replace(/ [A-Z]\.$/, '')), [{ header: 'People' }].concat(ppl.map((p) => ({ label: p.short, checked: f.people.includes(p.id), action: ['lib.filter', { key, kind: 'people', value: p.id }] }))))}
      ${pop('type', 'Type', multi(f.types, (t) => t), types.map((t) => ({ label: t, checked: f.types.includes(t), action: ['lib.filter', { key, kind: 'types', value: t }] })))}
      ${pop('tags', 'Tags', multi(f.tags, (t) => t), tags.length ? [{ header: 'Tags in use' }].concat(tags.map((t) => ({ label: t, checked: f.tags.includes(t), action: ['lib.filter', { key, kind: 'tags', value: t }] }))) : [{ label: 'No tags yet. Add tags in a call\'s Call info.', disabled: true }])}
      ${pop('lang', 'Language', multi(f.langs, (v) => LANGS.find((x) => x.v === v).l), LANGS.map((x) => ({ label: x.l, checked: f.langs.includes(x.v), action: ['lib.filter', { key, kind: 'langs', value: x.v }] })))}
      ${pop('date', 'Date', f.date !== 'any' ? DATE_LABEL[f.date] : null, Object.keys(DATE_LABEL).map((k) => ({ label: DATE_LABEL[k], checked: f.date === k, action: ['lib.filter', { key, kind: 'date', value: k }] })))}
      ${P.button('Has Open Items', { size: 'small', cls: 'lb-fb__btn lb-fb__toggle' + (f.open ? ' is-set' : ''), action: ['lib.filter', { key, kind: 'open' }], attrs: { 'aria-pressed': String(!!f.open), 'data-state': f.open ? 'on' : 'off', 'data-variant': 'toggle' } })}
      <span class="np-tb__spacer"></span>
      ${P.button('Clear', { size: 'small', variant: 'quiet', disabled: !n, action: ['lib.clearFilters', { key }] })}`);
  };
  /** tokens shown in the search field, in step with the filter bar */
  NP.dTokens = (f) => {
    const t = [];
    f.people.forEach((id) => t.push({ label: D.person(id).short.replace(/ [A-Z]\.$/, ''), kind: 'person', f: ['people', id] }));
    f.types.forEach((v) => t.push({ label: v, kind: 'type', f: ['types', v] }));
    f.tags.forEach((v) => t.push({ label: 'Tag: ' + v, kind: 'tag', f: ['tags', v] }));
    f.langs.forEach((v) => t.push({ label: v, kind: 'language', f: ['langs', v] }));
    if (f.date !== 'any') t.push({ label: DATE_LABEL[f.date], kind: 'date', f: ['date', 'any'] });
    if (f.open) t.push({ label: 'Has open items', kind: 'open', f: ['open'] });
    return t;
  };

  /* ---------- 32. Search result row ----------
     r: {t, speaker, text, lang, weak, callId, noAudio, audioGone, deleted} or doc {title, source, path, snippet, fresh, weak}
     variant: transcript-span | document-chunk | weaker-divider */
  C.searchResultRow = (r, o) => {
    o = o || {};
    const variant = o.variant || (r && r.title ? 'document-chunk' : 'transcript-span');
    if (variant === 'weaker-divider') return comp('search-result-row', { variant, cls: 'lb-weakdiv', attrs: { role: 'separator' } }, 'Weaker matches');
    const weakTag = r.weak ? P.badge('Weak match', { kind: 'status', tone: 'neutral', cls: 'lb-weaktag' }) : '';
    if (variant === 'document-chunk') {
      return comp('search-result-row', { variant, state: r.deleted ? 'source-deleted' : r.weak ? 'weak-match' : 'default', cls: 'lb-res lb-res--doc' },
        html`<div class="lb-res__doc">
          <div class="lb-res__doctitle">${P.link(r.title, { external: true, action: ['proto.flash', { key: 'lib', text: 'Opens “' + r.title + '” in ' + r.source }] })}<span class="lb-res__src">${icon(r.icon || 'doc', { size: 12 })}${r.source}</span></div>
          <div class="lb-res__path" title="${r.path}">${r.path}</div>
          <div class="lb-res__text">${NP.dHl(r.snippet)} ${weakTag}</div>
          <div class="lb-res__fresh np-dim">${r.fresh}</div>
        </div>`);
    }
    const playing = o.playing;
    const spk = r.speaker && r.speaker.startsWith('p-') ? C.personChip(r.speaker, { variant: 'text' }) : html`<span class="np-dim">${r.speaker}</span>`;
    const open = ['nav.go', { screen: 'call-page', params: { callId: r.callId, view: 'transcript', span: r.t } }];
    const state = r.deleted ? 'source-deleted' : playing ? 'playing' : r.noAudio ? 'no-audio' : r.audioGone ? 'audio-gone' : r.weak ? 'weak-match' : 'default';
    return comp('search-result-row', { variant, state, cls: 'lb-res' + (playing ? ' is-playing' : '') },
      html`<span class="lb-res__spk">${spk}</span>
      <span class="lb-res__t np-tnum"${attrs({ title: r.audioGone ? 'Audio deleted on 15 Nov (kept 30 days)' : null })}>${r.t}</span>
      <span class="lb-res__text" lang="${String(r.lang || 'en').toLowerCase()}">${NP.dHl(r.text)} ${weakTag}</span>
      ${C.languageTag(r.lang || 'EN')}
      <span class="lb-res__play">${r.audioGone ? '' : P.iconButton(playing ? 'pause' : 'play', { label: playing ? 'Pause' : 'Play ' + r.t, size: 'inline', disabled: !!r.noAudio, help: r.noAudio ? 'No audio for this moment (system audio was lost)' : null, action: ['lib.play', { callId: r.callId, t: r.t, speaker: r.speaker, key: o.key || 'library' }] })}</span>
      ${P.iconButton('chevronRight', { label: 'Open the call at ' + r.t, size: 'inline', action: open })}`);
  };

  /* ---------- 33. Cited answer ----------
     a: {paras:[...'[n]'...], meta, citations, weak, scopeNote, keywordOnly, status, local, notFound, error, deleted, stopped}
     variant: answer | not-found | follow-up | weak-evidence ; key: turn key */
  C.citedAnswer = (a, o) => {
    o = o || {};
    const key = o.key || 't';
    const L = NP.local('ask');
    if (a.error) {
      return comp('cited-answer', { variant: o.variant || 'answer', state: 'error', cls: 'ak-ans' }, C.inlineBanner({ severity: 'error', text: 'Couldn\'t reach Claude Code', actions: [{ label: 'Try Again', action: ['ask.retry', { key }] }, { label: 'Answer with Local Model', action: ['ask.local', { key }] }] }));
    }
    if (a.notFound) {
      return comp('cited-answer', { variant: 'not-found', state: 'ready', cls: 'ak-ans' }, html`
        ${a.scopeNote ? html`<div class="ak-note">${icon('info', { size: 13 })}<span>${a.scopeNote}</span>${P.button('Use Local Model', { size: 'small', action: ['ask.local', { key }] })}</div>` : ''}
        <p class="ak-ans__p">I could not find this in your calls.</p>
        <div class="ak-ans__acts">${P.button('Search by Keyword', { action: ['ask.keyword', { key }] })}${o.narrowed ? P.button('Widen Scope', { action: ['ask.widen', { key }] }) : ''}</div>`);
    }
    const streaming = a.status === 'searching' || a.status === 'reading';
    const resolved = a.status === 'ready' || a.status === 'stopped';
    const cited = {};
    (a.citations || []).forEach((c) => { cited[c.n] = c; });
    const sup = (n) => {
      const c = cited[n];
      const hl = L.hl === key + ':' + n;
      return html`<button type="button" class="ak-sup${hl ? ' is-hl' : ''}"${attrs({ disabled: !resolved ? true : null, 'aria-label': 'Citation ' + n })}${act('ask.cite', { key, n })}>${n}</button>`;
    };
    const paraHtml = (p) => {
      const parts = String(p).split(/\[(\d+)\]/);
      return parts.map((s, i) => (i % 2 ? (a.status === 'stopped' && !cited[+s] ? '' : sup(+s)) : esc(s))).map((x) => (typeof x === 'string' ? raw(x) : x));
    };
    const variant = a.weak ? 'weak-evidence' : (o.variant || 'answer');
    const state = streaming ? 'streaming' : a.status === 'stopped' ? 'stopped' : a.deleted ? 'cited-source-deleted' : (NP.flashed('ask-copy-' + key) ? 'copied' : 'ready');
    const paras = streaming ? (a.status === 'reading' ? a.paras.slice(0, 1).map((p) => p.slice(0, Math.floor(p.length * 0.55)) + '…') : []) : a.paras;
    return comp('cited-answer', { variant, state, cls: 'ak-ans' }, html`
      ${streaming ? html`<div class="ak-status np-muted">${P.progress({ variant: 'spinner', label: 'Answering' })}<span>${a.status === 'searching' ? 'Searching calls and documents…' : 'Reading 3 calls…'}</span></div>` : ''}
      ${a.weak && !streaming ? C.inlineBanner({ severity: 'warning', text: 'Based on weak matches. Check the citations before you rely on this answer.', actions: [o.narrowed ? { label: 'Widen Scope', action: ['ask.widen', { key }] } : null, { label: 'Search by Keyword', action: ['ask.keyword', { key }] }].filter(Boolean) }) : ''}
      <div class="ak-ans__body">${paras.map((p) => html`<p class="ak-ans__p">${paraHtml(p)}</p>`)}</div>
      ${!streaming && a.scopeNote ? html`<div class="ak-note">${icon('info', { size: 13 })}<span>${a.scopeNote}</span>${a.scopeAction ? P.button(a.scopeAction.label, { size: 'small', action: a.scopeAction.action }) : ''}</div>` : ''}
      ${!streaming && a.keywordOnly ? html`<div class="ak-note">${icon('info', { size: 13 })}<span>Searching by keyword only while the index rebuilds · 64 %</span>${P.progress({ value: 64, label: 'Index rebuild' })}</div>` : ''}
      ${!streaming ? html`<div class="ak-meta">${a.status === 'stopped' ? 'Stopped by you · ' : ''}${a.meta}</div>` : ''}
      ${!streaming ? html`<div class="ak-ans__acts">
        ${P.button('Copy with Citations', { action: ['ask.copy', { key }], flashKey: 'ask-copy-' + key, disabled: !resolved })}
        ${P.iconButton('thumbUp', { label: 'Helpful', size: 'toolbar', pressed: L.rate && L.rate[key] === 'up', action: ['ask.rate', { key, v: 'up' }] })}
        ${P.iconButton('thumbDown', { label: 'Not helpful', size: 'toolbar', pressed: L.rate && L.rate[key] === 'down', action: ['ask.rate', { key, v: 'down' }] })}
      </div>` : ''}
      ${(a.citations || []).length ? html`<div class="ak-cites"><div class="ak-cites__h">Citations</div>${(a.citations || []).map((c) => citation(c, key, L, resolved))}</div>` : ''}
      ${a.deleted && !streaming ? html`<div class="ak-ans__acts">${P.button('Ask Again', { action: ['ask.again', { key }] })}</div>` : ''}`);
  };
  const citation = (c, key, L, resolved) => {
    const hl = L.hl === key + ':' + c.n;
    const call = c.callId ? D.call(c.callId) : null;
    let head;
    if (c.deleted) head = html`<span class="np-dim">Source deleted</span>`;
    else if (c.kind === 'call') head = html`${C.provenanceChip({ kind: 'past-call', label: `${call.title} · ${call.date} · ${c.t}`, callId: c.callId, span: c.t }, { variant: 'inline' })}${c.suggested ? html`<span class="np-dim ak-cite__sugg">suggested, not reviewed</span>` : ''}`;
    else head = html`${C.provenanceChip({ kind: c.kind === 'lookup' ? 'lookup' : 'doc', label: `${c.title} · ${c.source ? c.source + ' · ' : ''}${c.section}`, external: true }, { variant: 'inline' })}`;
    return html`<div class="ak-cite${hl ? ' np-hl-evidence' : ''}${c.deleted ? ' is-deleted' : ''}" id="ak-cite-${key}-${c.n}">
      <span class="ak-cite__n np-tnum">${c.n}</span>
      <div class="ak-cite__main">
        <div class="ak-cite__head">${head}${c.kind === 'call' && !c.deleted ? html`${C.personChip(c.speaker, { variant: c.speaker === 'p-you' ? 'you' : 'link' })}${C.languageTag(c.lang)}` : ''}${c.weak ? P.badge('Weak match', { kind: 'status', tone: 'neutral' }) : ''}</div>
        ${c.kind === 'call' && !c.deleted ? html`<div class="ak-cite__quote" lang="${c.lang.toLowerCase()}">“${c.quote}”</div>` : ''}
        ${c.kind !== 'call' && !c.deleted ? html`<div class="ak-cite__fresh np-dim">${c.fresh}</div>` : ''}
      </div>
      ${c.kind === 'call' && !c.deleted ? P.iconButton(L.playing && L.playing.callId === c.callId && L.playing.t === c.t ? 'pause' : 'play', { label: 'Play ' + c.t, size: 'inline', disabled: !resolved || !!c.noAudio, help: c.noAudio ? 'No audio for this moment (system audio was lost)' : null, action: ['lib.play', { callId: c.callId, t: c.t, speaker: c.speaker, key: 'ask' }] }) : ''}
    </div>`;
  };
})();
