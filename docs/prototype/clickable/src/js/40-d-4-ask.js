/* =====================================================================
   Screen — Ask (cpt-noter-component-screen-ask)
   AK-R1 toolbar · AK-R2 recent questions · AK-R3 thread · AK-R4 composer · AK-R5 playback
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, icon, P, C, data: D, region } = NP;
  const KEY = 'ask';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SCOPES = [
    { value: 'all', label: 'All calls · all sources' },
    { value: 'calls', label: 'All calls · no documents' },
    { value: 'planning', label: 'Planning calls · last 30 days' },
    { value: 'anna', label: 'Calls with Anna K.' },
    { value: 'topic', label: 'Topic: Websocket notifications' },
  ];
  const keyFor = (q) => {
    const s = String(q).toLowerCase();
    if (/websocket|уведомл|notification|reconnect|decide|decision|open from the planning|drawer/.test(s)) return 'websocket';
    if (/anna|аня|1:1/.test(s)) return 'anna';
    if (/openstack/.test(s)) return 'openstack';
    if (/\bqa\b|handover|checklist|übergab|schnittstell/.test(s)) return 'qa';
    if (/retention|vendor|monitor/.test(s)) return 'retention';
    return null;
  };
  const answerFor = (k, opts) => {
    opts = opts || {};
    if (k === 'retention') {
      if (opts.local) return Object.assign(clone(D.askAnswers.retentionLocal), { status: 'ready' });
      return { notFound: true, scopeNote: '1 sensitive source was not searched because this answer uses a cloud model', status: 'ready' };
    }
    if (!k || !D.askAnswers[k]) return { notFound: true, status: 'ready' };
    const a = Object.assign(clone(D.askAnswers[k]), { status: 'ready' });
    if (opts.local) { a.local = true; a.meta = 'Answered by the local model · ' + a.meta.replace(/^Answered /, 'answered ').replace(/^answered from/, 'from'); }
    return a;
  };
  const seedThread = (k) => {
    const r = D.askRecent.find((x) => x.key === k) || D.askRecent[0];
    return { id: 'th-' + k + '-' + Date.now(), q: r.q, turns: [{ q: r.q, a: answerFor(r.key) }] };
  };
  const L = () => NP.dLocal(KEY, () => {
    const threads = D.askRecent.map((r, i) => ({ id: 'th-' + i, q: r.q, group: r.group, turns: [{ q: r.q, a: answerFor(r.key) }] }));
    return { threads, cur: threads[0].id, draft: '', scope: 'all', hl: null, playing: null, rate: {}, local: false };
  });
  const curThread = () => { const l = L(); return l.threads.find((t) => t.id === l.cur) || null; };
  const runtimeMode = () => (L().local ? { runtime: 'Local model', mode: 'Local only' } : { runtime: 'Claude Code', mode: 'Cloud, redacted' });

  const send = (q) => {
    q = String(q || '').trim();
    if (!q) return;
    const l = L();
    let t = curThread();
    if (!t || t.empty) { t = { id: 'th-n' + Date.now(), q, group: 'Today', turns: [] }; l.threads.unshift(t); l.cur = t.id; }
    const k = keyFor(q);
    const turn = { q, a: { status: 'searching', paras: (D.askAnswers[k] || D.askAnswers.websocket).paras, citations: [] } };
    t.turns.push(turn);
    l.draft = '';
    l.answering = turn;
    const idx = t.turns.length - 1;
    setTimeout(() => { if (turn.a.status === 'searching') { turn.a.status = 'reading'; NP.render(); } }, 900);
    setTimeout(() => {
      if (turn.a.status !== 'reading' && turn.a.status !== 'searching') return;
      if (NP.demo(KEY) === 'unreachable' && !l.local) turn.a = { error: true, q };
      else turn.a = answerFor(k, { local: l.local });
      if (idx > 0) turn.a.followUp = true;
      l.answering = null;
      NP.render();
    }, 2100);
  };

  const turnView = (t, turn, i, ctx) => {
    const key = t.id + '-' + i;
    const narrowed = L().scope !== 'all';
    return html`<article class="ak-turn" aria-label="Question ${i + 1}">
      <h3 class="ak-q t-headline">${turn.q}</h3>
      ${C.citedAnswer(turn.a, { key, variant: i > 0 ? 'follow-up' : 'answer', narrowed })}
    </article>`;
  };

  const threadView = (ctx) => {
    const l = L();
    const t = curThread();
    const mode = runtimeMode();
    const empty = !t || t.empty || !t.turns.length;
    const infoLines = html`
      ${ctx.demo === 'keyword-only' ? html`<div class="ak-note">${icon('info', { size: 13 })}<span>Searching by keyword only while the index rebuilds · 64 %</span>${P.progress({ value: 64, label: 'Index rebuild' })}</div>` : ''}
      ${ctx.demo === 'sensitive' && !l.local ? html`<div class="ak-note">${icon('info', { size: 13 })}<span>2 sensitive sources were not searched because this answer uses a cloud model</span>${P.button('Use Local Model', { size: 'small', action: ['ask.useLocal'] })}</div>` : ''}`;
    const composer = region('AK-R4', { label: 'Ask a question', cls: 'ak-composer' + (empty ? ' is-first' : '') }, html`
      ${P.textField({ id: 'ask-composer', variant: 'multi', rows: empty ? 3 : 2, placeholder: empty ? 'Ask about your calls and documents…' : 'Ask a follow-up…', bind: 'local.ask.draft', value: l.draft, ariaLabel: 'Question', cls: 'ak-composer__field' })}
      ${l.answering ? P.button('Stop', { kbd: '⌘.', action: ['ask.stop'] }) : P.button('Ask', { variant: 'primary', action: ['ask.send'], shortcut: 'Enter' })}`);
    if (empty) {
      return region('AK-R3', { label: 'Thread', cls: 'ak-thread' }, html`
        <h2 class="t-title2 ak-first__h">Ask anything about your calls and documents</h2>
        ${infoLines}
        ${composer}
        <div class="ak-suggs">${D.askSuggestions.map((s) => P.button(s, { variant: 'quiet', cls: 'ak-sugg', action: ['ask.suggest', { q: s }] }))}</div>`);
    }
    return region('AK-R3', { label: 'Thread', cls: 'ak-thread' }, html`
      ${infoLines}
      ${t.turns.map((turn, i) => turnView(t, turn, i, ctx))}
      ${composer}
      ${l.playing ? region('AK-R5', { label: 'Playback', cls: 'ak-playbar' }, NP.c('playbackBar', { variant: 'result', callId: l.playing.callId, at: l.playing.t, speaker: l.playing.speaker, key: KEY })) : ''}`);
  };

  const recentView = () => {
    const l = L();
    const real = l.threads.filter((t) => !t.empty);
    if (!real.length) return region('AK-R2', { label: 'Recent questions', cls: 'ak-recent' }, html`<div class="ak-recent__empty np-muted">Your questions appear here</div>`);
    const groups = [];
    real.forEach((t) => { const g = t.group || 'Today'; let G = groups.find((x) => x.g === g); if (!G) groups.push(G = { g, items: [] }); G.items.push(t); });
    return region('AK-R2', { label: 'Recent questions', cls: 'ak-recent' }, html`<div role="list"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'source-list', 'data-variant': 'recent-questions' })}>${groups.map((G) => html`<div class="np-srclist__group" data-variant="group-header">${G.g}</div>${G.items.map((t) => html`<a href="#" role="listitem" class="ak-recent__item${t.id === l.cur ? ' is-sel' : ''}" data-variant="item" data-state="${t.id === l.cur ? 'selected' : 'default'}" data-proto-anchor="ak-r-${t.id}" ${act('ask.open', { id: t.id })} title="${t.q}">${t.q}</a>`)}`)}</div>`);
  };

  NP.screen(KEY, {
    title: 'Ask',
    subtitle: () => (L().answering ? 'Answering…' : ''),
    search: true,
    toolbarActions: (ctx) => {
      const m = runtimeMode();
      return html`${P.button('New Question', { icon: 'plus', action: ['ask.new'], shortcut: 'Meta+N', help: 'New Question (⌘N)' })}
        ${P.popup(SCOPES, L().scope, { id: 'ask-scope', label: 'Scope', variant: 'toolbar', action: ['ask.scope'] })}
        ${C.modeIndicator({ variant: 'ask', runtime: m.runtime, mode: m.mode, key: 'ask' })}`;
    },
    states: [
      { id: 'default', label: 'Answer ready' },
      { id: 'first', label: 'First question' },
      { id: 'answering', label: 'Answering (streams)' },
      { id: 'not-found', label: 'Not found' },
      { id: 'unreachable', label: 'Claude Code unreachable' },
      { id: 'local', label: 'Answered locally' },
      { id: 'sensitive', label: 'Sensitive sources skipped' },
      { id: 'keyword-only', label: 'Keyword-only index' },
      { id: 'weak', label: 'Only weak evidence' },
      { id: 'deleted', label: 'Cited source deleted' },
    ],
    onDemo: (id) => {
      const keep = NP.state.local[KEY] ? NP.state.local[KEY].lastParams : null;
      delete NP.state.local[KEY];
      const l = L();
      l.lastParams = keep;
      l.local = id === 'local';
      l.playing = null; l.hl = null; l.answering = null;
      const set = (t) => { l.threads = l.threads.filter((x) => !x.empty && x.q !== t.q); l.threads.unshift(t); l.cur = t.id; };
      if (id === 'first') { l.threads = [{ id: 'th-empty', empty: true, turns: [] }]; l.cur = 'th-empty'; l.draft = ''; }
      if (id === 'answering') { set({ id: 'th-new' + Date.now(), empty: true, turns: [] }); send('What did we agree with backend about the websocket notifications, and what is open?'); }
      if (id === 'not-found') set({ id: 'th-nf', q: 'When is the Lizenzprüfung im Installer due?', group: 'Today', turns: [{ q: 'When is the Lizenzprüfung im Installer due?', a: { notFound: true, status: 'ready' } }] });
      if (id === 'unreachable') set({ id: 'th-err', q: 'What did we decide about the notification service?', group: 'Today', turns: [{ q: 'What did we decide about the notification service?', a: { error: true } }] });
      if (id === 'local') set({ id: 'th-loc', q: 'What did the monitoring vendor promise about data retention?', group: 'Today', turns: [{ q: 'What did the monitoring vendor promise about data retention?', a: answerFor('retention', { local: true }) }] });
      if (id === 'sensitive') set({ id: 'th-sens', q: 'What did the monitoring vendor promise about data retention?', group: 'Today', turns: [{ q: 'What did the monitoring vendor promise about data retention?', a: answerFor('retention') }] });
      if (id === 'keyword-only') { const t = seedThread('websocket'); t.turns[0].a.keywordOnly = true; set(t); }
      if (id === 'weak') { l.scope = 'planning'; set(seedThread('qa')); }
      if (id === 'deleted') { const t = seedThread('websocket'); t.turns[0].a.deleted = true; t.turns[0].a.citations[0] = { n: 1, kind: 'call', deleted: true }; set(t); }
    },
    render: (ctx) => {
      const l = L();
      // arriving from Library › Ask Instead / Ask About This: ask once
      const p = ctx.params;
      const sig = JSON.stringify(p);
      if ((p.q || p.scopeTopic) && l.lastParams !== sig) {
        l.lastParams = sig;
        if (p.scopeTopic) l.scope = 'topic';
        const topic = p.scopeTopic ? (D.topics.find((x) => x.id === p.scopeTopic) || {}).name : null;
        l.threads.unshift({ id: 'th-in' + Date.now(), empty: true, turns: [] }); l.cur = l.threads[0].id;
        setTimeout(() => { send(p.q || `What was decided and what is still open about ${topic}?`); NP.render(); }, 0);
      }
      return html`<div class="ak-split">${recentView()}${threadView(ctx)}</div>`;
    },
  });

  NP.onMany({
    'ask.new': () => { const l = L(); l.threads = l.threads.filter((t) => !t.empty); l.threads.unshift({ id: 'th-e' + Date.now(), empty: true, turns: [] }); l.cur = l.threads[0].id; l.draft = ''; l.playing = null; setTimeout(() => { const f = document.getElementById('ask-composer'); if (f) f.focus(); }, 30); },
    'ask.open': (a) => { const l = L(); l.cur = a.id; l.playing = null; l.hl = null; },
    'ask.scope': (a) => { L().scope = a.value; },
    'ask.send': () => { const f = document.getElementById('ask-composer'); const v = f ? f.value : L().draft; if (f) f.value = ''; send(v); },
    'ask.suggest': (a) => { send(a.q); },
    'ask.stop': () => { const l = L(); const turn = l.answering; if (turn) { const k = keyFor(turn.q); turn.a = Object.assign(answerFor(k), { status: 'stopped' }); if (turn.a.paras) turn.a.paras = turn.a.paras.slice(0, 1); turn.a.citations = (turn.a.citations || []).filter((c) => String(turn.a.paras[0]).includes('[' + c.n + ']')); l.answering = null; } },
    'ask.cite': (a) => {
      const l = L(); l.hl = a.key + ':' + a.n;
      setTimeout(() => { const el = document.getElementById('ak-cite-' + a.key + '-' + a.n); if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }, 30);
      setTimeout(() => { if (l.hl === a.key + ':' + a.n) { l.hl = null; NP.render(); } }, 3000);
    },
    'ask.copy': (a) => {
      const t = curThread(); const turn = t && t.turns[+String(a.key).split('-').pop()];
      const text = turn && turn.a.paras ? turn.a.paras.join('\n\n') + '\n\n' + (turn.a.citations || []).map((c) => `${c.n}. ${c.callId ? D.call(c.callId).title + ', ' + D.call(c.callId).date + ', ' + c.t : c.title}`).join('\n') : '';
      try { navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* the viewer may refuse */ }
      NP.flash('ask-copy-' + a.key, 'Copied', 2000);
    },
    'ask.rate': (a) => { const r = L().rate; r[a.key] = r[a.key] === a.v ? null : a.v; },
    'ask.keyword': (a) => { const t = curThread(); NP.go('library', { view: 'search', q: t ? t.turns[t.turns.length - 1].q : '' }); return false; },
    'ask.widen': () => { const l = L(); l.scope = 'all'; const t = curThread(); if (t) { const q = t.turns[t.turns.length - 1].q; send(q); } },
    'ask.retry': () => { const t = curThread(); if (!t) return; const turn = t.turns[t.turns.length - 1]; NP.state.demo[KEY] = 'default'; turn.a = { status: 'searching', paras: D.askAnswers.websocket.paras, citations: [] }; const k = keyFor(turn.q); setTimeout(() => { turn.a = answerFor(k); NP.render(); }, 1400); },
    'ask.local': () => { const l = L(); l.local = true; const t = curThread(); if (!t) return; const turn = t.turns[t.turns.length - 1]; turn.a = { status: 'reading', paras: D.askAnswers.websocket.paras, citations: [] }; const k = keyFor(turn.q); setTimeout(() => { turn.a = answerFor(k, { local: true }); NP.render(); }, 1600); },
    'ask.useLocal': () => { const l = L(); l.local = true; NP.state.demo[KEY] = 'local'; const t = curThread(); if (t) { const turn = t.turns[t.turns.length - 1]; turn.a = answerFor(keyFor(turn.q), { local: true }); } },
    'ask.again': () => { const t = curThread(); if (t) { const turn = t.turns[t.turns.length - 1]; turn.a = answerFor(keyFor(turn.q)); turn.a.citations = turn.a.citations.slice(1).map((c, i) => Object.assign(c, { n: i + 1 })); turn.a.paras = ['Dmitri S. reaffirmed in today\'s planning call that drawer events go through the notification service [1] and will add a replay buffer for reconnects, tracked as VSTOR-9912 [2].', 'Still open: who owns the acceptance criteria for the reconnect handling [3]. The Drawer spec describes event delivery over the websocket with replay after a reconnect [4].']; turn.a.meta = 'Answered from 1 call and 1 document · 1 lookup · 5.0 s · nothing from the model\'s own knowledge'; } },
  });

  /* Return sends, ⇧Return adds a line (the core only wires Return on single-line inputs) */
  NP.onAfterRender(() => {
    const f = document.getElementById('ask-composer');
    if (f && !f._d) {
      f._d = true;
      f.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const v = f.value; f.value = ''; send(v); NP.render(); }
        if (ev.key === '.' && ev.metaKey) { ev.preventDefault(); NP.actions['ask.stop'](); NP.render(); }
      });
    }
  });
})();
