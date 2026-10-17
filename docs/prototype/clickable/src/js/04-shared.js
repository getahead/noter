/* =====================================================================
   Shared small components used on many screens (DESIGN 3.2, table B):
   recording-indicator (3), mode-indicator (4), speaker-label (10),
   language-tag (11), agent-badge (16), provenance-chip (17),
   person-chip (34), topic-chip (36), undo-strip (38), empty-state (54),
   inline-banner (55), inline-status (56)
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, data: D } = NP;
  const C = NP.C;

  /* ---------- 3. Recording indicator ----------
     variant: dot-text | dot | button | live-row ; status: recording | paused | mic-only | no-mic | not-recording | stopped */
  C.recordingIndicator = (o) => {
    o = o || {};
    const st = o.status || (NP.state.rec.status === 'paused' ? 'paused' : 'recording');
    const word = { recording: 'Recording', paused: 'Paused', 'mic-only': 'Recording · mic only', 'no-mic': 'Recording · no mic', 'not-recording': 'Not recording', stopped: 'Stopped' }[st];
    const dot = st === 'stopped' || st === 'not-recording' ? '' : html`<span class="np-recdot${st === 'paused' ? ' is-paused' : ''}" aria-hidden="true">${st === 'mic-only' || st === 'no-mic' ? icon('warning', { size: 9 }) : ''}</span>`;
    const variant = o.variant || 'dot-text';
    if (variant === 'button') {
      return comp('recording-indicator', { variant, state: st, tag: 'button', cls: 'np-btn np-btn--secondary np-btn--regular np-recind np-recind--button', attrs: { type: 'button', 'aria-label': word + ', show the call window', title: 'Show the call window (⌃⌥⌘N)', 'data-proto-action': (o.action && o.action[0]) || 'call.show', 'data-proto-args': o.action && o.action[1] ? JSON.stringify(o.action[1]) : null } }, html`${dot}${NP.clock(true)}`);
    }
    if (variant === 'dot') {
      return comp('recording-indicator', { variant, state: st, tag: 'span', cls: 'np-recind np-recind--dot', attrs: { role: 'img', 'aria-label': word } }, html`${dot}${o.clock === false ? '' : NP.clock(false)}`);
    }
    if (variant === 'live-row') {
      return comp('recording-indicator', { variant, state: st, tag: 'button', cls: 'np-recind np-recind--row', attrs: { type: 'button', 'data-proto-action': 'call.show', title: 'Show the call window without leaving this page' } },
        html`${dot}<span class="np-recind__title">${o.title || D.call(NP.state.rec.callId).title.split(':')[0]}</span><span class="np-recind__sep">·</span>${st === 'paused' ? html`<span>Paused</span>` : NP.clock(true)}`);
    }
    return comp('recording-indicator', { variant, state: st, tag: 'span', cls: 'np-recind np-recind--text' },
      html`${dot}<span class="np-recind__word${st === 'stopped' || st === 'not-recording' ? '' : ' is-rec'}">${word}</span>${o.clock === false || st === 'stopped' || st === 'not-recording' ? '' : html` ${NP.clock(false)}`}`);
  };

  /* Capture health of the live call (PM-60, PM-67): which channel is silent, or the engine stopped.
     Returns ok | mic-only (system audio silent) | no-mic (microphone off) | engine-stopped */
  NP.captureHealth = () => {
    const L = NP.state.local.cw || {};
    const setup = NP.state.setup;
    if (L.engineStopped) return 'engine-stopped';
    if (L.micOnly || setup.sysGranted === false) return 'mic-only';
    if (L.noMic || setup.micGranted === false) return 'no-mic';
    return 'ok';
  };
  /* Indicator status for the live call: recording | paused | mic-only | no-mic | not-recording */
  NP.liveStatus = () => {
    const h = NP.captureHealth();
    if (h === 'engine-stopped') return 'not-recording';
    if (NP.state.rec.status === 'paused') return 'paused';
    return h === 'ok' ? 'recording' : h;
  };

  /* ---------- 4. Mode indicator ----------
     mode: 'Cloud' | 'Cloud, redacted' | 'Local only' | 'Sensitive · local' | 'Switched to local' | 'No assistant'
     variant: call-header | floating | glyph | sidebar | ask | call-info | settings | menu-line */
  const MODE_ICON = { 'Cloud': 'cloud', 'Cloud, redacted': 'cloudLock', 'Local only': 'laptop', 'Sensitive · local': 'lock', 'Switched to local': 'warning', 'No assistant': 'warning' };
  C.modeIndicator = (o) => {
    o = o || {};
    const mode = o.mode || NP.state.rec.mode || 'Cloud, redacted';
    const degraded = mode === 'Switched to local' || mode === 'No assistant';
    const variant = o.variant || 'call-header';
    const anchor = 'mode-' + variant + (o.key || '');
    const label = o.runtime ? `${o.runtime} · ${mode}` : (o.text || mode);
    if (variant === 'menu-line') return comp('mode-indicator', { variant, state: degraded ? 'degraded' : 'normal', tag: 'span', cls: 'np-mode np-mode--line' }, label);
    const inner = variant === 'glyph' ? icon(MODE_ICON[mode] || 'cloud', { size: 13, label: mode }) : html`${icon(MODE_ICON[mode] || 'cloud', { size: 13 })}<span class="np-mode__word">${label}</span>`;
    return comp('mode-indicator', { variant, state: degraded ? 'degraded' : 'normal', tag: 'button', cls: 'np-mode np-mode--' + variant + (degraded ? ' is-warn' : ''), attrs: { type: 'button', 'data-proto-action': 'mode.popover', 'data-proto-args': JSON.stringify({ anchor, mode, variant, where: o.where }), 'data-proto-anchor': anchor, 'aria-haspopup': 'dialog', title: 'Privacy mode: ' + mode } }, inner);
  };
  const MODE_TEXT = {
    'Cloud': 'Transcript excerpts go to your assistant in the cloud. Audio never leaves this Mac.',
    'Cloud, redacted': 'Cloud with redaction: names and PII are replaced before anything leaves this Mac.',
    'Local only': 'Everything runs on this Mac with the local model. Nothing leaves it.',
    'Sensitive · local': 'This call is sensitive. From now on, nothing from this call leaves this Mac.',
    'Switched to local': 'Claude Code did not answer, so Noter switched to the local model. It tries Claude again in 10 min.',
    'No assistant': 'No API key and no local model. Recording and transcription still work; summaries and cards wait.',
  };
  NP.overlay('mode-info', {
    kind: 'popover',
    render: (p) => html`<div class="np-pop__body" style="max-width:340px">
      <div class="np-pop__title">${icon(MODE_ICON[p.mode] || 'cloud', { size: 14 })} ${p.mode}</div>
      <p class="np-pop__text">${MODE_TEXT[p.mode] || ''}</p>
      <div class="np-pop__actions">
        ${p.variant === 'call-header' || p.variant === 'floating' ? P.button('Make This Call Sensitive', { size: 'small', action: ['call.makeSensitive'] }) : ''}
        ${p.variant === 'call-info' ? P.button('Mark as Sensitive', { size: 'small', action: ['proto.flash', { key: 'mode', text: 'Marked as sensitive' }] }) : ''}
        ${p.variant !== 'settings' ? P.button('Open Privacy Settings', { size: 'small', variant: 'quiet', action: ['settings.open', { pane: 'privacy' }] }) : ''}
      </div></div>`,
  });
  NP.on('mode.popover', (a) => { NP.state.popover = { id: 'mode-info', anchor: a.anchor, props: a }; NP.state.menu = null; });

  /* ---------- 10. Speaker label ----------
     speaker: person id | 'Speaker 2' | 'Guest (your side)' | ['p-anna','Speaker 3'] (crosstalk) */
  C.speakerLabel = (speaker, o) => {
    o = o || {};
    if (Array.isArray(speaker)) {
      const names = speaker.map((s) => (s.startsWith('p-') ? D.person(s).short : s)).join(' / ');
      return comp('speaker-label', { variant: 'crosstalk', tag: 'span', cls: 'np-spk is-secondary' }, names);
    }
    const isPerson = speaker.startsWith('p-');
    const you = speaker === 'p-you';
    const variant = you ? 'you' : isPerson ? 'resolved' : speaker.startsWith('Guest') ? 'guest' : 'unresolved';
    const name = isPerson ? D.person(speaker).short : speaker;
    if (you || o.static) return comp('speaker-label', { variant, tag: 'span', cls: 'np-spk' + (isPerson ? '' : ' is-secondary') }, name);
    const anchor = 'spk-' + (o.key || '') + '-' + name.replace(/\W+/g, '');
    return comp('speaker-label', { variant, tag: 'button', cls: 'np-spk np-spk--btn' + (isPerson ? '' : ' is-secondary'), attrs: { type: 'button', 'data-proto-anchor': anchor, 'data-proto-action': 'speaker.rename', 'data-proto-args': JSON.stringify({ anchor, speaker, name, where: o.where }), 'aria-haspopup': 'dialog', title: 'Rename ' + name } }, name);
  };
  NP.on('speaker.rename', (a) => {
    if (NP.overlays['speaker-rename']) { NP.state.popover = { id: 'speaker-rename', anchor: a.anchor, props: a }; NP.state.menu = null; }
    else NP.flash('proto', 'Rename popover is provided by the call window module');
  });

  /* ---------- 11. Language tag ---------- variant: segment | call | filter */
  const LANG = { EN: 'English', RU: 'Russian', DE: 'German' };
  C.languageTag = (code, o) => {
    o = o || {};
    const low = o.conf != null && o.conf < 0.75;
    const help = `${LANG[code] || code}${o.conf != null ? ' · ' + String(o.conf).replace(/^0/, '0') : ''}`;
    return comp('language-tag', { variant: o.variant || 'segment', state: low ? 'low-confidence' : 'default', tag: 'span', cls: 'np-lang' + (low ? ' is-low' : ''), attrs: { title: help, 'aria-label': help } }, low ? code + '?' : code);
  };

  /* ---------- 16. Agent badge ---------- variant: static | interactive */
  C.agentBadge = (name, o) => {
    o = o || {};
    const merged = o.merged && o.merged.length ? html`<span class="np-agent__merged">+ ${o.merged.join(', ')}</span>` : '';
    const short = name.length > 16 ? name.slice(0, 15) + '…' : name;
    if (o.variant === 'interactive') {
      const anchor = 'agent-' + (o.key || '') + name.replace(/\W+/g, '');
      NP._menus[anchor] = [{ label: 'Mute ' + name + ' for This Call', action: ['proto.flash', { key: 'call-status', text: name + ' muted for this call', ms: 3000 }] }, { label: 'Open Agent Settings', action: ['nav.go', { screen: 'agents', params: { agent: name } }] }];
      return html`${comp('agent-badge', { variant: 'interactive', tag: 'button', cls: 'np-agent np-agent--btn', attrs: { type: 'button', title: name, 'data-proto-anchor': anchor, 'data-proto-action': 'proto.menu', 'data-proto-args': JSON.stringify({ anchor }), 'aria-haspopup': 'menu' } }, short)}${merged}`;
    }
    return html`${comp('agent-badge', { variant: 'static', tag: 'span', cls: 'np-agent', attrs: { title: name } }, short)}${merged}`;
  };

  /* ---------- 17. Provenance chip ----------
     prov: {kind: this-call|past-call|jira|doc|lookup|guess|screen, label, callId, span, external}
     variant: chip | inline | timestamp | unverified */
  const PROV_ICON = { 'this-call': 'wave', 'past-call': 'history', jira: 'ticket', doc: 'doc', lookup: 'search', guess: 'warning', screen: 'display' };
  C.provenanceChip = (prov, o) => {
    o = o || {};
    if (!prov) return '';
    if (prov.kind === 'guess') return comp('provenance-chip', { variant: 'unverified', tag: 'span', cls: 'np-prov np-prov--guess' }, html`${icon('warning', { size: 11 })}Model guess · unverified`);
    if (prov.loading) return comp('provenance-chip', { variant: o.variant || 'chip', state: 'loading', tag: 'span', cls: 'np-prov is-loading' }, 'Finding the source…');
    if (prov.deleted) return comp('provenance-chip', { variant: o.variant || 'chip', state: 'source-deleted', tag: 'span', cls: 'np-prov is-disabled' }, 'Source deleted');
    const variant = o.variant || 'chip';
    const ext = prov.external || prov.kind === 'jira' || prov.kind === 'doc';
    const target = prov.callId || (prov.kind === 'this-call' ? (o.callId || NP.state.rec.callId) : null);
    const args = target ? { screen: 'call-page', params: { callId: target, view: 'transcript', span: prov.span || (prov.label.match(/\d\d:\d\d:\d\d/) || [])[0] } } : null;
    const label = variant === 'timestamp' ? (prov.span || prov.label) : prov.label;
    return comp('provenance-chip', { variant, state: (prov.notReviewed ? 'not-reviewed' : ext ? 'external' : 'default'), tag: 'a', cls: 'np-prov np-prov--' + variant, attrs: { href: '#', 'data-proto-action': args ? (o.inCallWindow ? 'call.spanPreview' : 'nav.go') : 'proto.flash', 'data-proto-args': JSON.stringify(args ? Object.assign({}, args, { label: prov.label }) : { key: 'prov', text: 'Opens ' + prov.label + ' in its app' }), title: prov.label } },
      html`${variant === 'timestamp' ? '' : icon(PROV_ICON[prov.kind] || 'link', { size: 11 })}<span class="np-prov__text">${label}${prov.notReviewed ? ' · not reviewed' : ''}</span>${ext || variant === 'timestamp' ? html`<span aria-hidden="true">↗</span>` : ''}`);
  };

  /* ---------- 34. Person chip ----------
     variant: link | you | unnamed | owner-picker | call-window | text */
  C.personChip = (who, o) => {
    o = o || {};
    const isPerson = typeof who === 'string' && who.startsWith('p-');
    const p = isPerson ? D.person(who) : { id: null, short: who, initials: '?' };
    const you = p.id === 'p-you';
    let variant = o.variant || (you ? 'you' : isPerson ? 'link' : 'unnamed');
    const circle = variant === 'text' ? '' : html`<span class="np-person__ini" aria-hidden="true">${you ? 'Y' : isPerson ? p.initials : '?'}</span>`;
    const name = html`<span class="np-person__name">${p.short}</span>`;
    if (variant === 'you' || o.readonly) return comp('person-chip', { variant: o.readonly ? 'read-only' : 'you', tag: 'span', cls: 'np-person' }, html`${circle}${name}`);
    if (variant === 'owner-picker') {
      const anchor = 'owner-' + (o.key || '') ;
      return comp('person-chip', { variant, tag: 'button', cls: 'np-person np-person--picker', attrs: { type: 'button', 'data-proto-anchor': anchor, 'data-proto-action': 'person.pick', 'data-proto-args': JSON.stringify({ anchor, itemId: o.itemId, current: who }), 'aria-haspopup': 'dialog' } }, html`${circle}${name}${icon('chevronDown', { size: 10 })}`);
    }
    if (variant === 'unnamed') {
      const anchor = 'unnamed-' + (o.key || '') + String(who).replace(/\W+/g, '');
      return comp('person-chip', { variant, tag: 'button', cls: 'np-person is-secondary', attrs: { type: 'button', 'data-proto-anchor': anchor, 'data-proto-action': 'person.pick', 'data-proto-args': JSON.stringify({ anchor, speaker: who, callId: o.callId }), title: 'Name ' + who } }, html`${circle}${name}`);
    }
    if (variant === 'call-window') {
      return comp('person-chip', { variant, tag: 'span', cls: 'np-person np-person--cw' }, html`${circle}${C.speakerLabel(who, { key: 'hdr', where: 'call-window' })}`);
    }
    if (variant === 'text') return comp('person-chip', { variant, tag: 'a', cls: 'np-person np-person--text', attrs: { href: '#', 'data-proto-action': 'nav.go', 'data-proto-args': JSON.stringify({ screen: 'person', params: { id: p.id } }), title: p.name } }, p.short);
    return comp('person-chip', { variant: 'link', tag: 'a', cls: 'np-person np-person--link', attrs: { href: '#', 'data-proto-action': 'nav.go', 'data-proto-args': JSON.stringify({ screen: 'person', params: { id: p.id } }), title: p.name, lang: p.lang } }, html`${circle}${name}`);
  };
  NP.on('person.pick', (a) => {
    if (NP.overlays['person-picker']) { NP.state.popover = { id: 'person-picker', anchor: a.anchor, props: a }; NP.state.menu = null; }
    else NP.flash('proto', 'Person picker is provided by the call window module');
  });

  /* ---------- 36. Topic chip ---------- variant: name | count | suggestion */
  C.topicChip = (topicId, o) => {
    o = o || {};
    const t = D.topics.find((x) => x.id === topicId) || { id: topicId, name: topicId };
    const variant = o.variant || 'name';
    const merge = t.mergeWith && o.showMerge !== false;
    const mergeName = merge ? (D.topics.find((x) => x.id === t.mergeWith) || {}).name : null;
    const counts = variant === 'count' ? ` · ${t.calls} calls` : variant === 'suggestion' ? ` · ${t.calls} calls · ${t.decisions} decision${t.decisions === 1 ? '' : 's'} · ${t.open} open question${t.open === 1 ? '' : 's'}` : '';
    return comp('topic-chip', { variant, state: merge ? 'merge-suggested' : 'default', tag: 'a', cls: 'np-topic np-topic--' + variant, attrs: { href: '#', lang: t.lang, 'data-proto-action': 'nav.go', 'data-proto-args': JSON.stringify({ screen: 'library', params: { view: 'thread', topicId: t.id } }), title: merge ? `Looks like the same subject as “${mergeName}”` : t.name } },
      html`${icon('thread', { size: 11 })}<span class="np-topic__name">${t.name}</span>${counts ? html`<span class="np-topic__counts">${counts}</span>` : ''}${merge ? icon('merge', { size: 11, label: 'Merge suggested' }) : ''}`);
  };

  /* ---------- 38. Undo strip ----------
     Rendered from NP.state.undo by the host via C.undoStrip({where}); variant after-action | after-undo | sticky */
  C.undoStrip = (o) => {
    o = o || {};
    const u = NP.state.undo;
    if (!u || (o.where && u.where !== o.where && u.where !== 'any')) return '';
    const variant = o.variant || (u.label === 'Redo' ? 'after-undo' : 'after-action');
    return comp('undo-strip', { variant, state: 'visible', cls: 'np-undo' + (o.sticky ? ' is-sticky' : ''), attrs: { role: 'status' } },
      html`<div class="np-undo__text"><div class="np-undo__msg">${u.message}</div>${u.context ? html`<div class="np-undo__ctx">${u.context}</div>` : ''}</div>
      ${P.button(u.label, { size: 'small', action: ['undo.run'] })}
      ${P.iconButton('x', { label: 'Dismiss', size: 'inline', action: ['undo.dismiss'] })}`);
  };
  NP.on('undo.run', () => {
    const u = NP.state.undo; if (!u) return;
    if (u.action && NP.actions[u.action]) NP.actions[u.action](u.args || {});
    if (u.label === 'Undo') NP.undo(u.redoMessage || ('Undone: ' + u.message.charAt(0).toLowerCase() + u.message.slice(1)), { label: 'Redo', where: u.where, action: u.redoAction, args: u.args, context: u.context });
    else NP.state.undo = null;
  });
  NP.on('undo.dismiss', () => { NP.state.undo = null; });

  /* ---------- 54. Empty state ---------- variant: first-use | filtered | section | large */
  C.emptyState = (o) => {
    o = o || {};
    const variant = o.variant || 'first-use';
    if (variant === 'section') return comp('empty-state', { variant, cls: 'np-empty np-empty--section' }, o.title);
    return comp('empty-state', { variant, cls: 'np-empty np-empty--' + variant },
      html`${variant !== 'filtered' ? html`<div class="np-empty__glyph">${icon(o.icon || 'inbox', { size: 28 })}</div>` : ''}
      <div class="np-empty__title">${o.title}</div>
      ${o.body ? html`<div class="np-empty__body">${o.body}</div>` : ''}
      ${o.actionLabel ? html`<div class="np-empty__act">${P.button(o.actionLabel, { variant: variant === 'filtered' ? 'secondary' : 'primary', action: o.action })}</div>` : ''}
      ${o.linkLabel ? html`<div>${P.link(o.linkLabel, { action: o.linkAction })}</div>` : ''}`);
  };

  /* ---------- 55. Inline banner ----------
     severity: info | warning | error | degraded | success ; compact ; actions: [{label, action, variant}] ; progress ; more (count) */
  const SEV_ICON = { info: 'info', warning: 'warning', error: 'error', degraded: 'warning', success: 'checkCircle' };
  C.inlineBanner = (o) => {
    o = o || {};
    const sev = o.severity || 'info';
    const dismissible = o.dismissible != null ? o.dismissible : (sev === 'info' || sev === 'success');
    return comp('inline-banner', { variant: (o.compact ? 'compact-' : '') + sev, state: o.state || 'shown', region: o.region, cls: 'np-banner np-banner--' + sev + (o.compact ? ' is-compact' : ''), attrs: { role: sev === 'error' ? 'alert' : 'status' } },
      html`<span class="np-banner__icon">${icon(SEV_ICON[sev], { size: 15 })}</span>
      <div class="np-banner__main">
        ${o.title ? html`<div class="np-banner__title">${o.title}</div>` : ''}
        <div class="np-banner__text">${o.text}</div>
        ${o.progress != null ? html`<div class="np-banner__prog">${P.progress({ value: o.progress, label: o.text })}<span class="np-tnum">${o.progress} %</span></div>` : ''}
      </div>
      <div class="np-banner__actions">
        ${(o.actions || []).map((a) => a.link ? P.link(a.label, { action: a.action }) : P.button(a.label, { size: 'small', variant: a.variant || 'secondary', action: a.action, loading: a.loading }))}
        ${o.more ? P.button('+' + o.more + ' More', { size: 'small', variant: 'quiet', action: o.moreAction || ['banner.more'] }) : ''}
        ${dismissible && o.onDismiss !== false ? P.iconButton('x', { label: 'Dismiss', size: 'inline', action: o.dismissAction || ['banner.dismiss', { id: o.id }] }) : ''}
      </div>`);
  };
  NP.on('banner.dismiss', (a) => { NP.state.dismissed = NP.state.dismissed || {}; if (a && a.id) NP.state.dismissed[a.id] = true; });
  NP.on('banner.more', () => { NP.state.bannersExpanded = !NP.state.bannersExpanded; });

  /* ---------- 56. Inline status ----------
     variant: on-label | trailing | blind | row-outcome | notice */
  C.inlineStatus = (text, o) => {
    o = o || {};
    if (!text) return '';
    const variant = o.variant || 'trailing';
    return comp('inline-status', { variant, state: 'shown', tag: 'span', cls: 'np-istatus np-istatus--' + variant, attrs: { role: 'status' } },
      html`${icon(variant === 'notice' ? 'info' : 'check', { size: 12 })}<span class="np-istatus__text">${text}</span>${o.actionLabel ? P.link(o.actionLabel, { action: o.action }) : ''}${o.kbd ? P.kbd(o.kbd) : ''}`);
  };

  /* ---------- cross-module safe call ----------
     NP.c('actionItemRow', item, opts) calls NP.C.actionItemRow when its module is loaded,
     otherwise renders a labelled stub so a module can be built and tested alone. */
  const STUB_IDS = {};
  NP.c = (name, ...args) => {
    if (typeof C[name] === 'function') return C[name](...args);
    const kebab = name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    return comp(kebab, { cls: 'np-stub', state: 'stub' }, html`<span>${kebab}</span>`);
  };

  /* ---------- generic navigation actions ---------- */
  NP.on('nav.go', (a) => { NP.go(a.screen, a.params || {}); return false; });
  NP.on('nav.back', () => { NP.back(); return false; });
  NP.on('nav.forward', () => { NP.forward(); return false; });
  NP.on('surface.show', (a) => { NP.show(a.surface); return false; });
  NP.on('call.show', () => {
    if (NP.state.rec.status === 'idle') NP.startRecording();
    NP.show('call'); return false;
  });
  NP.on('call.makeSensitive', () => { NP.state.rec.mode = 'Sensitive · local'; NP.state.popover = null; NP.flash('call-status', 'From now on, nothing from this call leaves this Mac.', 3000); });
  NP.on('settings.open', (a) => { NP.state.settingsPane = (a && a.pane) || NP.state.settingsPane || 'general'; NP.state.popover = null; NP.show('settings'); return false; });
})();
