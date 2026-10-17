/* =====================================================================
   Group B — call window components (DESIGN 3.2, table B):
   capture-notice (2), call-status-strip (5), collapsed-call-strip (6),
   transcript-view (8), transcript-segment-row (9), term-fix-popover (12),
   playback-bar (13), copilot-card-stack (14), copilot-card (15),
   context-chip (18), person-picker (35)
   Popover overlays: speaker-rename, person-picker, term-fix, span-preview
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, data: D, state } = NP;
  const C = NP.C;
  const PRIM = P.PRIM;

  /* ---------- extra example data ---------- */
  D.cwHeldCards = [
    { id: 'k4', kind: 'Pin', agent: 'Scribe', merged: [], age: 'now', text: 'Anna delivers the drawer redesign spec by Friday 17 Oct.', lang: 'en', pinAs: { owner: 'p-anna', due: 'Fri 17 Oct' }, prov: { kind: 'this-call', label: 'This call · 00:19:58' } },
  ];
  D.cwMoreEarlier = [
    { id: 'k0d', kind: 'Ask', agent: 'Product manager', text: 'Is the 480-pt drawer width final for VHI 8.0?', prov: { kind: 'this-call', label: 'This call · 00:08:12' }, outcome: 'Expired' },
    { id: 'k0e', kind: 'Context', agent: 'Designer', text: 'Lena K. asked for empty-state copy on 8 Oct.', prov: { kind: 'past-call', label: 'Design review · 8 Oct · 00:31:40', callId: 'c-design' }, outcome: 'Dismissed' },
    { id: 'k0f', kind: 'Answer', agent: 'QA lead', text: 'The drawer has 14 open UI tests in VSTOR.', prov: { kind: 'jira', label: 'Jira · looked up 10:09' }, outcome: 'Used' },
    { id: 'k0g', kind: 'Context', agent: 'Architect', text: 'The notification service already buffers 30 s of events.', prov: { kind: 'doc', label: 'Notification service (Confluence) · Buffering' }, outcome: 'Expired' },
  ];
  D.cwCarryForward = { id: 'kcf', kind: 'Context', carry: 'handoff', agent: 'Scribe', age: 'now', text: 'Last time you handed off “Virtualise the 10k-row table” to Claude Code.', prov: { kind: 'past-call', label: 'Planning · 2 Oct · 00:31:12', callId: 'c-backend' } };
  D.cwPinned = [
    { id: 'pin-1', text: 'Dmitri adds a replay buffer for websocket reconnects', owner: 'p-dmitri' },
    { id: 'pin-2', text: 'Ask backend about reconnect acceptance criteria', owner: 'p-you' },
  ];

  const personShort = (s) => (typeof s === 'string' && s.startsWith('p-') ? D.person(s).short : s);
  const routeHelp = {
    headphones: 'Play this line',
    speakers: 'Replay is off while recording on speakers: the call would hear it. Use headphones, or replay after the call.',
    unknown: "Noter can't tell whether this output is headphones. Mark it as headphones in Settings › Audio & Transcription to replay while recording.",
    'not-excluded': "Replay would be recorded. Turn on Exclude Noter's own sounds in Settings › Audio & Transcription.",
  };

  /* ---------- 9. Transcript segment row ---------- */
  C.segmentRow = (seg, o) => {
    o = o || {};
    const key = o.key || 'tr';
    const live = o.variant === 'live' || o.variant === 'tail';
    const tail = o.variant === 'tail';
    if (seg.mark) {
      return comp('transcript-segment-row', { variant: 'mark', cls: 'cw-seg cw-seg--mark' }, html`<span class="cw-seg__time np-tnum">${tail ? '' : seg.t}</span><span class="cw-seg__marktext">${icon('flag', { size: 12 })} ${seg.text}</span>`);
    }
    if (seg.gap) {
      return comp('transcript-segment-row', { variant: 'gap', cls: 'cw-seg cw-seg--gap' }, html`<span class="cw-seg__time"></span><span class="cw-seg__gaptext">${seg.text}</span>`);
    }
    if (seg.hypothesis) {
      return comp('transcript-segment-row', { variant: 'hypothesis', state: 'hypothesis', cls: 'cw-seg cw-seg--hyp' + (tail ? ' cw-seg--tail' : ''), attrs: { lang: (seg.lang || 'en').toLowerCase() } },
        html`<span class="cw-seg__time"></span><span class="cw-seg__spk">${C.speakerLabel(seg.speaker, { static: true })}</span><span class="cw-seg__text">${seg.text}</span><span></span>`);
    }
    const you = seg.speaker === 'p-you';
    const variant = tail ? 'tail' : Array.isArray(seg.speaker) ? 'crosstalk' : you ? 'you' : seg.conf != null && seg.conf < 0.75 ? 'low-confidence' : 'confirmed';
    const corrected = seg.term && seg.term.fixed !== false;
    const hl = o.highlight || (o.highlightSpan && o.highlightSpan === seg.t);
    const playing = o.playingAt === seg.t;
    const route = o.route || 'headphones';
    const canPlay = !live || route === 'headphones';
    const playHelp = live ? routeHelp[route] : 'Play this line';
    const anchorFix = 'fix-' + key + '-' + seg.t.replace(/:/g, '');
    // text with corrected term
    let text = seg.text;
    let textHtml;
    if (corrected && text.includes(seg.term.word)) {
      const [a, b] = text.split(seg.term.word);
      textHtml = html`${a}<button type="button" class="cw-term" title="Heard as “${seg.term.orig}”" data-proto-anchor="${anchorFix}t" ${act('cw.termFix', { anchor: anchorFix + 't', t: seg.t, word: seg.term.word, orig: seg.term.orig, lang: seg.lang })}>${seg.term.word}</button>${b}`;
    } else if (o.find) {
      const q = o.find.toLowerCase(); const i = text.toLowerCase().indexOf(q);
      textHtml = i >= 0 ? html`${text.slice(0, i)}<mark class="np-hl-match">${text.slice(i, i + q.length)}</mark>${text.slice(i + q.length)}` : text;
    } else textHtml = text;
    const lowConf = seg.conf != null && seg.conf < 0.75;
    return comp('transcript-segment-row', { variant, state: playing ? 'playing' : hl ? 'highlighted' : corrected ? 'corrected' : 'default', cls: 'cw-seg' + (tail ? ' cw-seg--tail' : '') + (hl ? ' np-hl-evidence' : '') + (playing ? ' is-playing' : ''), attrs: { lang: (seg.lang || 'en').toLowerCase(), tabindex: '0' } },
      html`<span class="cw-seg__time np-tnum">${seg.t}</span>
      <span class="cw-seg__spk">${C.speakerLabel(seg.speaker, { key: key + seg.t.replace(/:/g, ''), where: live ? 'call-window' : 'main' })}${variant === 'crosstalk' ? html` ${P.badge('Crosstalk', { kind: 'kind' })}` : ''}</span>
      <span class="cw-seg__text${lowConf ? ' is-lowconf' : ''}"${attrs({ title: lowConf ? 'Low confidence' : null })}>${textHtml}${seg.trans && o.showTranslation ? html`<span class="cw-seg__trans">${seg.trans}</span>` : ''}</span>
      <span class="cw-seg__end">
        ${tail ? '' : html`<span class="cw-seg__acts">${P.button('Fix Term…', { size: 'small', variant: 'quiet', anchor: anchorFix, action: ['cw.termFix', { anchor: anchorFix, t: seg.t, word: seg.term ? seg.term.word : seg.text.split(' ').slice(-2).join(' ').replace(/[.,?]$/, ''), orig: seg.term ? seg.term.orig : null, lang: seg.lang }] })}${P.iconButton(playing ? 'pause' : 'play', { label: playing ? 'Pause' : 'Play this line', size: 'inline', disabled: !canPlay, help: playHelp, attrs: !canPlay ? { 'data-state': 'disabled', 'aria-disabled': 'true' } : null, action: canPlay ? ['cw.play', { t: seg.t, speaker: seg.speaker, key, callId: o.callId }] : null })}</span>`}
        ${C.languageTag(seg.lang || 'EN', { conf: seg.conf })}
      </span>`);
  };

  /* ---------- 8. Transcript view ----------
     opts: {callId, segments, variant: live|post-call|tail, key, highlightSpan, waiting, detached, newLines, route, playingAt, find, findBar, header, rows} */
  C.transcriptView = (o) => {
    o = o || {};
    const variant = o.variant || 'live';
    const key = o.key || 'tr-' + variant;
    let segs = (o.segments || D.segments).slice();
    if (variant === 'tail') {
      const confirmed = segs.filter((s) => !s.mark && !s.gap);
      segs = confirmed.slice(-(o.tailLines || 3));
    }
    if (o.waiting) {
      return comp('transcript-view', { variant: variant === 'post-call' ? 'stored' : variant, state: 'waiting-for-speech', cls: 'cw-tv cw-tv--' + variant },
        html`<div class="cw-tv__waiting"><div class="cw-meters"><span>You</span>${P.levelMeter({ level: 3, label: 'Microphone level' })}<span>Others</span>${P.levelMeter({ level: 0, label: 'Call audio level' })}</div><div class="np-muted">Waiting for speech…</div></div>`);
    }
    const stored = variant === 'post-call';
    const findQ = o.find != null ? o.find : null;
    const matches = findQ ? segs.filter((s) => s.text && s.text.toLowerCase().includes(findQ.toLowerCase())).length : 0;
    const rowOpts = { variant: stored ? 'post-call' : variant, key, callId: o.callId, highlightSpan: o.highlightSpan, route: o.route, playingAt: o.playingAt, find: findQ, showTranslation: o.showTranslation };
    return comp('transcript-view', { variant: stored ? 'stored' : variant, state: o.detached ? 'detached' : findQ ? 'find-active' : stored ? 'default' : 'following', cls: 'cw-tv cw-tv--' + variant, attrs: { role: 'log', 'aria-live': 'off', 'aria-label': 'Transcript' } },
      html`${stored && o.findBar ? html`<div class="cw-tv__find">${P.searchField({ id: key + '-find', placeholder: 'Find in transcript', bind: 'local.' + key + '.find', value: findQ || '', live: true })}<span class="np-dim np-tnum">${findQ ? `${matches} of ${segs.length} lines` : ''}</span>${P.iconButton('chevronUp', { label: 'Previous Match', size: 'inline' })}${P.iconButton('chevronDown', { label: 'Next Match', size: 'inline' })}<span class="np-tb__spacer"></span>${P.toggle('Show Archive Changes', false, { size: 'small', labelAfter: true })}</div>` : ''}
      ${o.header ? html`<div class="cw-tv__header np-dim">${o.header}</div>` : ''}
      <div class="cw-tv__scroll" data-proto-scroll="${key}" data-cw-transcript="${key}">
        ${segs.map((s) => C.segmentRow(s, rowOpts))}
      </div>
      ${o.detached && variant === 'live' ? html`<div class="cw-tv__jump">${P.button('Jump to Live · ' + (o.newLines || 12) + ' new lines', { size: 'small', icon: 'chevronDown', action: ['cw.jumpLive'], cls: 'cw-jump' })}</div>` : ''}`);
  };

  /* ---------- 13. Playback bar ----------
     variant: live-headphones | post-call (stored) | result */
  C.playbackBar = (o) => {
    o = o || {};
    const variant = o.variant || 'post-call';
    const playing = o.playing !== false;
    const at = o.at || '00:19:58';
    const stopped = o.stopped;
    if (stopped) {
      return comp('playback-bar', { variant, state: 'stopped-by-route', cls: 'cw-pb cw-pb--' + variant }, html`${icon('info', { size: 13 })}<span>Replay stopped: output switched to speakers</span>`);
    }
    return comp('playback-bar', { variant: variant === 'post-call' ? 'stored' : variant === 'result' ? 'search-and-ask' : variant, state: playing ? 'playing' : 'paused', cls: 'cw-pb cw-pb--' + variant },
      html`${P.iconButton(playing ? 'pause' : 'play', { label: playing ? 'Pause' : 'Play', size: 'inline', action: ['cw.pbToggle', { key: o.key }] })}
      ${P.iconButton('back', { label: 'Back 5 Seconds', size: 'inline', action: ['proto.noop'] })}
      ${P.iconButton('forward', { label: 'Forward 5 Seconds', size: 'inline', action: ['proto.noop'] })}
      <input type="range" class="cw-pb__scrub" min="0" max="60" value="30" aria-label="Position"${attrs({ 'data-component': PRIM, 'data-primitive': 'slider', 'data-variant': 'scrubber' })}>
      <span class="np-tnum cw-pb__time">${at}</span>
      <span class="cw-pb__spk">${o.speaker ? personShort(o.speaker) : ''}</span>
      ${variant === 'live-headphones' ? html`<span class="cw-pb__line">${icon('headphones', { size: 13 })} Replaying while recording · headphones</span>` : ''}
      <span class="np-tb__spacer"></span>
      ${P.popup(['1×', '1.5×', '2×'], '1×', { variant: 'inline', label: 'Speed' })}
      ${P.iconButton('x', { label: 'Close Playback', size: 'inline', action: ['cw.pbClose', { key: o.key }] })}`);
  };

  /* ---------- 18. Context chip ---------- */
  const CHIP_ICON = { call: 'history', doc: 'doc', jira: 'ticket', item: 'list', screen: 'display' };
  C.contextChip = (chip, o) => {
    o = o || {};
    const L = NP.local('cw');
    const id = chip.label;
    const dropped = (L.droppedChips || {})[id];
    const pinned = (L.pinnedChips || {})[id];
    const variant = o.variant || { call: 'past-call', doc: 'document-section', jira: 'carried-forward-item', item: 'carried-forward-item', screen: 'screen' }[chip.kind] || 'past-call';
    if (dropped) return comp('context-chip', { variant, state: 'dropped', tag: 'span', cls: 'cw-cchip is-dropped' }, html`Dropped · ${P.link('Undo', { action: ['cw.chipUndo', { id }] })}`);
    const anchor = 'cchip-' + id.replace(/\W+/g, '');
    NP._menus[anchor] = [{ label: pinned ? 'Unpin' : 'Pin', action: ['cw.chipPin', { id }] }, { label: 'Drop from Context', action: ['cw.chipDrop', { id }] }];
    return comp('context-chip', { variant, state: pinned ? 'pinned' : 'default', tag: 'button', cls: 'cw-cchip', attrs: { type: 'button', title: chip.label, 'data-proto-anchor': anchor, 'data-proto-action': 'proto.menu', 'data-proto-args': JSON.stringify({ anchor }), 'aria-haspopup': 'menu' } },
      html`${icon(CHIP_ICON[chip.kind] || 'doc', { size: 11 })}<span class="cw-cchip__label">${chip.label}</span>${pinned ? icon('pin', { size: 11, label: 'Pinned' }) : ''}${chip.notReviewed ? P.badge('Not reviewed', { tone: 'warning' }) : ''}`);
  };

  /* ---------- 15. Copilot card ----------
     variant: call | floating | compact | read-only | peek */
  C.copilotCard = (card, o) => {
    o = o || {};
    const variant = o.variant === 'compact' ? 'floating' : (o.variant || 'call');
    const L = NP.local('cw');
    const expanded = (L.expanded || {})[card.id];
    const aged = card.aged || /min/.test(card.age || '');
    const kindVariant = card.carry ? 'carry-forward' : card.question ? 'solicited-answer' : String(card.kind || 'Context').toLowerCase();
    const showNum = !o.noNumbers && card.num && variant !== 'read-only';
    const lang = (card.lang || 'en');
    if (variant === 'peek') {
      return comp('copilot-card', { variant: 'peek', cls: 'cw-peek', attrs: { title: card.text, lang } }, html`${card.num ? html`<span class="cw-num">${card.num}</span>` : ''}<b class="cw-peek__kind">${card.kind}</b><span class="cw-peek__text">${card.question || card.text}</span>`);
    }
    const state = card.writing ? 'partial' : card.partial ? 'partial' : expanded ? 'expanded' : aged ? 'aged' : 'fresh';
    const provSpan = 'prov-' + card.id;
    const header = html`<div class="cw-card__head">
      ${o.single ? '' : C.agentBadge(card.agent, { variant: variant === 'read-only' ? 'static' : 'interactive', merged: card.merged, key: card.id })}
      <span class="cw-card__kind">${card.kind === 'Catch-up' ? 'Catch-up' : card.kind}</span>
      ${card.age ? html`<span class="cw-card__age np-dim">· ${card.age}</span>` : ''}
      <span class="np-tb__spacer"></span>
      ${showNum ? html`<span class="cw-num" title="Pin ⌃⌥⌘${card.num}${L.dismissKeys ? ' · Dismiss ⌃⌥⌘⇧' + card.num : ''}"${attrs({ 'data-component': PRIM, 'data-primitive': 'key-cap', 'data-variant': 'number-badge' })}>${card.num}</span>` : ''}
      ${variant === 'read-only' && card.outcome ? P.badge(card.outcome, { tone: card.outcome === 'Pinned' || card.outcome === 'Used' ? 'success' : 'neutral' }) : ''}
    </div>`;
    let body;
    if (card.writing) {
      body = html`<div class="cw-card__body np-muted">${(card.lastLines || []).map((l) => html`<div>${l}</div>`)}<div class="cw-card__writing">${P.progress({ variant: 'spinner', label: 'Writing catch-up' })} Writing catch-up…</div></div>`;
    } else {
      body = html`<div class="cw-card__body"${attrs({ lang })} ${variant === 'read-only' ? '' : act('cw.cardExpand', { id: card.id })}>${card.question ? html`<div class="cw-card__q">“${card.question}”</div>` : ''}${card.text}${card.beingAsked ? html`<div class="cw-card__asked"><b>Being asked now:</b> ${card.beingAsked}</div>` : ''}</div>`;
    }
    const prov = card.prov ? html`<span class="cw-card__prov" data-proto-anchor="${provSpan}">${C.provenanceChip(card.partial ? { loading: true } : card.prov, { inCallWindow: variant !== 'read-only' })}</span>` : '';
    let actions = '';
    if (variant !== 'read-only' && !card.writing) {
      if (card.carry === 'handoff') actions = html`${P.button('Yes, Landed', { size: 'small', action: ['cw.cardDismiss', { id: card.id, text: 'Marked as landed' }] })}${P.button('Keep Open', { size: 'small', variant: 'quiet', action: ['cw.cardDismiss', { id: card.id, text: 'Kept open' }] })}`;
      else if (card.carry === 'closed') actions = html`${P.button('Reopen', { size: 'small', action: ['cw.cardDismiss', { id: card.id, text: 'Reopened' }] })}`;
      else actions = html`${card.kind === 'Catch-up' ? '' : P.button(card.kind === 'Pin' ? 'Pin as Action Item' : 'Pin', { size: 'small', action: ['cw.pin', { id: card.id }] })}${P.button('Dismiss', { size: 'small', variant: 'quiet', action: ['cw.cardDismiss', { id: card.id }] })}`;
    }
    const exp = expanded && variant !== 'read-only' ? html`<div class="cw-card__exp">
      <div class="cw-card__quote np-muted">${card.prov && card.prov.kind === 'this-call' ? '“Then who writes the acceptance criteria for the reconnect handling?” — Pavel, 00:21:40' : '“Drawer events go through the notification service.” — Dmitri S., 00:41:10'}</div>
      <div class="np-dim">Why now: ${card.why || 'the topic came up again in the last 30 seconds'}</div>
      ${card.merged && card.merged.length ? html`<div class="np-dim">Merged with ${card.merged.join(', ')}</div>` : ''}
      <div class="cw-card__fb">${P.iconButton('thumbUp', { label: 'Useful', size: 'inline', action: ['proto.flash', { key: 'call-status', text: 'Thanks · marked useful', ms: 2000 }] })}${P.iconButton('thumbDown', { label: 'Not Useful', size: 'inline', action: ['proto.flash', { key: 'call-status', text: 'Marked unhelpful', ms: 2000 }] })}${card.kind === 'Answer' ? P.button('Copy', { size: 'small', variant: 'quiet', icon: 'copy', flashKey: 'cw-copy-' + card.id, action: ['proto.flash', { key: 'cw-copy-' + card.id, text: 'Copied' }] }) : ''}</div>
    </div>` : '';
    return comp('copilot-card', { variant: variant === 'read-only' ? 'read-only' : kindVariant, state, cls: 'cw-card cw-card--' + variant + (aged ? ' is-aged' : '') + (card.isNew && Date.now() - card.isNew < 350 ? ' is-new' : '') + (expanded ? ' is-expanded' : ''), attrs: { 'data-layout': variant, tabindex: '0', 'aria-label': `${card.kind} card ${card.num || ''}: ${card.text}` } },
      html`${header}${body}${card.carry === 'closed' ? html`<div class="np-dim">Closed: PR #448 merged on 14 Oct</div>` : ''}<div class="cw-card__foot">${prov}<span class="np-tb__spacer"></span>${actions}</div>${exp}`);
  };

  /* ---------- 14. Copilot card stack ----------
     opts: {cards, variant: dedicated|compact|single-agent, maxVisible, held, listening, muted, more, legend} */
  C.copilotCardStack = (o) => {
    o = o || {};
    const variant = o.variant || 'dedicated';
    const cards = o.cards || [];
    const max = o.maxVisible || 3;
    const shown = o.showAll ? cards : cards.slice(0, max);
    const more = cards.length - shown.length;
    const st = o.muted ? 'muted' : o.off ? 'off' : o.state || (cards.length ? (o.held ? 'held' : 'active') : 'listening');
    const cardVariant = variant === 'compact' ? 'floating' : 'call';
    return comp('copilot-card-stack', { variant, state: st, cls: 'cw-stack cw-stack--' + variant, attrs: { 'aria-label': 'Copilot cards' } },
      html`${o.held ? html`<div class="cw-stack__held">${P.button(o.held + ' new card' + (o.held === 1 ? '' : 's') + ' ▴', { size: 'small', action: ['cw.insertHeld'] })}</div>` : ''}
      ${o.off ? html`<div class="cw-stack__listen np-muted">Copilot off for this sensitive call (no local model)</div>` : !cards.length ? html`<div class="cw-stack__listen np-muted">${icon('wave', { size: 14 })}<span>Listening. Cards appear when there is something worth asking</span>${o.showMode ? C.modeIndicator({ variant: 'floating', key: 'listen' }) : ''}</div>` : ''}
      ${shown.map((c) => C.copilotCard(c, { variant: cardVariant, single: variant === 'single-agent' || o.single, noNumbers: o.muted }))}
      ${more > 0 ? html`<div class="cw-stack__more">${P.button(more + ' more', { size: 'small', variant: 'quiet', action: ['cw.showAllCards'] })}</div>` : ''}`);
  };
  /** Key legend line — part of the copilot card stack (anatomy 1) */
  C.cardLegend = (o) => {
    o = o || {};
    const L = NP.local('cw');
    if (L.muted || L.hidden) return '';
    const key = L.panelKey;
    const nums = L.keyTaken ? '1–2' : 'number';
    const pin = key ? html`<b>Pin</b> ${P.kbd('⌘')} + ${nums}` : html`<b>Pin</b> ${P.kbd('⌃⌥⌘')} + ${nums}`;
    const dis = L.dismissKeys || key ? html` · <b>Dismiss</b> ${P.kbd(key ? '⌘⇧' : '⌃⌥⌘⇧')} + ${nums}` : '';
    return comp('copilot-card-stack', { variant: 'key-legend', state: key ? 'key' : 'not-key', tag: 'span', cls: 'cw-legend' }, html`${pin}${dis}`);
  };

  /* ---------- 2. Capture notice ----------
     variant: call-ended | new-meeting | nothing-heard | stopped-automatically | stopped-by-you ; layout dedicated | floating */
  C.captureNotice = (o) => {
    o = o || {};
    const L = NP.local('cw');
    const variant = o.variant || 'call-ended';
    const fl = o.layout === 'floating';
    const size = fl ? 'regular' : 'large';
    let iconName = 'info', tone = 'info', title = '', body = '', actions = '', extra = '';
    if (variant === 'call-ended') {
      iconName = 'stop'; tone = 'warning';
      title = 'The call seems to have ended';
      body = L.countdownPaused ? html`Microsoft Teams stopped using audio and the microphone 20 s ago. <b>Paused while you're here</b>` : html`Microsoft Teams stopped using audio and the microphone 20 s ago. Stopping in <span class="np-tnum">${L.countdown}</span> s.`;
      actions = html`${P.button('Keep Recording', { variant: 'primary', size, action: ['cw.keepRecording'] })}${P.button('Stop Now', { size, action: ['cw.stop', { how: 'manual' }] })}`;
      extra = html`<div class="cw-notice__bar" aria-hidden="true"><span style="width:${(L.countdown / 10) * 100}%"></span></div>`;
    } else if (variant === 'new-meeting') {
      iconName = 'calendar';
      title = 'A new meeting may have started: 1:1 with Anna K.';
      body = 'Microsoft Teams joined a new meeting at 14:30.';
      actions = html`${P.button('Start as New Call', { variant: 'primary', size, action: ['cw.newCall'] })}${P.button('Keep in This Call', { size, action: ['cw.noticeClose'] })}`;
    } else if (variant === 'nothing-heard') {
      iconName = 'warning'; tone = 'warning';
      title = 'Nothing heard yet';
      body = html`<span class="cw-meters"><span>You</span>${P.levelMeter({ level: 0, label: 'Microphone level' })}<span>Others</span>${P.levelMeter({ level: 0, label: 'Call audio level' })}</span>`;
      actions = L.discardConfirm
        ? html`<span class="cw-notice__confirm">Discard this recording? This can't be undone.</span>${P.button('Discard', { variant: 'destructive', size, action: ['cw.discard'] })}${P.button('Back', { size, action: ['cw.discardBack'] })}`
        : html`${P.button('Discard Recording', { size, action: ['cw.discardAsk'] })}${P.button('Keep Recording', { size, variant: 'quiet', action: ['cw.noticeClose'] })}`;
    } else if (variant === 'stopped-automatically') {
      iconName = 'checkCircle'; tone = 'success';
      title = 'Stopped at 11:02 · the call had ended · 48 min saved';
      actions = html`${P.button('Continue Recording', { size, action: ['cw.continue'] })}${P.button('Open in Noter', { size, variant: 'primary', action: ['cw.openInNoter'] })}`;
    } else if (variant === 'stopped-by-you') {
      iconName = 'checkCircle'; tone = 'success';
      title = 'Saved · 48 min · Summary in about 2 minutes';
      actions = html`${P.button('Continue Recording', { size, action: ['cw.continue'] })}${P.button('Open in Noter', { size, variant: 'primary', action: ['cw.openInNoter'] })}${P.button('Close', { size, action: ['cw.closePanel'] })}`;
    }
    return comp('capture-notice', { variant, state: L.discardConfirm && variant === 'nothing-heard' ? 'confirming-discard' : variant === 'call-ended' ? (L.countdownPaused ? 'countdown-paused' : 'countdown-running') : 'default', cls: 'cw-notice cw-notice--' + tone + (fl ? ' is-floating' : ''), attrs: { role: 'alertdialog', 'aria-label': title, 'data-cw-notice': variant } },
      html`<span class="cw-notice__icon">${icon(iconName, { size: 18 })}</span>
      <div class="cw-notice__main"><div class="cw-notice__title">${title}</div>${body ? html`<div class="cw-notice__body">${body}</div>` : ''}</div>
      <div class="cw-notice__actions">${actions}</div>${extra}`);
  };

  /* ---------- 5. Call status strip ---------- variant: dedicated | compact | copilot-off */
  C.callStatusStrip = (o) => {
    o = o || {};
    const L = NP.local('cw');
    const rec = state.rec;
    const variant = o.variant || 'dedicated';
    const paused = rec.status === 'paused';
    const stopped = !!L.closing;
    const copilotOff = variant === 'copilot-off' || L.copilot === 'off';
    const budgetWarn = L.budget === 'near' || L.budget === 'cap';
    const budgetText = L.budget === 'cap' ? '$1.00 of $1.00' : L.budget === 'near' ? '$0.92 of $1.00' : '$0.31 of $1.00';
    const feedback = NP.flashed('call-status');
    const fb = L.keyTaken && !L.keyTakenSeen
      ? C.inlineStatus(raw('Card key ' + P.kbd('⌃⌥⌘3') + ' is used by another app'), { variant: 'notice', actionLabel: 'Change…', action: ['settings.open', { pane: 'hotkeys' }] })
      : feedback ? C.inlineStatus(feedback, { variant: /^No card/.test(feedback) ? 'notice' : 'blind', actionLabel: L.lastCardAction ? 'Undo' : null, action: ['cw.undoCard'], kbd: L.lastCardAction ? '⌃⌥⌘Z' : null }) : '';
    const engineStopped = !stopped && !!L.engineStopped;
    const recInd = C.recordingIndicator({ variant: 'dot-text', status: stopped ? 'stopped' : NP.liveStatus(), clock: false });
    const pinnedBtn = copilotOff ? '' : P.button(L.pinned.length + ' Pinned', { size: 'small', anchor: 'cw-pinned', action: ['cw.pinnedPopover'], icon: 'pin' });
    if (variant === 'compact') {
      const anchor = 'cw-fp-more';
      NP._menus[anchor] = (engineStopped ? [{ label: 'Try Again', action: ['cw.engineRetry'] }] : [
        paused ? { label: 'Resume', kbd: '⌃⌥⌘P', action: ['cw.pause'] } : { label: 'Pause', kbd: '⌃⌥⌘P', action: ['cw.pause'] },
        { label: 'Stop Recording', kbd: '⌃⌥⌘R', action: ['cw.stop', { how: 'manual' }] },
      ]).concat([
        { divider: true },
        { label: 'Ask…', kbd: '⌃⌥⌘A', action: ['cw.ask'] },
      ]);
      return comp('call-status-strip', { variant: copilotOff ? 'copilot-off' : 'compact', state: stopped ? 'stopped' : engineStopped ? 'engine-stopped' : paused ? 'paused' : budgetWarn ? 'budget-near-cap' : 'recording', cls: 'cw-strip cw-strip--compact' },
        html`${fb ? html`<div class="cw-strip__fb">${fb}</div>` : ''}<div class="cw-strip__row">
        ${P.button('Mark Moment', { size: 'small', flashKey: 'cw-mark', action: ['cw.mark'], help: 'Mark Moment (⌃⌥⌘M)' })}
        ${copilotOff ? '' : P.button('Catch Me Up', { size: 'small', action: ['cw.catchUp'], help: 'Catch Me Up (⌃⌥⌘C)' })}
        ${P.pulldown('More', NP._menus[anchor], { iconOnly: true, anchorId: anchor, ariaLabel: 'More', size: 'inline' })}
        <span class="np-tb__spacer"></span>
        ${copilotOff ? '' : html`<span class="cw-strip__budget np-tnum${budgetWarn ? ' is-warn' : ''}" title="Copilot budget for this call">${budgetWarn ? icon('warning', { size: 11 }) : ''}${budgetText.replace(' of ', ' / ')}</span>`}
        </div>`);
    }
    return comp('call-status-strip', { variant: copilotOff ? 'copilot-off' : 'dedicated', state: stopped ? 'stopped' : engineStopped ? 'engine-stopped' : paused ? 'paused' : budgetWarn ? 'budget-near-cap' : 'recording', cls: 'cw-strip cw-strip--dedicated', region: 'CS-R5' },
      html`<span class="cw-strip__clock t-title2 np-tnum">${NP.clock(false)}</span>
      ${recInd}
      ${copilotOff ? '' : html`<span class="cw-strip__budget np-tnum${budgetWarn ? ' is-warn' : ''}">${budgetWarn ? icon('warning', { size: 12 }) : ''}Budget ${budgetText}</span>`}
      ${pinnedBtn}
      <span class="cw-strip__fb">${fb}</span>
      <span class="np-tb__spacer"></span>
      ${stopped ? '' : engineStopped ? P.button('Try Again', { variant: 'primary', action: ['cw.engineRetry'] }) : html`${P.button('Mark Moment', { kbd: '⌃⌥⌘M', flashKey: 'cw-mark', action: ['cw.mark'] })}
      ${copilotOff ? '' : P.button('Catch Me Up', { kbd: '⌃⌥⌘C', action: ['cw.catchUp'] })}
      ${P.button(paused ? 'Resume' : 'Pause', { kbd: '⌃⌥⌘P', variant: paused ? 'primary' : 'secondary', action: ['cw.pause'] })}
      <span class="cw-strip__gap"></span>
      ${P.button('Stop Recording', { kbd: '⌃⌥⌘R', icon: 'stop', action: ['cw.stop', { how: 'manual' }], cls: 'cw-stop' })}`}`);
  };

  /* ---------- 6. Collapsed call strip ---------- */
  C.collapsedCallStrip = (o) => {
    o = o || {};
    const L = NP.local('cw');
    const paused = state.rec.status === 'paused';
    const off = L.copilot === 'off';
    const top = L.cards[0];
    const variant = paused ? 'paused' : off ? 'copilot-off' : L.muted ? 'copilot-muted' : !top ? 'listening' : 'recording';
    return comp('collapsed-call-strip', { variant, state: 'default', cls: 'cw-cstrip', region: null, attrs: { tabindex: '0', role: 'group', 'aria-label': 'Call strip' } },
      html`<div class="cw-cstrip__state" data-region="FP-C1">${paused ? html`${C.recordingIndicator({ variant: 'dot', status: 'paused', clock: false })}<span class="np-tnum">Paused 3 min</span>` : C.recordingIndicator({ variant: 'dot' })}${C.modeIndicator({ variant: 'glyph', key: 'strip' })}</div>
      ${off ? '' : html`<div class="cw-cstrip__card" data-region="FP-C2">${L.muted ? html`<span class="np-muted">Copilot muted</span>` : top ? html`${C.copilotCard(top, { variant: 'peek' })}<span class="cw-cstrip__hover">${P.iconButton('pin', { label: 'Pin', size: 'inline', action: ['cw.pin', { id: top.id }] })}${P.iconButton('x', { label: 'Dismiss', size: 'inline', action: ['cw.cardDismiss', { id: top.id }] })}</span>` : html`<span class="np-muted cw-peek__text">Listening. Cards appear when there is something worth asking</span>`}</div>`}
      <div class="cw-cstrip__ctl" data-region="FP-C3">${off ? '' : P.badge(String(L.cards.length), { kind: 'count' })}${P.iconButton('chevronDown', { label: 'Expand Panel', size: 'toolbar', action: ['cw.layout', { layout: 'floating' }] })}</div>`);
  };

  /* ---------- 35. Person picker ----------
     opts: {key, value, variant: inline|popover|merge, exclude, callId, confirmLabel, confirmAction, scope} */
  const pickerGroups = (q, exclude) => {
    const call = D.call('c-live');
    const fold = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss');
    const match = (p) => !q || [p.name, p.short].concat(p.aliases || []).some((n) => fold(n).includes(fold(q)));
    const people = D.people.filter((p) => !p.you && !(exclude || []).includes(p.id) && match(p));
    const inCall = people.filter((p) => call.people.includes(p.id));
    const others = people.filter((p) => !call.people.includes(p.id));
    return [{ header: 'In this call', list: inCall, src: 'from the invite' }, { header: 'Recent people', list: others, src: 'recent calls' }].filter((g) => g.list.length);
  };
  C.personPicker = (o) => {
    o = o || {};
    const key = o.key || 'pp';
    const S = NP.local('pp-' + key, { q: '', sel: null, newMode: false, name: '', email: '', role: '', err: null });
    const variant = o.variant || 'popover';
    if (S.newMode) {
      const dup = /^lena/i.test(S.name.trim()) ? D.people.find((p) => p.id === 'p-lena') : null;
      return comp('person-picker', { variant, state: S.err ? 'name-missing' : dup ? 'duplicate-found' : 'new-person-form', cls: 'cw-pp cw-pp--form' },
        html`<div class="cw-pp__formtitle t-headline">New person</div>
        <label class="cw-pp__lbl">Name ${P.textField({ id: 'pp-' + key + '-name', value: S.name, bind: 'local.pp-' + key + '.name', live: true, invalid: !!S.err, message: S.err, ariaLabel: 'Name' })}</label>
        <label class="cw-pp__lbl">Email ${P.textField({ id: 'pp-' + key + '-email', value: S.email, bind: 'local.pp-' + key + '.email', placeholder: 'name@company.com', ariaLabel: 'Email' })}</label>
        <label class="cw-pp__lbl">Role ${P.textField({ id: 'pp-' + key + '-role', value: S.role, bind: 'local.pp-' + key + '.role', placeholder: 'Designer', ariaLabel: 'Role' })}</label>
        ${dup ? html`<div class="cw-pp__dup">${icon('info', { size: 13 })}<span>${dup.short} (${dup.role}) is already in your people.</span><span class="cw-pp__dupacts">${P.button('Use ' + dup.short, { size: 'small', action: ['cw.ppPick', Object.assign({}, o.pickArgs || {}, { key, id: dup.id })] })}${P.button('Create Anyway', { size: 'small', variant: 'quiet', action: ['cw.ppCreate', Object.assign({}, o.pickArgs || {}, { key, force: true })] })}</span></div>` : ''}
        <div class="cw-pp__foot">${P.button('Back', { action: ['cw.ppBack', { key }] })}<span class="np-tb__spacer"></span>${P.button(o.createLabel || 'Create and Name', { variant: 'primary', action: ['cw.ppCreate', Object.assign({}, o.pickArgs || {}, { key })] })}</div>`);
    }
    const groups = pickerGroups(S.q, o.exclude);
    const none = S.q && !groups.length;
    if (variant === 'field' || o.as === 'field') {
      /* Field variant: a plain field; suggestions open only while typing; a pick runs o.onPick with o.args + {value} */
      const cur = o.value ? D.person(o.value) : null;
      return comp('person-picker', { variant, state: none ? 'no-match' : S.q ? 'suggestions-open' : cur ? 'chosen' : 'empty', cls: 'cw-pp cw-pp--field' },
        html`${P.textField({ id: 'pp-' + key + '-q', placeholder: cur ? cur.short : (o.placeholder || 'Name…'), value: S.q, bind: 'local.pp-' + key + '.q', live: true, ariaLabel: 'Person', attrs: { role: 'combobox', 'aria-expanded': String(!!S.q) } })}
        ${S.q ? html`<div class="cw-pp__list cw-pp__list--drop" role="listbox" aria-label="People">${none ? html`<div class="cw-pp__none">No one called “${S.q}”</div>` : groups.map((g) => html`<div class="cw-pp__hdr">${g.header}</div>${g.list.slice(0, 5).map((p) => html`<button type="button" role="option" class="cw-pp__opt" ${act('cw.ppFieldPick', { key, onPick: o.onPick || null, args: Object.assign({}, o.args || {}, { value: p.id }), person: p.id })}><span class="np-person__ini">${p.initials}</span><span class="cw-pp__optmain"><span class="cw-pp__name" lang="${p.lang || 'en'}">${p.short}</span><span class="cw-pp__role">${p.role} · ${g.src}</span></span></button>`)}`)}</div>` : ''}`);
    }
    return comp('person-picker', { variant, state: none ? 'no-match' : S.q ? 'typing' : 'empty', cls: 'cw-pp' },
      html`${P.textField({ id: 'pp-' + key + '-q', placeholder: 'Name…', value: S.q, bind: 'local.pp-' + key + '.q', live: true, ariaLabel: 'Person', attrs: { role: 'combobox', 'aria-expanded': 'true' } })}
      <div class="cw-pp__list" role="listbox" aria-label="People">
        ${none ? html`<div class="cw-pp__none">No one called “${S.q}”</div>` : groups.map((g) => html`<div class="cw-pp__hdr">${g.header}</div>${g.list.slice(0, 8).map((p) => html`<button type="button" role="option" class="cw-pp__opt${S.sel === p.id ? ' is-sel' : ''}" aria-selected="${String(S.sel === p.id)}" ${act('cw.ppSelect', { key, id: p.id })}><span class="np-person__ini">${p.initials}</span><span class="cw-pp__optmain"><span class="cw-pp__name" lang="${p.lang || 'en'}">${p.short}</span><span class="cw-pp__role">${p.role} · ${g.src}</span></span></button>`)}`)}
        ${variant === 'merge' ? '' : html`<button type="button" class="cw-pp__opt cw-pp__new" ${act('cw.ppNew', { key })}>${icon('plus', { size: 12 })}${S.q ? `New Person “${S.q}”…` : 'New Person…'}</button>`}
      </div>`);
  };

  NP.on('cw.ppFieldPick', (a) => {
    const S = NP.local('pp-' + a.key); S.q = ''; S.sel = a.person;
    if (a.onPick && NP.actions[a.onPick]) NP.actions[a.onPick](a.args || {});
  });

  /* ---------- popover overlays ---------- */
  NP.overlay('speaker-rename', {
    width: 320,
    render: (p) => {
      const key = 'rename';
      const S = NP.local('pp-' + key, { q: '', sel: null, newMode: false, name: '', email: '', role: '', err: null });
      const L = NP.local('cw');
      const scope = L.renameScope || 'whole';
      const sel = S.sel ? D.person(S.sel) : null;
      return html`<div class="np-pop__body">
        <div class="np-pop__title">Rename ${p.name}</div>
        ${C.personPicker({ key, variant: 'popover', pickArgs: { speaker: p.speaker, where: p.where } })}
        ${S.newMode ? '' : html`${P.radioGroup('cw-scope', [{ value: 'whole', label: 'Whole call' }, { value: 'line', label: 'Only this line' }], scope, { bind: 'local.cw.renameScope', label: 'Scope' })}
        ${sel && sel.voiceProfile ? P.checkbox('Also update the voice profile', true, {}) : ''}
        <div class="np-pop__actions" style="justify-content:flex-end">${P.button('Rename', { variant: 'primary', disabled: !sel, action: ['cw.ppPick', { key, id: S.sel, speaker: p.speaker, where: p.where }] })}</div>`}
      </div>`;
    },
  });
  NP.overlay('person-picker', {
    width: 320,
    render: (p) => {
      const key = 'pick';
      const S = NP.local('pp-' + key, { q: '', sel: null, newMode: false, name: '', email: '', role: '', err: null });
      const owner = !!p.itemId;
      return html`<div class="np-pop__body">
        <div class="np-pop__title">${owner ? 'Owner' : 'Name ' + (p.speaker || 'speaker')}</div>
        ${C.personPicker({ key, variant: 'popover', pickArgs: { speaker: p.speaker, itemId: p.itemId, where: 'main' } })}
        ${S.newMode ? '' : html`<div class="np-pop__actions" style="justify-content:flex-end">${P.button(owner ? 'Set Owner' : 'Name', { variant: 'primary', disabled: !S.sel, action: ['cw.ppPick', { key, id: S.sel, speaker: p.speaker, itemId: p.itemId, where: 'main' }] })}</div>`}
      </div>`;
    },
  });
  /* 12. Term fix popover */
  NP.overlay('term-fix', {
    width: 320,
    render: (p) => {
      const L = NP.local('cw');
      const v = L.termValue != null ? L.termValue : (p.word || '');
      const langName = { EN: 'English', RU: 'Russian', DE: 'German' }[p.lang] || 'English';
      return comp('term-fix-popover', { variant: p.where === 'main' ? 'stored' : 'live', state: v.trim() ? 'default' : 'invalid', cls: 'np-pop__body' },
        html`<div class="np-pop__title">Fix term</div>
        <div class="np-muted" lang="${(p.lang || 'en').toLowerCase()}">“${p.orig || p.word}”</div>
        <label class="cw-pp__lbl">Correct term ${P.textField({ id: 'cw-term-field', value: v, bind: 'local.cw.termValue', live: true, ariaLabel: 'Correct term' })}</label>
        ${/notif/i.test(v) ? html`<div class="cw-term__sugg np-dim">${icon('doc', { size: 11 })} Glossary: notification service · нотификейшн сервис · “notifikeyshn servis”</div>` : ''}
        <label class="cw-pp__lbl">Language ${P.popup(['English', 'Russian', 'German'], langName, { label: 'Language' })}</label>
        ${P.checkbox('Add to glossary', true, {})}
        <div class="np-dim">${icon('info', { size: 11 })} Older calls get a proposal in Activity</div>
        <div class="np-pop__actions" style="justify-content:flex-end">${P.button('Fix', { variant: 'primary', disabled: !v.trim(), action: ['cw.termApply', { t: p.t, value: v }] })}</div>`);
    },
  });
  NP.overlay('span-preview', {
    width: 340,
    render: (p) => html`<div class="np-pop__body">
      <div class="np-pop__title">${icon('history', { size: 13 })} ${p.label}</div>
      <div class="cw-span">
        <div class="cw-span__row"><span class="np-tnum np-dim">00:41:02</span> <b>Dmitri S.</b> <span lang="ru">Давайте все события drawer пускать через notification service.</span></div>
        <div class="cw-span__row np-hl-evidence"><span class="np-tnum np-dim">00:41:10</span> <b>You</b> Agreed, drawer events go through the notification service.</div>
      </div>
      <div class="np-pop__actions">${P.button('Open in Noter', { size: 'small', action: ['nav.go', { screen: p.screen || 'call-page', params: p.params || {} }] })}</div>
    </div>`,
  });
})();
