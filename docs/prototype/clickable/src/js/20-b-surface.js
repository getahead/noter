/* =====================================================================
   Group B — Shell — Call window (cpt-noter-component-shell-call-window)
   with Call screen (dedicated layout) and Floating panel (floating
   layout + collapsed strip). Surface key: 'call'.
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, region, icon, P, data: D, state } = NP;
  const C = NP.C;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const init = () => ({
    cards: clone(D.cards),
    earlier: clone(D.earlierCards).concat(clone(D.cwMoreEarlier)),
    earlierOpen: false,
    pinned: clone(D.cwPinned),
    held: [],
    extraRows: [],
    expanded: {},
    askOpen: false, askText: '',
    notice: null, discardConfirm: false, countdown: 10, countdownPaused: false,
    closing: null, closed: null, hidden: null,
    banner: null,               // sys-silent | mic-off | engine-stopped | stalled | disk | second-source
    copilotBanner: null,        // switched-local | budget | muted | sensitive-off
    copilot: 'council',         // council | single | off
    muted: false, budget: 'normal', keyTaken: false, keyTakenSeen: false, dismissKeys: false, panelKey: false,
    micOnly: false, noMic: false, engineStopped: false,
    route: 'headphones', playback: null,
    detached: false, newLines: 12,
    newCall: false, waiting: false,
    firstFloat: true, showTranscript: false, fpHeight: 560, showAllCards: false,
    lastCardAction: null, latency: true,
    droppedChips: {}, pinnedChips: {},
  });
  const L = () => NP.local('cw', init);

  const layout = () => state.rec.layout || 'dedicated';
  const segments = () => {
    const l = L();
    if (l.newCall) return [];
    const base = D.segments;
    const hyp = base.filter((s) => s.hypothesis);
    const rest = base.filter((s) => !s.hypothesis);
    return rest.concat(l.extraRows).concat(state.rec.status === 'paused' || l.closing || l.engineStopped ? [] : hyp);
  };
  const title = () => (L().newCall ? '1:1 with Anna K.' : D.call(state.rec.callId).title);
  const participants = () => (L().newCall ? ['p-anna', 'p-you'] : ['p-anna', 'p-pavel', 'p-dmitri', 'Speaker 3', 'p-you'].filter((p) => !(p === 'Speaker 3' && !D.segments.some((s) => s.speaker === 'Speaker 3'))));
  const clockNow = () => NP.fmtClock(NP.elapsedMs(), false);

  /* ---------------- shared header pieces ---------------- */
  const shareGlyph = () => html`<span class="cw-shield"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'icon-button', 'data-variant': 'glyph', title: 'Hidden from Teams, Meet and window-filtered Zoom shares. Share a window, not a display.', role: 'img', 'aria-label': 'Hidden from window shares' })}>${icon('shield', { size: 15 })}</span>`;
  const moreMenu = (anchor) => P.pulldown('More', [
    { label: 'Make This Call Sensitive', action: ['call.makeSensitive'], disabled: state.rec.mode === 'Sensitive · local' },
    { divider: true },
    { label: 'Open in Noter', action: ['cw.openInNoter'] },
    { label: layout() === 'dedicated' ? 'Use Floating Panel' : 'Open Call Screen on Display 2', action: ['cw.layout', { layout: layout() === 'dedicated' ? 'floating' : 'dedicated' }] },
  ], { iconOnly: true, anchorId: anchor, ariaLabel: 'More', size: 'toolbar', help: 'More' });
  const muteMenu = (anchor, floating) => {
    const items = [
      { label: L().muted ? 'Unmute Copilot' : 'Mute Copilot for 10 Minutes', kbd: '⌃⌥⌘K', action: ['cw.mute'] },
      { label: 'Mute Copilot for This Call', action: ['cw.mute'] },
      { label: 'Mute Copilot for All Planning Calls', action: ['cw.mute'] },
      { divider: true },
      { header: 'Agents' },
    ].concat(D.agents.filter((a) => a.enabled).map((a) => ({ label: a.name, checked: !(L().mutedAgents || {})[a.id], action: ['cw.muteAgent', { id: a.id, name: a.name }] })));
    if (floating) items.push({ divider: true }, { label: L().showTranscript ? 'Hide Transcript' : 'Show Transcript', checked: L().showTranscript, action: ['cw.toggleTranscript'] });
    return floating
      ? P.pulldown('Mute', items, { iconOnly: true, icon: 'mute', anchorId: anchor, ariaLabel: 'Mute', size: 'inline', help: 'Mute' })
      : P.pulldown('Mute', items, { anchorId: anchor, size: 'small' });
  };

  const transcriptBanner = (compact) => {
    /* capture health first (PM-60, PM-67): a missing permission never blocks the start, it shows here */
    const h = NP.captureHealth();
    const b = L().banner || (h === 'engine-stopped' ? 'engine-stopped' : h === 'mic-only' ? 'sys-silent' : h === 'no-mic' ? 'mic-off' : null);
    if (!b) return '';
    const map = {
      'sys-silent': { severity: 'error', text: 'System audio silent', actions: [{ label: 'Open System Settings…', action: ['proto.flash', { key: 'proto', text: 'Opens System Settings › Privacy & Security › Screen & System Audio Recording' }] }] },
      'mic-off': { severity: 'error', text: 'Microphone off', actions: [{ label: 'Open System Settings…', action: ['proto.flash', { key: 'proto', text: 'Opens System Settings › Privacy & Security › Microphone' }] }] },
      'engine-stopped': { severity: 'error', text: 'Not recording · engine stopped', actions: [{ label: 'Try Again', variant: 'primary', action: ['cw.engineRetry'] }] },
      stalled: { severity: 'error', text: 'Transcription stalled · restarting', actions: [] },
      disk: { severity: 'warning', text: '2 GB free on this Mac. Recording continues.', actions: [{ label: 'Delete Old Audio…', action: ['cw.deleteOldAudio'] }] },
      'second-source': { severity: 'warning', text: 'Slack is also playing audio', actions: [{ label: 'Exclude Slack', action: ['cw.bannerClose'] }, { label: 'Keep', action: ['cw.bannerClose'] }] },
    };
    return C.inlineBanner(Object.assign({ compact, region: compact ? 'FP-R3' : 'CS-R3', dismissible: false }, map[b]));
  };
  const copilotBanner = (compact) => {
    const l = L();
    const b = l.muted ? 'muted' : l.copilotBanner;
    if (!b) return '';
    const map = {
      'switched-local': { severity: 'degraded', text: 'Switched to local · trying Claude again in 10 min', actions: [] },
      budget: { severity: 'degraded', text: 'Copilot paused: budget', actions: [{ label: 'Raise Cap to $2', action: ['cw.raiseCap'] }] },
      muted: { severity: 'info', text: 'Copilot muted for 10 min', actions: [{ label: 'Unmute', action: ['cw.mute'] }], dismissible: false },
      'sensitive-off': { severity: 'warning', text: 'Copilot off for this sensitive call (no local model)', actions: [] },
    };
    return C.inlineBanner(Object.assign({ compact, region: compact ? 'FP-R3' : 'CS-R4d', dismissible: false }, map[b]));
  };

  /* ---------------- dedicated layout: Call screen ---------------- */
  const callScreen = () => {
    const l = L();
    const off = l.copilot === 'off';
    const single = l.copilot === 'single';
    const segs = segments();
    const paused = state.rec.status === 'paused';
    const recStatus = l.closing ? 'stopped' : NP.liveStatus();
    const langs = l.newCall ? ['EN'] : ['EN', 'RU', 'DE'];
    const header = region('CS-R1', { cls: 'cs-r1', tag: 'header', label: 'Call header' }, html`
      <div class="cs-r1__line">
        ${C.recordingIndicator({ variant: 'dot', status: recStatus, clock: false })}
        <h2 class="cs-title t-title2" title="${title()}">${title()}</h2>
        <span class="np-tb__spacer"></span>
        ${shareGlyph()}
        ${P.iconButton('eyeSlash', { label: 'Hide Noter for Presenting', help: 'Hide Noter for Presenting (⌃⌥⌘0)', action: ['cw.hide', { how: 'presenting' }] })}
        ${moreMenu('cs-more')}
      </div>
      <div class="cs-r1__line cs-r1__people">
        ${participants().map((p) => C.personChip(p, { variant: 'call-window' }))}
        <span class="np-tb__spacer"></span>
        ${langs.map((c) => C.languageTag(c, { variant: 'call' }))}
      </div>
      ${l.latency && !l.newCall ? html`<div class="cs-latency np-dim np-tnum">Hypothesis 1.4 s · confirmed 3.1 s</div>` : ''}`);
    const transcript = html`<div class="cs-left">
      ${header}
      ${transcriptBanner(false) ? region('CS-R3', { cls: 'cs-r3' }, transcriptBanner(false)) : ''}
      ${region('CS-R2', { cls: 'cs-r2', label: 'Transcript' }, C.transcriptView({ variant: 'live', key: 'cw-live', callId: state.rec.callId, segments: segs, waiting: l.newCall || l.waiting, detached: l.detached, newLines: l.newLines, route: l.route, playingAt: l.playback && l.playback.t }))}
      ${l.playback ? region('CS-R2b', { cls: 'cs-r2b' }, C.playbackBar({ variant: 'live-headphones', at: l.playback.t, speaker: l.playback.speaker, key: 'cw', stopped: l.playback.stopped })) : ''}
    </div>`;
    const right = off ? '' : html`<div class="cs-right">
      ${region('CS-R4a', { cls: 'cs-r4a', tag: 'header', label: 'Council header' }, html`
        <div class="cs-r1__line"><h2 class="t-headline">${single ? 'Copilot' : 'Council · ' + D.agents.filter((a) => a.enabled).length + ' agents'}</h2><span class="np-tb__spacer"></span>${C.modeIndicator({ variant: 'call-header' })}</div>
        <div class="cs-r1__line">${C.cardLegend()}<span class="np-tb__spacer"></span>${P.button('Ask…', { size: 'small', kbd: '⌃⌥⌘A', action: ['cw.ask'] })}${muteMenu('cs-mute', false)}</div>`)}
      ${l.askOpen ? region('CS-R4b', { cls: 'cs-r4b' }, P.textField({ id: 'cw-ask', placeholder: 'Ask about this call…', bind: 'local.cw.askText', value: l.askText, enter: 'cw.askSend', ariaLabel: 'Ask about this call' })) : ''}
      ${copilotBanner(false) ? region('CS-R4d', { cls: 'cs-r4d' }, copilotBanner(false)) : ''}
      ${region('CS-R4c', { cls: 'cs-r4c', label: 'Cards', attrs: { 'data-proto-scroll': 'cw-cards' } }, C.copilotCardStack({ variant: single ? 'single-agent' : 'dedicated', cards: l.muted ? [] : l.cards, held: l.held.length, single, muted: l.muted, off: l.copilotBanner === 'sensitive-off', showMode: true }))}
      ${region('CS-R4e', { cls: 'cs-r4e', label: 'In context' }, html`
        <div class="cs-r4e__chips"><span class="np-dim">In context:</span>${D.contextChips.map((c) => C.contextChip(c))}</div>
        ${comp('copilot-card-stack', { variant: 'earlier-cards', state: l.earlierOpen ? 'expanded' : 'collapsed', cls: 'cs-earlier' }, html`${P.disclosure('Earlier cards (' + l.earlier.length + ')', l.earlierOpen, { action: ['cw.earlier'] })}
          ${l.earlierOpen ? html`<div class="cs-earlier__list">${l.earlier.map((c) => html`<div class="cs-earlier__row">${C.copilotCard(c, { variant: 'read-only', single })}${P.button('Pin', { size: 'small', action: ['cw.pinEarlier', { id: c.id }] })}</div>`)}</div>` : ''}`)}`)}
    </div>`;
    return comp('cpt-noter-component-screen-call-screen', { cls: 'cs' + (off ? ' is-copilot-off' : ''), state: l.closing ? 'closing' : l.engineStopped ? 'engine-stopped' : paused ? 'paused' : 'recording', variant: off ? 'copilot-off' : single ? 'single-agent' : 'council' },
      html`${l.notice ? region('CS-R0', { cls: 'cs-r0' }, C.captureNotice({ variant: l.notice, layout: 'dedicated' })) : ''}
      <div class="cs-cols">${transcript}${right}</div>
      ${C.callStatusStrip({ variant: off ? 'copilot-off' : 'dedicated' })}`);
  };

  /* ---------------- floating layout ---------------- */
  const floatingPanel = () => {
    const l = L();
    const off = l.copilot === 'off';
    const single = l.copilot === 'single';
    const h = l.fpHeight;
    const maxCards = h < 380 ? 1 : h < 600 ? 2 : 3;
    const tail = !off && (h >= 680 || l.showTranscript);
    const paused = state.rec.status === 'paused';
    const header = region('FP-R1', { cls: 'fp-r1', tag: 'header', label: 'Panel header' }, html`
      ${C.recordingIndicator({ variant: 'dot', status: NP.liveStatus(), clock: false })}
      <span class="fp-title" title="${title()}">${title()}</span>
      <span class="np-tnum fp-clock">${NP.clock(false)}</span>
      ${shareGlyph()}
      ${l.secondDisplay !== false ? P.iconButton('displays', { label: 'Move to Display 2', size: 'inline', action: ['cw.layout', { layout: 'dedicated' }] }) : ''}
      ${P.iconButton('eyeSlash', { label: 'Hide Noter for Presenting', size: 'inline', help: 'Hide Noter for Presenting (⌃⌥⌘0)', action: ['cw.hide', { how: 'presenting' }] })}
      ${moreMenu('fp-more')}
      ${P.iconButton('chevronUp', { label: 'Collapse Panel', size: 'inline', action: ['cw.layout', { layout: 'collapsed' }] })}
      ${P.iconButton('x', { label: 'Hide', size: 'inline', help: 'Hide to the menu bar', action: ['cw.hide', { how: 'hide' }] })}`);
    const notice = l.notice ? region('FP-R0', { cls: 'fp-r0' }, C.captureNotice({ variant: l.notice, layout: 'floating' })) : '';
    const modeLine = off || l.notice ? '' : region('FP-R2', { cls: 'fp-r2' }, html`<div class="fp-r2__line"><b>${single ? 'Copilot' : 'Council'}</b>${C.modeIndicator({ variant: 'floating' })}<span class="np-tb__spacer"></span>${muteMenu('fp-mute', true)}</div><div class="fp-r2__legend">${C.cardLegend()}</div>`);
    const firstInfo = l.firstFloat && !l.notice ? C.inlineBanner({ id: 'fp-share', severity: 'info', compact: true, region: 'FP-R3', text: raw('Hidden from window shares only. Before sharing your whole screen, press ' + P.kbd('⌃⌥⌘0') + '.'), actions: [{ label: 'Got It', action: ['cw.gotIt'] }], dismissible: false }) : '';
    const banners = l.notice ? '' : html`${transcriptBanner(true)}${copilotBanner(true)}${firstInfo}`;
    const cards = off ? '' : region('FP-R4', { cls: 'fp-r4', label: 'Cards', attrs: { 'data-proto-scroll': 'fp-cards' } }, html`
      ${l.askOpen ? html`<div class="fp-ask">${P.textField({ id: 'cw-ask', placeholder: 'Ask about this call…', bind: 'local.cw.askText', value: l.askText, enter: 'cw.askSend', ariaLabel: 'Ask about this call' })}</div>` : ''}
      ${C.copilotCardStack({ variant: single ? 'single-agent' : 'compact', cards: l.muted ? [] : l.cards, held: l.held.length, maxVisible: maxCards, showAll: l.showAllCards, single, muted: l.muted })}`);
    const tailRegion = tail ? region('FP-R5', { cls: 'fp-r5' }, l.playback ? C.playbackBar({ variant: 'live-headphones', at: l.playback.t, speaker: l.playback.speaker, key: 'cw' }) : C.transcriptView({ variant: 'tail', key: 'cw-tail', segments: segments(), tailLines: 3 })) : '';
    const offBody = off ? region('FP-R5', { cls: 'fp-r5 fp-r5--full' }, C.transcriptView({ variant: 'tail', key: 'cw-tail', segments: segments(), tailLines: 8 })) : '';
    return comp('cpt-noter-component-screen-floating-panel', { cls: 'fp', state: l.engineStopped ? 'engine-stopped' : paused ? 'paused' : l.notice ? 'notice' : 'recording', variant: off ? 'copilot-off' : single ? 'single-agent' : 'council', attrs: { style: `height:${h}px` } },
      html`${header}${notice}${modeLine}${banners ? html`<div class="fp-r3" data-region="FP-R3">${banners}</div>` : ''}${cards}${tailRegion}${offBody}
      ${region('FP-R6', { cls: 'fp-r6', tag: 'footer' }, C.callStatusStrip({ variant: off ? 'copilot-off' : 'compact' }))}`);
  };

  /* ---------------- closing state (whole window) ---------------- */
  const closingView = (fl) => {
    const l = L();
    return html`<div class="cw-closing${fl ? ' is-floating' : ''}">
      ${C.captureNotice({ variant: l.closing === 'auto' ? 'stopped-automatically' : 'stopped-by-you', layout: fl ? 'floating' : 'dedicated' })}
      <p class="np-dim cw-closing__hint">The panel closes in 10 s. Continue Recording works for 5 minutes, also from the menu bar.</p>
    </div>`;
  };

  /* ---------------- desk: prototype controls + surface ---------------- */
  const protoBar = () => {
    const l = L();
    const lay = layout();
    const btn = (label, on, action, args) => html`<button type="button" class="cw-proto__btn${on ? ' is-on' : ''}" aria-pressed="${String(!!on)}" ${act(action, args)}>${label}</button>`;
    return html`<div class="cw-proto" data-proto-chrome>
      <span class="cw-proto__lbl">Layout</span>
      ${btn('Call screen · display 2', lay === 'dedicated', 'cw.layout', { layout: 'dedicated' })}${btn('Floating panel', lay === 'floating', 'cw.layout', { layout: 'floating' })}${btn('Collapsed strip', lay === 'collapsed', 'cw.layout', { layout: 'collapsed' })}
      ${lay === 'floating' ? html`<span class="cw-proto__lbl">Panel height</span>${btn('360', l.fpHeight === 360, 'cw.fpHeight', { h: 360 })}${btn('560', l.fpHeight === 560, 'cw.fpHeight', { h: 560 })}${btn('720', l.fpHeight === 720, 'cw.fpHeight', { h: 720 })}` : ''}
      <span class="cw-proto__lbl">Output</span>${btn('Headphones', l.route === 'headphones', 'cw.route', { route: 'headphones' })}${btn('Speakers', l.route === 'speakers', 'cw.route', { route: 'speakers' })}${btn('Not identified', l.route === 'unknown', 'cw.route', { route: 'unknown' })}
      <span class="cw-proto__lbl">Simulate</span>${btn('New card', false, 'cw.simCard')}${btn('Card keys ⌃⌥⌘1–3', false, 'cw.simKey')}${btn('Panel becomes key', l.panelKey, 'cw.panelKey')}
    </div>`;
  };

  const hiddenView = () => {
    const l = L();
    const pres = l.hidden === 'presenting';
    return html`<div class="cw-hidden" data-proto-chrome>
      ${icon(pres ? 'eyeSlash' : 'menubar', { size: 28 })}
      <div class="t-headline">${pres ? 'Noter is hidden for presenting' : 'The panel is hidden to the menu bar'}</div>
      <div class="np-muted">${pres ? 'Every Noter surface is hidden. Capture, transcript and copilot keep running; the card keys are released.' : 'Capture continues. The menu bar keeps the recording state.'}</div>
      <div class="cw-hidden__btns">${P.button(pres ? 'Show Noter Again (⌃⌥⌘0)' : 'Open Call Screen (⌃⌥⌘N)', { variant: 'primary', action: ['cw.unhide'] })}${P.button('Menu Bar', { action: ['surface.show', { surface: 'menubar' }] })}</div>
    </div>`;
  };

  const closedView = () => html`<div class="cw-hidden" data-proto-chrome>
    ${icon('checkCircle', { size: 28 })}
    <div class="t-headline">${L().closed === 'discarded' ? 'Recording discarded' : 'The call window closed'}</div>
    <div class="np-muted">${L().closed === 'discarded' ? 'Nothing was kept.' : 'Outputs are being written; a notification says when the summary is ready.'}</div>
    <div class="cw-hidden__btns">${P.button('Open Main Window', { variant: 'primary', action: ['cw.closedGo'] })}${P.button('Start a New Recording', { action: ['cw.restart'] })}</div>
  </div>`;

  NP.surface('call', {
    label: 'Call window',
    states: [
      { id: 'default', label: 'Recording, three cards' },
      { id: 'listening', label: 'No card yet (listening)' },
      { id: 'held', label: 'Cards held (1 new card)' },
      { id: 'carry', label: 'Carry-forward card' },
      { id: 'single', label: 'Single-agent copilot' },
      { id: 'copilot-off', label: 'Copilot flag off' },
      { id: 'muted', label: 'Copilot muted' },
      { id: 'call-ended', label: 'Call seems to have ended' },
      { id: 'new-meeting', label: 'New meeting started' },
      { id: 'nothing-heard', label: 'Nothing heard yet' },
      { id: 'closing-manual', label: 'Closing after Stop Recording' },
      { id: 'closing-auto', label: 'Closing after automatic stop' },
      { id: 'mic-only', label: 'System audio silent (mic only)' },
      { id: 'mic-off', label: 'Microphone off (others only)' },
      { id: 'engine-stopped', label: 'Not recording · engine stopped' },
      { id: 'stalled', label: 'Transcription stalled' },
      { id: 'disk', label: 'Disk nearly full' },
      { id: 'second-source', label: 'Second audio source' },
      { id: 'switched-local', label: 'Switched to local' },
      { id: 'budget', label: 'Budget near cap, then paused' },
      { id: 'sensitive-off', label: 'Sensitive call, no local model' },
      { id: 'key-taken', label: 'Card key used by another app' },
      { id: 'detached', label: 'Scrolled up (Jump to Live)' },
      { id: 'replay', label: 'Replaying on headphones' },
      { id: 'speakers', label: 'Recording on speakers (replay off)' },
      { id: 'unknown-route', label: 'Output not identified (replay off)' },
      { id: 'paused', label: 'Paused' },
      { id: 'presenting', label: 'Hidden for presenting' },
      { id: 'unplugged', label: 'Display unplugged → floating' },
      { id: 'collapsed', label: 'Floating, collapsed strip' },
    ],
    onDemo: (id) => {
      const keepLayout = state.rec.layout;
      state.local.cw = init();
      const l = L();
      if (state.rec.status === 'idle' || state.rec.status === 'closing') NP.startRecording();
      if (state.rec.status === 'paused') { state.rec.startedAt += Date.now() - state.rec.pausedAt; state.rec.status = 'recording'; }
      state.rec.mode = 'Cloud, redacted';
      state.rec.layout = keepLayout;
      switch (id) {
        case 'listening': l.cards = []; break;
        case 'held': l.held = clone(D.cwHeldCards); break;
        case 'carry': l.cards = [Object.assign(clone(D.cwCarryForward), { num: 1 }), Object.assign(clone(D.cards[1]), { num: 2 })]; break;
        case 'single': l.copilot = 'single'; break;
        case 'copilot-off': l.copilot = 'off'; break;
        case 'muted': l.muted = true; break;
        case 'call-ended': l.notice = 'call-ended'; l.countdown = 10; break;
        case 'new-meeting': l.notice = 'new-meeting'; break;
        case 'nothing-heard': l.notice = 'nothing-heard'; l.waiting = true; l.cards = []; break;
        case 'closing-manual': l.closing = 'manual'; state.rec.status = 'closing'; break;
        case 'closing-auto': l.closing = 'auto'; state.rec.status = 'closing'; break;
        case 'mic-only': l.micOnly = true; l.banner = 'sys-silent'; l.extraRows.push({ gap: true, t: '00:30:02', text: 'System audio silent 00:30:02–00:30:40' }); break;
        case 'mic-off': l.noMic = true; l.banner = 'mic-off'; break;
        case 'engine-stopped': l.engineStopped = true; l.banner = 'engine-stopped'; break;
        case 'stalled': l.banner = 'stalled'; break;
        case 'disk': l.banner = 'disk'; break;
        case 'second-source': l.banner = 'second-source'; break;
        case 'switched-local': l.copilotBanner = 'switched-local'; state.rec.mode = 'Switched to local'; break;
        case 'budget': l.budget = 'near'; setTimeout(() => { const x = L(); if (x.budget === 'near') { x.budget = 'cap'; x.copilotBanner = 'budget'; NP.render(); } }, 4000); break;
        case 'sensitive-off': state.rec.mode = 'Sensitive · local'; l.copilotBanner = 'sensitive-off'; l.cards = []; break;
        case 'key-taken': l.keyTaken = true; break;
        case 'detached': l.detached = true; break;
        case 'replay': l.playback = { t: '00:19:58', speaker: 'p-anna' }; break;
        case 'speakers': l.route = 'speakers'; break;
        case 'unknown-route': l.route = 'unknown'; break;
        case 'paused': state.rec.status = 'paused'; state.rec.pausedAt = Date.now(); break;
        case 'presenting': l.hidden = 'presenting'; break;
        case 'unplugged': state.rec.layout = 'floating'; NP.flash('cw-proto', 'Display 2 was unplugged: the same window switched to the floating layout. Cards, pins and the transcript position are kept.', 6000); break;
        case 'collapsed': state.rec.layout = 'collapsed'; break;
        default: break;
      }
    },
    render: (ctx) => {
      if (state.rec.status === 'idle' && !L().closed) { NP.startRecording(); }
      const l = L();
      const lay = layout();
      const note = NP.flashed('cw-proto');
      let body;
      if (l.closed) body = closedView();
      else if (l.hidden) body = hiddenView();
      else if (lay === 'dedicated') {
        body = html`<div class="cw-frame cw-frame--dedicated">${NP.shell.window({ component: 'cpt-noter-component-shell-call-window', variant: 'dedicated', state: l.closing ? 'closing' : l.panelKey ? 'key' : 'not-key', titlebar: false, cls: 'cw-win cw-win--dedicated', body: l.closing ? html`<div class="cs cs--closing">${closingView(false)}</div>` : callScreen() })}</div>`;
      } else {
        const collapsed = lay === 'collapsed' && !l.notice;
        const panel = NP.shell.window({ component: 'cpt-noter-component-shell-call-window', variant: collapsed ? 'collapsed' : 'floating', state: l.closing ? 'closing' : l.panelKey ? 'key' : 'not-key', titlebar: false, cls: 'cw-win cw-win--floating' + (collapsed ? ' is-collapsed' : ''), body: l.closing ? closingView(true) : collapsed ? C.collapsedCallStrip() : floatingPanel() });
        body = html`<div class="cw-desktop">
          <div class="cw-callapp" data-proto-chrome aria-hidden="true"><div class="cw-callapp__bar">Microsoft Teams · keeps focus</div><div class="cw-callapp__grid"><span>Anna K.</span><span>Pavel</span><span>Dmitri S.</span><span>Speaker 3</span></div></div>
          <div class="cw-floatwrap${collapsed ? ' is-collapsed' : ''}">${panel}</div>
        </div>`;
      }
      const cap = lay === 'dedicated' ? ' · borderless, fills the visible frame of display 2 (shown scaled), non-activating panel' : lay === 'collapsed' ? ' · collapsed strip, 56 pt high' : ` · floating layout, 420 × ${l.fpHeight} pt, non-activating panel`;
      return html`${NP.shell.caption('Call window', cap)}${protoBar()}${note ? html`<div class="cw-proto-note" data-proto-chrome>${icon('info', { size: 13 })} ${note}</div>` : ''}${body}`;
    },
  });

  /* ---------------- actions ---------------- */
  const pushRow = (row) => { L().extraRows.push(row); };
  const cardById = (id) => L().cards.find((c) => c.id === id);
  const freeNum = () => { const used = L().cards.map((c) => c.num); return [1, 2, 3].find((n) => !used.includes(n)) || 3; };
  const addCard = (card) => {
    const l = L();
    while (l.cards.length > 2) { const old = l.cards.pop(); old.outcome = 'Expired'; l.earlier.unshift(old); }
    card.num = freeNum();
    card.isNew = Date.now();
    l.cards.unshift(card);
  };

  NP.onMany({
    'cw.layout': (a) => { state.rec.layout = a.layout; if (a.layout !== 'floating') L().showAllCards = false; },
    'cw.fpHeight': (a) => { L().fpHeight = a.h; },
    'cw.route': (a) => { const l = L(); l.route = a.route; if (a.route === 'speakers' && l.playback) { l.playback.stopped = true; setTimeout(() => { L().playback = null; NP.render(); }, 3000); } },
    'cw.panelKey': () => { L().panelKey = !L().panelKey; },
    'cw.engineRetry': () => { const l = L(); l.engineStopped = false; l.banner = null; pushRow({ gap: true, t: '00:31:40', text: 'Engine stopped 00:31:40–00:32:15' }); NP.flash('call-status', 'Recording again · same call', 2500); },
    'cw.simCard': () => {
      const l = L();
      const pool = clone(D.cwHeldCards).concat([{ id: 'k5', kind: 'Answer', agent: 'Architect', merged: ['QA lead'], age: 'now', text: 'VSTOR-9912 is open and unassigned; the replay buffer has no estimate yet.', prov: { kind: 'jira', label: 'Jira · looked up ' + new Date().toTimeString().slice(0, 5) } }]);
      const c = pool[(l.simN = (l.simN || 0) + 1) % pool.length]; c.id = c.id + '-' + l.simN;
      l.cards.forEach((x) => { x.age = x.age === 'now' ? '30 s' : x.age === '30 s' || x.age === '45 s' ? '1 min' : x.age; });
      addCard(c);
      if (layout() === 'collapsed') NP.flash('cw-proto', 'The strip cross-fades to the new card.', 2500);
    },
    'cw.simKey': () => {
      const l = L();
      const card = l.cards.find((c) => c.num === 2);
      if (card) NP.actions['cw.pin']({ id: card.id, byKey: true });
      else { NP.flash('call-status', 'No card 2', 2000); l.lastCardAction = null; }
    },
    'cw.pin': (a) => {
      const l = L();
      const c = cardById(a.id) || l.held.find((x) => x.id === a.id);
      if (!c) { NP.flash('call-status', 'No card ' + (a.num || ''), 2000); return; }
      l.cards = l.cards.filter((x) => x.id !== c.id);
      l.pinned.push({ id: 'pin-' + c.id, text: c.text.replace(/\.$/, ''), owner: 'p-you' });
      l.lastCardAction = { kind: 'pin', card: c };
      const short = c.text.length > 40 ? c.text.slice(0, 38) + '…' : c.text;
      NP.flash('call-status', 'Pinned card ' + c.num + ': ' + short, 3000);
      if (layout() === 'collapsed') l.layoutBeforeTemp = null;
    },
    'cw.cardDismiss': (a) => {
      const l = L();
      const c = cardById(a.id); if (!c) return;
      l.cards = l.cards.filter((x) => x.id !== c.id);
      c.outcome = 'Dismissed'; l.earlier.unshift(c);
      l.lastCardAction = { kind: 'dismiss', card: c };
      NP.flash('call-status', (a.text || 'Dismissed card ' + c.num), 3000);
      if (l.tempExpanded) { l.tempExpanded = false; state.rec.layout = 'collapsed'; }
    },
    'cw.undoCard': () => {
      const l = L(); const la = l.lastCardAction; if (!la) return;
      if (la.kind === 'pin') l.pinned = l.pinned.filter((p) => p.id !== 'pin-' + la.card.id);
      if (la.kind === 'dismiss') l.earlier = l.earlier.filter((x) => x.id !== la.card.id);
      l.cards.unshift(la.card); l.cards.sort((x, y) => x.num - y.num);
      l.lastCardAction = null;
      NP.flash('call-status', 'Undone', 2000);
    },
    'cw.cardExpand': (a) => { const l = L(); l.expanded[a.id] = !l.expanded[a.id]; },
    'cw.insertHeld': () => { const l = L(); l.held.forEach((c) => addCard(c)); l.held = []; },
    'cw.showAllCards': () => { L().showAllCards = !L().showAllCards; },
    'cw.earlier': () => { L().earlierOpen = !L().earlierOpen; },
    'cw.pinEarlier': (a) => { const l = L(); const c = l.earlier.find((x) => x.id === a.id); if (!c) return; l.earlier = l.earlier.filter((x) => x.id !== a.id); l.pinned.push({ id: 'pin-' + c.id, text: c.text, owner: 'p-you' }); NP.flash('call-status', 'Pinned: ' + c.text.slice(0, 40) + '…', 3000); },
    'cw.pinnedPopover': () => { state.popover = { id: 'cw-pinned', anchor: 'cw-pinned', props: {} }; state.menu = null; },
    'cw.unpin': (a) => { const l = L(); l.pinned = l.pinned.filter((p) => p.id !== a.id); },
    'cw.mark': () => {
      const t = clockNow();
      pushRow({ mark: true, t, text: 'Marked ' + t });
      NP.flash('cw-mark', 'Marked ' + t, 2000);
    },
    'cw.catchUp': () => {
      const l = L();
      if (l.copilot === 'off') return;
      const id = 'kcu-' + Date.now();
      addCard({ id, kind: 'Catch-up', agent: 'Scribe', merged: [], age: 'now', writing: true, lastLines: ['Pavel: Then who writes the acceptance criteria for the reconnect handling?', 'Dmitri S.: I will add a replay buffer on the backend, VSTOR-9912.'] });
      if (layout() === 'collapsed') { state.rec.layout = 'floating'; l.tempExpanded = true; }
      setTimeout(() => {
        const c = L().cards.find((x) => x.id === id);
        if (c) { c.writing = false; c.text = 'In the last minutes: Anna takes the drawer spec by Friday; Dmitri adds a replay buffer (VSTOR-9912); nobody owns the reconnect acceptance criteria yet.'; c.beingAsked = 'Who writes the acceptance criteria for the reconnect handling?'; c.prov = { kind: 'this-call', label: 'This call · 00:19:40–00:23:20' }; NP.render(); }
      }, 1800);
    },
    'cw.ask': () => { const l = L(); l.askOpen = !l.askOpen; l.panelKey = l.askOpen; if (layout() === 'collapsed') { state.rec.layout = 'floating'; l.tempExpanded = true; } setTimeout(() => { const f = document.getElementById('cw-ask'); if (f) f.focus(); }, 60); },
    'cw.askSend': (a) => {
      const l = L();
      const q = (a.value || l.askText || '').trim(); if (!q) return;
      addCard({ id: 'ksa-' + Date.now(), kind: 'Answer', agent: 'Architect', merged: [], age: 'now', question: q, text: 'Dmitri S. said at 00:22:41 that he adds a replay buffer on the backend (VSTOR-9912). Nobody took the acceptance criteria yet.', prov: { kind: 'this-call', label: 'This call · 00:22:41' } });
      l.askText = ''; l.askOpen = false; l.panelKey = false;
    },
    'cw.mute': () => { const l = L(); l.muted = !l.muted; if (l.muted) NP.flash('call-status', 'Copilot muted for 10 min · card keys released', 3000); },
    'cw.muteAgent': (a) => { const l = L(); l.mutedAgents = l.mutedAgents || {}; l.mutedAgents[a.id] = !l.mutedAgents[a.id]; NP.flash('call-status', a.name + (l.mutedAgents[a.id] ? ' muted for this call' : ' unmuted'), 2500); },
    'cw.toggleTranscript': () => { L().showTranscript = !L().showTranscript; },
    'cw.raiseCap': () => { const l = L(); l.budget = 'normal'; l.copilotBanner = null; NP.flash('call-status', 'Cap raised to $2 for this call', 2500); },
    'cw.gotIt': () => { L().firstFloat = false; },
    'cw.bannerClose': () => { L().banner = null; },
    'cw.deleteOldAudio': () => { NP.flash('cw-proto', 'Opens the sheet “Delete audio older than 30 days? Frees 6.2 GB. Transcripts and summaries stay.” in the main window; recording goes on.', 5000); },
    'cw.pause': () => {
      const r = state.rec;
      if (r.status === 'paused') {
        const from = NP.fmtClock(r.pausedAt - r.startedAt, false);
        r.startedAt += Date.now() - r.pausedAt; r.status = 'recording';
        pushRow({ gap: true, t: from, text: 'Paused ' + from + '–' + clockNow() });
      } else if (r.status === 'recording') { r.status = 'paused'; r.pausedAt = Date.now(); }
    },
    'cw.stop': (a) => {
      const l = L();
      l.notice = null; l.discardConfirm = false;
      l.closing = a && a.how === 'auto' ? 'auto' : 'manual';
      l.stoppedAt = clockNow();
      state.rec.pausedAt = Date.now();
      state.rec.status = 'closing';
      state.outputsWriting = true;
      const tok = l.closeToken = Date.now();
      setTimeout(() => { const x = L(); if (x.closing && x.closeToken === tok) { x.closing = null; x.closed = 'closed'; state.rec.status = 'idle'; NP.render(); } }, 10000);
    },
    'cw.continue': () => {
      const l = L(); const r = state.rec;
      const from = l.stoppedAt || '00:48:00';
      r.startedAt += Date.now() - r.pausedAt; r.status = 'recording';
      l.closing = null;
      pushRow({ gap: true, t: from, text: 'Stopped ' + from + '–' + clockNow() });
    },
    'cw.openInNoter': () => {
      const l = L();
      l.closing = null; l.closed = null; state.rec.status = 'idle';
      state.local.cw = null;
      NP.go('call-page', { callId: 'c-live' });
      return false;
    },
    'cw.closePanel': () => { const l = L(); l.closing = null; l.closed = 'closed'; state.rec.status = 'idle'; },
    'cw.closedGo': () => { state.local.cw = null; NP.go('today', {}); return false; },
    'cw.restart': () => { state.local.cw = null; NP.startRecording(); },
    'cw.keepRecording': () => { const l = L(); l.notice = null; l.keptOnce = true; if (l.tempExpandedForNotice) { state.rec.layout = 'collapsed'; l.tempExpandedForNotice = false; } },
    'cw.noticeClose': () => { const l = L(); l.notice = null; l.discardConfirm = false; if (l.tempExpandedForNotice) { state.rec.layout = 'collapsed'; l.tempExpandedForNotice = false; } },
    'cw.newCall': () => {
      const l = L();
      l.notice = null; l.newCall = true; l.cards = []; l.earlier = []; l.pinned = []; l.extraRows = [];
      NP.startRecording({ offsetMs: 12000 });
      NP.flash('call-status', 'Saved “Planning: VHI 8.0 drawer redesign” · started “1:1 with Anna K.”', 3500);
    },
    'cw.discardAsk': () => { L().discardConfirm = true; },
    'cw.discardBack': () => { L().discardConfirm = false; },
    'cw.discard': () => { const l = L(); l.notice = null; l.discardConfirm = false; l.closed = 'discarded'; state.rec.status = 'idle'; },
    'cw.hide': (a) => { L().hidden = a.how; },
    'cw.unhide': () => { L().hidden = null; },
    'cw.jumpLive': () => { const l = L(); l.detached = false; l.jumpReq = true; },
    'cw.play': (a) => {
      const l = L();
      if (l.route !== 'headphones' && a.key && a.key.indexOf('cw') === 0) return;
      if (l.playback && l.playback.t === a.t) l.playback = null; else l.playback = { t: a.t, speaker: a.speaker };
    },
    'cw.pbToggle': () => { const l = L(); if (l.playback) l.playback.paused = !l.playback.paused; },
    'cw.pbClose': () => { L().playback = null; },
    'cw.chipPin': (a) => { const l = L(); l.pinnedChips[a.id] = !l.pinnedChips[a.id]; },
    'cw.chipDrop': (a) => { L().droppedChips[a.id] = true; },
    'cw.chipUndo': (a) => { delete L().droppedChips[a.id]; },
    'cw.termFix': (a) => { const l = L(); l.termValue = null; state.popover = { id: 'term-fix', anchor: a.anchor, props: Object.assign({ where: 'call-window' }, a) }; state.menu = null; },
    'cw.termApply': (a) => {
      const seg = D.segments.find((s) => s.t === a.t);
      if (seg) { if (seg.term) { seg.text = seg.text.replace(seg.term.word, a.value); seg.term.word = a.value; } }
      state.popover = null; L().termValue = null;
      NP.flash('call-status', 'Fixed “' + a.value + '” · added to the glossary', 2500);
    },
    // person picker plumbing
    'cw.ppSelect': (a) => { const S = NP.local('pp-' + a.key); S.sel = a.id; },
    'cw.ppNew': (a) => { const S = NP.local('pp-' + a.key); S.newMode = true; S.name = S.q || ''; S.err = null; },
    'cw.ppBack': (a) => { const S = NP.local('pp-' + a.key); S.newMode = false; S.err = null; },
    'cw.ppCreate': (a) => {
      const S = NP.local('pp-' + a.key);
      const name = (S.name || '').trim();
      if (!name) { S.err = 'Enter a name.'; return; }
      if (!a.force && /^lena/i.test(name)) return; // duplicate line is showing
      const parts = name.split(/\s+/);
      const id = 'p-new-' + Date.now();
      const short = parts.length > 1 ? parts[0] + ' ' + parts[1][0] + '.' : parts[0];
      D.people.push({ id, name, short, initials: D.initials(name), role: S.role || 'New person', email: S.email, aliases: [], voiceProfile: false, lang: 'en' });
      NP.actions['cw.ppPick'](Object.assign({}, a, { id, created: true }));
    },
    'cw.ppPick': (a) => {
      if (!a.id) return;
      const p = D.person(a.id);
      const S = NP.local('pp-' + a.key);
      if (a.itemId) {
        const it = D.item(a.itemId); const prev = it && it.owner;
        if (it) it.owner = a.id;
        NP.undo('Owner set to ' + p.short, { context: it ? it.text : '', action: 'cw.undoOwner', args: { itemId: a.itemId, prev }, where: 'main' });
      } else if (a.speaker) {
        const label = a.speaker;
        const scopeLine = L().renameScope === 'line';
        let n = 0;
        const changed = [];
        D.segments.forEach((s) => { if (s.speaker === label && (!scopeLine || n === 0)) { s.speaker = a.id; n++; changed.push(s.t); } });
        const call = D.call('c-live');
        call.unnamed = (call.unnamed || []).filter((u) => u !== label);
        if (!call.people.includes(a.id)) call.people.push(a.id);
        const msg = (a.created ? 'You added ' + p.short + ' and named ' : 'Named ') + label + ' as ' + p.short + ' · ' + n + ' line' + (n === 1 ? '' : 's');
        L().lastRename = { label, id: a.id, changed, created: a.created };
        if (a.where === 'call-window') NP.flash('call-status', msg, 3500);
        else NP.undo(msg, { action: 'cw.undoRename', where: 'main' });
      }
      Object.assign(S, { q: '', sel: null, newMode: false, name: '', email: '', role: '', err: null });
      state.popover = null;
    },
    'cw.undoRename': () => {
      const r = L().lastRename; if (!r) return;
      D.segments.forEach((s) => { if (r.changed.includes(s.t)) s.speaker = r.label; });
      if (r.created) D.people = D.people.filter((p) => p.id !== r.id);
      const call = D.call('c-live'); call.unnamed = (call.unnamed || []).concat([r.label]);
    },
    'cw.undoOwner': (a) => { const it = D.item(a.itemId); if (it) it.owner = a.prev; },
    // the lead's provenance chip in the call window calls this
    'call.spanPreview': (a, ev, el) => {
      const host = el && el.closest('[data-proto-anchor]');
      state.popover = { id: 'span-preview', anchor: host ? host.getAttribute('data-proto-anchor') : 'x', props: a };
      state.menu = null;
    },
  });

  NP.overlay('cw-pinned', {
    width: 340,
    render: () => {
      const l = L();
      return html`<div class="np-pop__body"><div class="np-pop__title">${icon('pin', { size: 13 })} ${l.pinned.length} pinned</div>
        ${l.pinned.length ? l.pinned.map((p) => html`<div class="cw-pinrow"><span class="cw-pinrow__text">${p.text}</span>${P.button('Edit', { size: 'small', variant: 'quiet', action: ['proto.flash', { key: 'proto', text: 'Edit opens the item text and owner in place' }] })}${P.button('Unpin', { size: 'small', action: ['cw.unpin', { id: p.id }] })}</div>`) : html`<div class="np-muted">Nothing pinned yet.</div>`}
        <div class="np-dim">Pinned items reach the Call page as accepted action items.</div></div>`;
    },
  });

  /* ---------------- countdown + hover pause + transcript follow ---------------- */
  setInterval(() => {
    if (state.surface !== 'call') return;
    const l = state.local.cw;
    if (!l || l.notice !== 'call-ended' || l.countdownPaused || l.hidden) return;
    l.countdown -= 1;
    if (l.countdown <= 0) { l.countdown = 10; NP.actions['cw.stop']({ how: 'auto' }); }
    NP.render();
  }, 1000);

  NP.onAfterRender(() => {
    if (state.surface !== 'call') return;
    const l = state.local.cw; if (!l) return;
    const n = document.querySelector('[data-cw-notice="call-ended"]');
    if (n && !n._cw) {
      n._cw = true;
      const on = () => { if (!L().countdownPaused) { L().countdownPaused = true; NP.render(); } };
      const off = () => { if (L().countdownPaused) { L().countdownPaused = false; NP.render(); } };
      n.addEventListener('mouseenter', on); n.addEventListener('mouseleave', off);
      n.addEventListener('focusin', on); n.addEventListener('focusout', off);
    }
    const tv = document.querySelector('[data-cw-transcript="cw-live"]');
    if (tv) {
      if (!l.detached || l.jumpReq) { tv.scrollTop = tv.scrollHeight; l.jumpReq = false; }
      if (!tv._cw) {
        tv._cw = true;
        tv.addEventListener('scroll', () => {
          const x = L();
          const up = tv.scrollHeight - tv.scrollTop - tv.clientHeight > 40;
          if (up !== x.detached) { x.detached = up; NP.render(); }
        });
      }
    }
    if (l.keyTaken && !l.keyTakenTimer) { l.keyTakenTimer = setTimeout(() => { const x = state.local.cw; if (x) { x.keyTakenSeen = true; NP.render(); } }, 6000); }
  });

  /* global hotkeys (⌃⌥⌘ + key) while the call surface is shown */
  document.addEventListener('keydown', (ev) => {
    if (state.surface !== 'call' || !(ev.ctrlKey && ev.altKey && ev.metaKey)) return;
    const k = ev.code;
    const l = L();
    const run = (n, a) => { ev.preventDefault(); NP.actions[n](a || {}); NP.render(); };
    if (/^Digit[123]$/.test(k)) {
      const num = +k.slice(-1); const c = l.cards.find((x) => x.num === num);
      if (ev.shiftKey) { if (c) run('cw.cardDismiss', { id: c.id }); else { NP.flash('call-status', 'No card ' + num, 2000); NP.render(); } }
      else if (c) run('cw.pin', { id: c.id }); else { ev.preventDefault(); NP.flash('call-status', 'No card ' + num, 2000); l.lastCardAction = null; NP.render(); }
    } else if (k === 'KeyZ') run('cw.undoCard');
    else if (k === 'KeyM') run('cw.mark');
    else if (k === 'KeyC') run('cw.catchUp');
    else if (k === 'KeyP') run('cw.pause');
    else if (k === 'KeyR') run('cw.stop', { how: 'manual' });
    else if (k === 'KeyA') run('cw.ask');
    else if (k === 'KeyK') run('cw.mute');
    else if (k === 'Digit0') run(l.hidden ? 'cw.unhide' : 'cw.hide', { how: 'presenting' });
    else if (k === 'KeyN') run(l.hidden ? 'cw.unhide' : 'cw.panelKey');
  });
})();
