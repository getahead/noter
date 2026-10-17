/* =====================================================================
   Group A surfaces: Record prompt, Menu bar extra, First-run wizard,
   Notifications. Each draws a small macOS "desktop" scene on the desk.
   ===================================================================== */
(function () {
  const { html, raw, act, icon, P, C, data: D, state } = NP;
  const isRec = () => state.rec.status === 'recording' || state.rec.status === 'paused';

  /* ---------- desktop scene (prototype chrome around native surfaces) ---------- */
  const desk = (o) => html`<div class="a-desk${o.cls ? ' ' + o.cls : ''}" style="${o.h ? 'min-height:' + o.h + 'px' : ''}">
    <div class="a-mbar" data-proto-chrome aria-hidden="${o.menubar ? 'false' : 'true'}">
      <span class="a-mbar__app">${o.app || 'Microsoft Teams'}</span><span class="a-mbar__m">File</span><span class="a-mbar__m">Edit</span><span class="a-mbar__m">View</span><span class="a-mbar__m">Window</span><span class="a-mbar__m">Help</span>
      <span class="np-tb__spacer"></span>
      ${o.menubar || C.statusGlyph(isRec() ? (state.rec.status === 'paused' ? 'paused' : 'recording') : 'idle')}
      <span class="a-mbar__sys">${icon('wave', { size: 13 })}</span><span class="a-mbar__sys">${icon('search', { size: 13 })}</span><span class="a-mbar__clock np-tnum">Thu 16 Oct 10:23</span>
    </div>
    <div class="a-desk__body">${o.body}</div>
    ${NP.shell.windowOverlays()}
  </div>`;
  const callAppWindow = (title) => html`<div class="a-callapp" data-proto-chrome aria-hidden="true">
    <div class="a-callapp__bar">${NP.shell.lights()}<span>${title || 'Microsoft Teams · Planning: VHI 8.0 drawer redesign'}</span></div>
    <div class="a-callapp__grid">${['Anna K.', 'Pavel', 'Dmitri S.', 'You'].map((n) => html`<div class="a-callapp__tile"><span>${n}</span></div>`)}</div>
  </div>`;

  /* =================================================================
     Record prompt (cpt-noter-component-screen-record-prompt)
     ================================================================= */
  const RP_STATES = [
    { id: 'default', label: 'Call detected' },
    { id: 'event', label: 'Matched calendar event' },
    { id: 'not-a-call', label: 'Not a call (Safari)' },
    { id: 'disk-full', label: 'Disk below 500 MB' },
    { id: 'model-missing', label: 'Speech model not downloaded yet' },
    { id: 'system-audio-off', label: 'System audio access off' },
    { id: 'call-ended', label: 'Call ended, call window hidden' },
    { id: 'new-meeting', label: 'New meeting, call window hidden' },
    { id: 'closed', label: 'Closed unanswered' },
    { id: 'setup-incomplete', label: 'Setup incomplete (no prompt)' },
    { id: 'hidden', label: 'Hidden for presenting (no prompt)' },
  ];
  NP.surface('record', {
    label: 'Record prompt',
    states: RP_STATES,
    onDemo: (id) => {
      const L = NP.local('rp');
      L.closed = null; L.dontAsk = false; L.countdown = 10; L.hover = false;
      if (id === 'closed') L.closed = 'unanswered';
      if (id === 'call-ended' || id === 'new-meeting') { if (!isRec()) NP.startRecording(); }
    },
    render: (ctx) => {
      const d = ctx.demo;
      const L = ctx.local;
      const noPrompt = d === 'setup-incomplete' || d === 'hidden' || L.closed;
      const variant = { 'disk-full': 'disk-full', 'model-missing': 'model-missing', 'system-audio-off': 'system-audio-off', 'call-ended': 'call-ended', 'new-meeting': 'new-meeting' }[d] || 'default';
      const app = d === 'not-a-call' ? 'Safari' : 'Microsoft Teams';
      let note = '';
      if (noPrompt) {
        const why = L.closed === 'stopped' ? 'Recording stopped from the call-ended notice. The menu bar keeps Continue Recording for 5 minutes.'
          : L.closed === 'started' ? 'Recording started; the call window opened without taking focus.'
          : L.closed === 'dont-ask' ? `${app} is now listed in Settings › General › Apps Noter doesn't ask about, with Remove.`
          : L.closed === 'kept' ? 'The prompt closed and recording goes on. The notice comes back after the next 20 s of silence.'
          : d === 'setup-incomplete' ? 'No prompt: call detection is off until the self-test passes. The menu bar shows Setup incomplete · call detection off with the Finish Setup… link, and Start Recording works as always.'
          : d === 'hidden' ? 'No prompt while Noter is hidden for presenting. The menu bar offers Call Detected · Start Recording.'
          : 'The prompt closed after 15 s without an answer. The menu bar offers Call Detected · Start Recording for as long as the call runs.';
        note = html`<div class="a-note" data-proto-chrome><p>${why}</p><div class="a-note__btns"><button type="button" class="np-hbar__btn" ${act('rp.openMenu')}>Show the menu bar</button><button type="button" class="np-hbar__btn" ${act('proto.setDemo', { key: 'record', id: 'default' })}>Show the prompt again</button></div></div>`;
      }
      return html`${NP.shell.caption('Record prompt', ' · non-activating, content-protected panel at the top right of the main display, 360 to 440 wide')}
        <div data-component="cpt-noter-component-screen-record-prompt" data-state="${noPrompt ? 'no-prompt' : d}" data-variant="${variant}">
        ${desk({ h: 520, app: app === 'Safari' ? 'Safari' : 'Microsoft Teams', body: html`${callAppWindow(app === 'Safari' ? 'Safari · Notes dictation' : null)}
          ${noPrompt ? note : NP.region('RP', { tag: 'div', cls: 'rp-pos' + (L.lower ? ' is-lower' : '') }, C.recordPrompt({ variant, app, event: d === 'event' ? 'Planning: VHI 8.0 drawer redesign · Microsoft Teams' : null }))}` })}
        </div>`;
    },
  });

  NP.onMany({
    'rp.record': (a) => {
      NP.freshCall();
      if (a && a.sysOff) state.setup.sysGranted = false;
      if (a && a.sensitive) state.rec.mode = 'Sensitive · local'; else if (state.rec.mode === 'Sensitive · local') state.rec.mode = 'Cloud, redacted';
      NP.startRecording({ offsetMs: 12000 });
      NP.local('rp').closed = 'started';
      state.surface = 'call';
    },
    'rp.notNow': () => { NP.local('rp').closed = 'unanswered'; },
    'rp.dontAskStart': () => { NP.local('rp').dontAsk = true; },
    'rp.dontAskBack': () => { NP.local('rp').dontAsk = false; },
    'rp.dontAsk': () => { const L = NP.local('rp'); L.dontAsk = false; L.closed = 'dont-ask'; },
    'rp.deleteOldAudio': () => { state.surface = 'main'; NP.openSheet('delete-old-audio', { from: 'record-prompt' }); return false; },
    'rp.openSysSettings': () => { NP.openAlert({ title: '“Noter” needs to quit and reopen to record system audio.', body: 'This is macOS\'s own prompt, shown after you allow Noter in System Settings › Privacy & Security › Screen & System Audio Recording.', variant: 'system', buttons: [{ label: 'Later', action: 'alert.close' }, { label: 'Quit & Reopen', variant: 'primary', action: 'rp.reopen' }] }); },
    'rp.reopen': () => { state.alert = null; state.demo.record = 'default'; },
    'rp.keep': () => { const L = NP.local('rp'); L.closed = 'kept'; },
    'rp.stopNow': () => { stopFromNotice(); },
    'rp.keepInCall': () => { NP.local('rp').closed = 'kept'; },
    'rp.newCall': () => { NP.startRecording({ offsetMs: 12000 }); NP.local('rp').closed = 'started'; state.surface = 'call'; NP.flash('call-status', 'Saved “Planning: VHI 8.0 drawer redesign” · now recording 1:1 with Anna K.', 4000); },
    'rp.openMenu': () => {
      const hiddenIdle = state.demo.record === 'hidden' && !isRec() && NP.local('rp').closed !== 'stopped';
      /* hidden while not recording: idle menu with the eye-slash glyph and Call Detected · Start Recording */
      if (hiddenIdle) { state.demo.menubar = 'default'; Object.assign(NP.local('menubar'), { hidden: true, open: true, closing: false }); state.surface = 'menubar'; return; }
      state.demo.menubar = NP.local('rp').closed === 'stopped' ? 'closing' : (state.demo.record === 'setup-incomplete' ? 'setup-incomplete' : state.demo.record === 'hidden' ? 'hidden' : 'call-detected'); state.surface = 'menubar';
    },
  });
  const stopFromNotice = () => {
    state.rec.status = 'idle';
    const L = NP.local('rp'); L.closed = 'stopped';
    state.lastStop = { auto: true, at: '11:02' };
  };
  /* call-ended countdown: 1 s ticks, paused while hovered */
  setInterval(() => {
    if (state.surface !== 'record' || NP.demo('record') !== 'call-ended') return;
    const L = NP.local('rp');
    if (L.closed || L.hover) return;
    if (L.countdown == null) L.countdown = 10;
    L.countdown -= 1;
    if (L.countdown <= 0) { L.countdown = 10; stopFromNotice(); }
    NP.render();
  }, 1000);
  document.addEventListener('mouseover', (ev) => {
    if (state.surface !== 'record') return;
    const L = NP.local('rp');
    const inside = !!(ev.target.closest && ev.target.closest('[data-proto-rp="countdown"]'));
    if (inside !== !!L.hover) { L.hover = inside; NP.render(); }
  });

  /* =================================================================
     Menu bar extra (cpt-noter-component-screen-menu-bar)
     ================================================================= */
  const MB_STATES = [
    { id: 'default', label: 'Follows Capture menu' },
    { id: 'idle', label: 'Idle' },
    { id: 'recording', label: 'Recording' },
    { id: 'paused-5', label: 'Paused for 5 minutes' },
    { id: 'switched-local', label: 'Switched to local' },
    { id: 'setup-incomplete', label: 'Setup incomplete' },
    { id: 'audio-not-granted', label: 'Audio access not granted yet' },
    { id: 'muted', label: 'Copilot muted' },
    { id: 'call-detected', label: 'Call detected, not recorded' },
    { id: 'call-ended', label: 'Call seems to have ended' },
    { id: 'hidden', label: 'Hidden for presenting' },
    { id: 'hidden-ended', label: 'Call ended while hidden' },
    { id: 'hidden-new-meeting', label: 'New meeting while hidden' },
    { id: 'closing', label: 'After a stop (Continue Recording)' },
    { id: 'capture-problem', label: 'Capture problem, no surface visible' },
    { id: 'engine-stopped', label: 'Not recording · engine stopped' },
    { id: 'no-hotkey', label: 'Hotkey not registered' },
  ];
  const mi = (label, o) => {
    o = o || {};
    if (o.info) return html`<div class="mb-mi is-info" role="menuitem" aria-disabled="true">${label}</div>`;
    return html`<button type="button" class="mb-mi${o.checked ? ' is-checked' : ''}" role="menuitem"${o.sub ? raw(' aria-haspopup="menu"') : ''} ${act(o.action || 'proto.noop', o.args)}><span class="mb-mi__check">${o.checked ? '✓' : ''}</span><span class="mb-mi__label">${label}</span>${o.kbd && !o.noKey ? html`<span class="mb-mi__kbd">${o.kbd}</span>` : ''}${o.sub ? html`<span class="mb-mi__sub">▸</span>` : ''}</button>`;
  };
  const group = (code, items) => html`<div class="mb-group" role="group" data-region="${code}">${items}</div>`;

  const mbModel = (ctx) => {
    const d = ctx.demo;
    const L = ctx.local;
    let mode = state.rec.status === 'idle' ? 'idle' : state.rec.status;
    if (d === 'idle' || d === 'call-detected' || d === 'setup-incomplete' || d === 'audio-not-granted' || d === 'closing' || d === 'engine-stopped') mode = 'idle';
    if (['recording', 'switched-local', 'muted', 'call-ended', 'hidden', 'hidden-ended', 'hidden-new-meeting', 'capture-problem', 'no-hotkey'].includes(d)) mode = 'recording';
    if (d === 'paused-5') mode = 'paused';
    const hidden = d === 'hidden' || d === 'hidden-ended' || d === 'hidden-new-meeting' || !!L.hidden;
    const muted = d === 'muted' || !!L.muted;
    return { d, L, mode, hidden, muted, glyph: mode === 'idle' ? 'idle' : mode === 'paused' ? 'paused' : muted ? 'muted' : 'recording' };
  };

  const mbMenu = (m) => {
    const { d, L, mode, hidden, muted } = m;
    const noKey = d === 'no-hotkey';
    const title = D.call(state.rec.callId).title;
    const setupIncomplete = d === 'setup-incomplete' || d === 'audio-not-granted' || (d === 'default' && (state.setup.selfTestPassed === false || state.setup.micGranted === false || state.setup.sysGranted === false));
    const health = NP.captureHealth();
    const r2 = [];
    if (d === 'engine-stopped') {
      r2.push(mi(html`<span class="mb-warnline">Not recording · engine stopped</span>`, { info: true }));
      r2.push(mi(html`<span lang="en">${title}</span> · saved up to 00:31:40`, { info: true }));
    } else if (mode === 'idle') {
      if (d === 'closing' || L.closing) r2.push(mi(state.lastStop && state.lastStop.auto ? 'Stopped at 11:02 · the call had ended · 48 min saved' : 'Saved · 48 min · Summary in about 2 minutes', { info: true }));
      else r2.push(mi('Noter — Not recording', { info: true }));
      if (d === 'call-detected' || (hidden && d !== 'hidden-ended')) r2.push(mi('Call Detected · Start Recording', { action: 'mb.start' }));
      if (setupIncomplete) { r2.push(mi('Setup incomplete · call detection off', { info: true })); r2.push(mi('Finish Setup…', { action: 'mb.finishSetup' })); }
      r2.push(mi('Next: Stand-up 11:00', { info: true }));
    } else {
      if (d === 'call-ended') r2.push(mi('Call seems to have ended · stopping in 8 s', { info: true }));
      else if (d === 'hidden-ended') r2.push(mi('Call seems to have ended', { info: true }));
      else if (d === 'hidden-new-meeting') r2.push(mi(html`A new meeting may have started: <span lang="en">1:1 with Anna K.</span>`, { info: true }));
      else if (mode === 'paused') r2.push(mi('Paused for 5 min', { info: true }));
      else r2.push(mi(html`Recording · <span lang="en">${title}</span> · ${NP.clock(true)}`, { info: true }));
      r2.push(mi(html`4 speakers · EN / RU · ${C.modeIndicator({ variant: 'menu-line', mode: d === 'switched-local' ? 'Switched to local' : state.rec.mode })}`, { info: true }));
      if (d === 'switched-local') r2.push(mi('Switched to local', { info: true }));
      if (d === 'capture-problem' || health === 'mic-only') r2.push(mi(html`<span class="mb-warnline">System audio silent</span>`, { info: true }));
      else if (health === 'no-mic') r2.push(mi(html`<span class="mb-warnline">Microphone off</span>`, { info: true }));
      if (hidden) r2.push(mi('Hidden for presenting', { info: true }));
    }
    const r3 = [];
    if (d === 'engine-stopped') {
      r3.push(mi('Try Again', { action: 'mb.retryEngine' }));
    } else if (mode === 'idle') {
      if (d === 'closing' || L.closing) r3.push(mi('Continue Recording', { action: 'mb.continue' }));
      /* PM-60: Start Recording is never replaced by Finish Setup… */
      r3.push(mi('Start Recording', { kbd: '⌃⌥⌘R', action: 'mb.start', noKey }));
    } else {
      if (d === 'call-ended') { r3.push(mi('Keep Recording', { action: 'mb.keep' })); r3.push(mi('Stop Now', { action: 'mb.stop' })); }
      if (d === 'hidden-new-meeting') { r3.push(mi('Start as New Call', { action: 'mb.newCall' })); r3.push(mi('Keep in This Call', { action: 'mb.keepInCall' })); }
      r3.push(mi('Stop Recording', { kbd: '⌃⌥⌘R', action: 'mb.stop', noKey }));
      r3.push(mode === 'paused' ? mi('Resume', { kbd: '⌃⌥⌘P', action: 'mb.pause', noKey }) : mi('Pause', { kbd: '⌃⌥⌘P', action: 'mb.pause', noKey }));
    }
    const r4 = mode === 'idle' ? '' : group('MB-R4', [
      mi('Mark Moment', { kbd: '⌃⌥⌘M', action: 'mb.mark', noKey }),
      mi('Catch Me Up', { kbd: '⌃⌥⌘C', action: 'mb.toCall', args: { what: 'catch-up' }, noKey }),
      mi('Ask About This Call…', { kbd: '⌃⌥⌘A', action: 'mb.toCall', args: { what: 'ask' }, noKey }),
      muted ? mi('Unmute', { action: 'mb.unmute' }) : '',
      mi('Mute Copilot', { sub: true, action: 'mb.muteMenu' }),
    ]);
    const r5 = group('MB-R5', [
      mode === 'idle' ? '' : mi('Open Call Screen', { kbd: '⌃⌥⌘N', action: 'mb.openCall', noKey }),
      mode === 'idle' ? '' : mi('Use Floating Panel', { checked: state.rec.layout === 'floating', action: 'mb.floating' }),
      mi('Open Last Summary — Design review · 09:30', { action: 'mb.lastSummary' }),
      hidden ? mi('Show Noter', { kbd: '⌃⌥⌘0', action: 'mb.hide', noKey }) : mi('Hide for Presenting', { kbd: '⌃⌥⌘0', action: 'mb.hide', noKey }),
    ]);
    const r6 = mode === 'idle' ? '' : group('MB-R6', mi('Next: Stand-up 11:00', { info: true }));
    const r7 = group('MB-R7', [mi('Open Noter', { action: 'mb.openNoter' }), mi('Settings…', { kbd: '⌘,', action: 'mb.settings' }), mi('Quit Noter', { kbd: '⌘Q', action: 'mb.quit' })]);
    const muteSub = L.muteOpen ? html`<div class="mb-menu mb-menu--sub" role="menu" aria-label="Mute Copilot">
      ${mi('For 10 Minutes', { kbd: '⌃⌥⌘K', checked: L.muted === '10', action: 'mb.mute', args: { v: '10' } })}
      ${mi('For This Call', { checked: L.muted === 'call', action: 'mb.mute', args: { v: 'call' } })}
      ${mi('For All Planning Calls', { checked: L.muted === 'planning', action: 'mb.mute', args: { v: 'planning' } })}
      ${muted ? mi('Unmute', { action: 'mb.unmute' }) : ''}</div>` : '';
    return html`<div class="mb-menuwrap"><div class="mb-menu" role="menu" aria-label="Noter">
      ${group('MB-R2', r2)}${group('MB-R3', r3)}${r4}${r5}${r6}${r7}</div>${muteSub}</div>`;
  };

  NP.surface('menubar', {
    label: 'Menu bar',
    states: MB_STATES,
    onDemo: (id) => {
      const L = NP.local('menubar');
      L.closing = false; L.hidden = false; L.muteOpen = false; L.open = true;
      L.muted = id === 'muted' ? 'call' : null;
      if (id === 'audio-not-granted') state.setup.sysGranted = false;
      if (id === 'idle' || id === 'call-detected') { state.setup.micGranted = true; state.setup.sysGranted = true; }
      if (id === 'engine-stopped' && isRec()) state.rec.status = 'idle';
    },
    render: (ctx) => {
      const m = mbModel(ctx);
      const L = ctx.local;
      if (L.open == null) L.open = true;
      const glyphLegend = html`<div class="mb-legend" data-proto-chrome>
        <div class="mb-legend__h">Template glyphs (monochrome, adapt to the menu bar)</div>
        <div class="mb-legend__row">${['idle', 'recording', 'paused', 'muted'].map((g) => html`<div class="mb-legend__cell">${NP.comp('status-item', { variant: g + '-glyph', state: 'closed', tag: 'span', cls: 'mb-legend__g' }, C.statusGlyph(g))}${NP.comp('status-item', { variant: g + '-glyph-hidden', state: 'closed', tag: 'span', cls: 'mb-legend__g' }, C.statusGlyph(g, { hidden: true }))}<span>${{ idle: 'Idle', recording: 'Recording', paused: 'Paused', muted: 'Copilot muted' }[g]}</span></div>`)}</div>
        <div class="mb-legend__row">${NP.comp('status-item', { variant: 'title-elapsed-time', state: 'closed', tag: 'span', cls: 'mb-legend__t' }, html`${C.statusGlyph('recording')}<span class="np-tnum">23:14</span>`)}${NP.comp('status-item', { variant: 'title-newest-card', state: 'closed', tag: 'span', cls: 'mb-legend__t' }, html`${C.statusGlyph('recording')}<span>Ask: owner for drawer?</span>`)}<span class="np-dim">Optional title: None (default), Elapsed Time or Newest Card, 24 characters at most</span></div>
      </div>`;
      const statusItem = C.statusItem({ glyph: m.glyph, hidden: m.hidden, open: L.open, menu: mbMenu(m), state: L.open ? 'menu-open' : 'closed' });
      return html`${NP.shell.caption('Menu bar extra', ' · native status item and menu, drawn by macOS')}
        <div data-component="cpt-noter-component-screen-menu-bar" data-state="${m.d === 'default' ? m.mode : m.d}" class="mb-scene">
          ${desk({ h: 640, app: 'Microsoft Teams', menubar: statusItem, body: callAppWindow() })}
        </div>${glyphLegend}`;
    },
  });

  NP.onMany({
    'mb.newCall': () => { state.demo.menubar = 'hidden'; NP.flash('proto', 'Saved the call and started “1:1 with Anna K.” (capture_answer_new_meeting: start_as_new_call)', 4000); },
    'mb.keepInCall': () => { state.demo.menubar = 'hidden'; NP.flash('proto', 'Kept in this call', 3000); },
    'mb.toggle': () => { const L = NP.local('menubar'); L.open = !L.open; L.muteOpen = false; },
    'mb.start': () => {
      const L = NP.local('menubar');
      const wasHidden = !!L.hidden || state.demo.menubar === 'hidden';
      NP.freshCall(); NP.startRecording({ offsetMs: 12000 }); L.closing = false;
      /* hidden for presenting: recording starts, nothing is drawn, the menu keeps the eye-slash glyph */
      if (wasHidden) { L.hidden = false; state.demo.menubar = 'hidden'; NP.flash('proto', 'Recording started; nothing opens while Noter is hidden for presenting', 2500); return; }
      state.demo.menubar = 'default'; state.surface = 'call';
    },
    'mb.finishSetup': () => { const F = NP.local('firstrun'); F.step = 2; state.surface = 'firstrun'; },
    'mb.retryEngine': () => { NP.startRecording({ offsetMs: 31 * 60000 + 40000 }); state.demo.menubar = 'default'; NP.flash('proto', 'Recording again in the same call · gap row Engine stopped 00:31:40–00:32:15', 3000); },
    'mb.stop': () => { state.rec.status = 'idle'; const L = NP.local('menubar'); L.closing = true; state.lastStop = { auto: false }; state.demo.menubar = 'default'; },
    'mb.keep': () => { state.demo.menubar = 'recording'; },
    'mb.continue': () => { NP.startRecording({ offsetMs: 48 * 60000 }); NP.local('menubar').closing = false; state.demo.menubar = 'default'; state.surface = 'call'; NP.flash('call-status', 'Continued · gap row Stopped 11:02–11:04', 4000); },
    'mb.pause': () => { if (state.rec.status === 'paused') { state.rec.startedAt += Date.now() - state.rec.pausedAt; state.rec.status = 'recording'; } else { state.rec.status = 'paused'; state.rec.pausedAt = Date.now(); } if (state.demo.menubar === 'paused-5') state.demo.menubar = 'default'; },
    'mb.mark': () => { NP.flash('proto', 'Marked ' + NP.fmtClock(NP.elapsedMs()) + ' · a mark row is added; nothing opens', 2500); },
    'mb.toCall': (a) => { state.surface = 'call'; NP.local('call').askOpen = a.what === 'ask'; if (a.what === 'catch-up') NP.flash('call-status', 'Catch-up card added on top of the stack', 3000); },
    'mb.muteMenu': () => { const L = NP.local('menubar'); L.muteOpen = !L.muteOpen; },
    'mb.mute': (a) => { const L = NP.local('menubar'); L.muted = a.v; L.muteOpen = false; },
    'mb.unmute': () => { const L = NP.local('menubar'); L.muted = null; L.muteOpen = false; if (state.demo.menubar === 'muted') state.demo.menubar = 'recording'; },
    'mb.openCall': () => { state.rec.layout = state.rec.layout === 'collapsed' ? 'floating' : state.rec.layout; NP.local('menubar').hidden = false; state.surface = 'call'; },
    'mb.floating': () => { state.rec.layout = state.rec.layout === 'floating' ? 'dedicated' : 'floating'; state.surface = 'call'; },
    'mb.lastSummary': () => { NP.go('call-page', { callId: 'c-design', view: 'summary' }); return false; },
    'mb.hide': () => { const L = NP.local('menubar'); const d = state.demo.menubar; if (d === 'hidden' || d === 'hidden-ended') { state.demo.menubar = 'default'; L.hidden = false; } else L.hidden = !L.hidden; },
    'mb.openNoter': () => { NP.local('menubar').hidden = false; NP.go('today'); return false; },
    'mb.settings': () => { NP.actions['settings.open']({}); return false; },
    'mb.quit': () => {
      /* same alert as Dialogs › Quit while recording: Cancel is the default button */
      if (isRec()) NP.openAlert({ title: 'Noter is recording “Planning: VHI 8.0 drawer redesign”', body: 'Quitting stops the recording. The transcript so far is kept.', variant: 'warning', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Stop and Quit', variant: 'secondary', action: 'mb.quitConfirm' }] });
      else NP.flash('proto', 'Noter quits (prototype stays open)');
    },
    'mb.quitConfirm': () => { state.alert = null; state.rec.status = 'idle'; NP.flash('proto', 'Noter quit; the recording was saved', 2500); },
  });

  /* =================================================================
     First-run wizard (cpt-noter-component-screen-first-run)
     ================================================================= */
  const STEPS = ['Welcome', 'Models', 'Permissions', 'Call display', 'Audio storage', 'Assistants'];
  const FR_STATES = [
    { id: 'default', label: 'Welcome' },
    { id: 'models', label: 'Models downloading' },
    { id: 'no-connection', label: 'No connection' },
    { id: 'disk', label: 'Not enough disk space' },
    { id: 'checksum', label: 'Checksum failed' },
    { id: 'speech-wait', label: 'Speech model not ready' },
    { id: 'perm-not-asked', label: 'Permission not asked' },
    { id: 'mic-denied', label: 'Microphone denied' },
    { id: 'sys-missing', label: 'System audio permission missing' },
    { id: 'passed', label: 'Self-test passed' },
    { id: 'one-silent', label: 'One stream silent' },
    { id: 'skipped', label: 'Self-test skipped' },
    { id: 'display', label: 'Call display, two displays' },
    { id: 'one-display', label: 'One display' },
    { id: 'storage', label: 'Audio storage' },
    { id: 'assistants', label: 'Assistants' },
    { id: 'key-rejected', label: 'Key rejected' },
    { id: 'no-assistant', label: 'No key and no local runtime' },
  ];
  const freshFR = () => ({ step: 0, marks: {}, models: { speech: 34, speaker: 100, search: 58 }, paused: false, noConnection: false, disk: false, checksum: false, perms: { mic: 'not-asked', sys: 'missing' }, display: 'auto', oneDisplay: false, autoOpen: true, retention: '30', privacy: 'redacted', keys: { anthropic: '', codex: '' }, keyState: { anthropic: 'empty', codex: 'empty' }, ollama: 'detected', failNext: false });
  const F = () => { const L = NP.local('firstrun'); if (L.models == null) Object.assign(L, freshFR(), { step: L.step || 0 }); return L; };

  NP.surface('firstrun', {
    label: 'First run',
    states: FR_STATES,
    onDemo: (id) => {
      const L = NP.local('firstrun');
      Object.keys(L).forEach((k) => delete L[k]);
      Object.assign(L, freshFR());
      NP.local('selftest-fr').state = null;
      const at = (n) => { L.step = n; for (let i = 0; i < n; i++) L.marks[i] = L.marks[i] || 'done'; };
      const grant = () => { L.perms = { mic: 'granted', sys: 'granted' }; };
      switch (id) {
        case 'models': at(1); break;
        case 'no-connection': at(1); L.noConnection = true; break;
        case 'disk': at(1); L.disk = true; L.models = { speech: 0, speaker: 0, search: 0 }; break;
        case 'checksum': at(1); L.checksum = true; break;
        case 'speech-wait': at(2); grant(); L.models.speech = 62; NP.local('selftest-fr').state = 'waiting'; break;
        case 'perm-not-asked': at(2); break;
        case 'mic-denied': at(2); L.perms = { mic: 'denied', sys: 'missing' }; break;
        case 'sys-missing': at(2); L.perms = { mic: 'granted', sys: 'missing' }; break;
        case 'passed': at(2); grant(); L.models.speech = 100; NP.local('selftest-fr').state = 'passed'; break;
        case 'one-silent': at(2); grant(); L.models.speech = 100; NP.local('selftest-fr').state = 'failed'; break;
        case 'skipped': at(3); L.marks[2] = 'skipped'; L.models.speech = 100; break;
        case 'display': at(3); grant(); L.models.speech = 100; break;
        case 'one-display': at(3); grant(); L.oneDisplay = true; break;
        case 'storage': at(4); grant(); break;
        case 'assistants': at(5); grant(); break;
        case 'key-rejected': at(5); grant(); L.keys.anthropic = 'sk-ant-api03-wrong'; L.keyState.anthropic = 'rejected'; break;
        case 'no-assistant': at(5); grant(); L.ollama = 'missing'; L.noAssistantWarn = true; break;
        default: break;
      }
    },
    render: () => {
      const L = F();
      const steps = STEPS.map((label, i) => ({ label, state: L.marks[i] || 'upcoming', running: i === 1 && L.step > 1 && Object.values(L.models).some((v) => v < 100) && !L.disk, progress: Math.round((L.models.speech + L.models.speaker + L.models.search) / 3) }));
      if (L.checksum || L.disk) steps[1].state = L.step === 1 ? steps[1].state : 'error';
      const isSkippable = L.step === 2 || L.step === 3;
      const body = html`<div class="fr">
        ${NP.region('FR-R1', { tag: 'aside', cls: 'fr-r1', label: 'Steps' }, html`
          <div class="fr-r1__lights">${NP.shell.lights({ noZoom: true })}</div>
          <h2 class="fr-r1__h">Set up Noter</h2>
          ${C.wizardStepper({ steps, current: L.step, variant: L.resumed ? 'resumed' : 'first-pass' })}
          <p class="fr-r1__note">Everything here runs on this Mac. Nothing leaves it until you connect an assistant in step 6.</p>`)}
        <div class="fr-main">
          ${NP.region('FR-R2', { tag: 'div', cls: 'fr-r2', label: STEPS[L.step], attrs: { 'data-proto-scroll': 'fr-r2' } }, stepBody(L))}
          ${NP.region('FR-R3', { tag: 'footer', cls: 'fr-r3' }, html`
            <span class="fr-r3__env">macOS 15 · Core Audio process tap</span><span class="np-tb__spacer"></span>
            ${isSkippable ? P.button('Skip for Now', { variant: 'quiet', action: ['fr.skip'] }) : ''}
            ${P.button('Back', { action: ['fr.back'], disabled: L.step === 0 })}
            ${L.step === 5 ? P.button('Finish', { variant: 'primary', action: ['fr.finish'] }) : P.button('Continue', { variant: 'primary', action: ['fr.next'] })}`)}
        </div></div>`;
      return html`${NP.shell.caption('First-run wizard', ' · separate window, 760 × 560, opens before the first call')}
        ${NP.shell.window({ component: 'cpt-noter-component-screen-first-run', variant: 'step-' + (L.step + 1), state: STEPS[L.step].toLowerCase().replace(/ /g, '-'), title: 'Set up Noter', w: 760, h: 560, titlebar: false, cls: 'fr-win', body })}`;
    },
  });

  const credField = (L, id, label) => {
    const st = L.keyState[id];
    return NP.comp('credential-row', { variant: 'field-form', state: st, cls: 'fr-cred' }, html`
      <span class="fr-cred__label">${label}</span>
      <span class="fr-cred__ctl">${st === 'stored' ? html`<span class="fr-cred__stored"><span class="np-mono">••••••••</span>  ${icon('lock', { size: 12 })} Stored in the Keychain</span>${P.button('Remove', { size: 'small', variant: 'quiet', action: ['fr.keyRemove', { id }] })}`
        : html`${P.textField({ id: 'fr-key-' + id, variant: 'secure', placeholder: id === 'anthropic' ? 'sk-ant-…' : 'sk-…', value: L.keys[id], bind: 'local.firstrun.keys.' + id, invalid: st === 'rejected', message: 'Anthropic rejected this key (invalid key)', ariaLabel: label, cls: 'fr-cred__field' })}${P.button('Verify', { size: 'regular', action: ['fr.keyVerify', { id }], loading: st === 'verifying' })}`}</span>`);
  };

  const modelRow = (L, id, name, size) => {
    const v = L.models[id];
    const failed = L.checksum && id === 'speech';
    const st = failed ? 'failed' : v >= 100 ? 'finished' : L.paused || L.noConnection ? 'paused' : 'running';
    return html`<div class="fr-model" data-state="${st}"><div class="fr-model__name">${name}<span class="np-dim"> · ${size}</span></div>
      <div class="fr-model__bar">${P.progress({ value: v, state: st, label: name })}<span class="np-tnum fr-model__pct">${v >= 100 ? 'Ready' : failed ? 'Check failed' : v + ' %'}</span>${failed ? P.button('Try Again', { size: 'small', action: ['fr.retryModel'] }) : ''}</div></div>`;
  };

  const stepBody = (L) => {
    const title = (t) => html`<h1 class="fr-title" tabindex="-1">${t}</h1>`;
    switch (L.step) {
      case 0: return html`${html`<h1 class="fr-title t-large" tabindex="-1">Welcome to Noter</h1>`}
        <p class="fr-p">Noter records your online calls, transcribes them on this Mac and turns them into summaries, decisions and action items. Setup takes a few minutes; the models download while you carry on.</p>
        <ul class="fr-list"><li>${icon('globe', { size: 15 })}English, Russian and German, also mixed in one call</li><li>${icon('laptop', { size: 15 })}Audio and transcripts stay on this Mac</li><li>${icon('mic', { size: 15 })}Two permissions, both asked in step 3</li></ul>`;
      case 1: return html`${title('Models')}
        <p class="fr-p">Noter downloads its speech, speaker and search models once. You can continue while they download.</p>
        ${L.disk ? C.inlineBanner({ severity: 'error', text: 'Needs 2.1 GB, 1.4 GB free', actions: [{ label: 'Try Again', action: ['fr.diskRetry'] }] }) : ''}
        ${L.noConnection ? html`<div class="fr-waitline">${icon('clock', { size: 13 })}Waiting for a connection — downloads resume automatically</div>` : ''}
        <div class="fr-models np-card">
          ${modelRow(L, 'speech', 'Speech model · WhisperKit Large v3 Turbo', '1.5 GB')}
          ${modelRow(L, 'speaker', 'Speaker model', '0.1 GB')}
          ${modelRow(L, 'search', 'Search model', '0.4 GB')}
          <div class="fr-models__foot"><span>About 2 GB</span><span class="np-tb__spacer"></span>${L.disk ? '' : P.button(L.paused ? 'Resume' : 'Pause', { size: 'small', action: ['fr.pause'] })}</div>
        </div>`;
      case 2: {
        const speechReady = L.models.speech >= 100;
        const stState = NP.local('selftest-fr').state || (L.perms.sys !== 'granted' ? 'permission-missing' : !speechReady ? 'waiting' : 'idle');
        return html`${title('Microphone and system audio')}
        <p class="fr-p">Noter captures your voice from the microphone and the other participants from whatever app plays them.</p>
        <div class="fr-perms">
          ${C.permissionCheckRow({ id: 'mic', label: 'Microphone', status: L.perms.mic, detail: 'MacBook Pro Microphone', why: 'Records your side of the call.' }, { variant: 'setup' })}
          ${C.permissionCheckRow({ id: 'sys', label: 'System audio recording', status: L.perms.sys, why: 'Records the other participants from the call app.', howto: 'How to allow it: System Settings › Privacy & Security › Screen & System Audio Recording › System Audio Recording Only › turn on Noter.' }, { variant: 'setup' })}
        </div>
        ${NP.local('selftest-fr').state ? C.selfTestPanel({ variant: 'wizard', key: 'fr' }) : C.selfTestPanel({ variant: 'wizard', key: 'fr', state: stState })}`;
      }
      case 3: return html`${title('Call display')}
        <p class="fr-p">Choose where the call screen opens. Noter remembers the display, not its position, so it finds it again after you reconnect.</p>
        ${C.displayPicker({ key: 'fr', value: L.display, variant: L.oneDisplay ? 'one' : 'several' })}
        <div class="fr-row">${P.toggle('Open the call screen automatically', L.autoOpen, { id: 'fr-autoopen', bind: 'local.firstrun.autoOpen' })}</div>
        <p class="fr-hint">When this is on, the call window opens as recording starts, and moves to a display that connects during the call.</p>`;
      case 4: return html`${title('Audio storage')}
        <p class="fr-p">Transcripts, summaries and items are always kept. Choose how long the audio itself stays on this Mac.</p>
        ${P.radioGroup('fr-retention', [
          { value: '30', label: 'Keep audio for 30 days', note: 'Lets you replay recent calls and correct transcripts' },
          { value: '7', label: '7 days' }, { value: '90', label: '90 days' }, { value: 'forever', label: 'Forever' },
          { value: 'never', label: 'Never store audio', note: 'Replay and the archive pass are not available' },
        ], L.retention, { label: 'Audio retention', bind: 'local.firstrun.retention' })}
        <p class="fr-hint">You can change this later in Settings › Privacy › Audio retention.</p>`;
      default: {
        const noAssist = L.ollama === 'missing' && L.keyState.anthropic !== 'stored' && L.keyState.codex !== 'stored' && !(NP.auth && (NP.auth.signedIn('claude') || NP.auth.signedIn('chatgpt')));
        return html`${title('Assistants')}
        <p class="fr-p">Summaries, cards and answers come from an assistant. Add an API key, sign in with your own Claude or ChatGPT account, use a local model, or combine them. Keys go to the Keychain.</p>
        <div class="fr-creds np-card">${credField(L, 'anthropic', 'Anthropic API key')}${credField(L, 'codex', 'Codex API key')}</div>
        <div class="fr-sublabel">Or use your own account</div>
        <div class="fr-creds np-card f-accts">${C.accountRow ? html`${C.accountRow('claude', { variant: 'wizard' })}${C.accountRow('chatgpt', { variant: 'wizard' })}` : ''}</div>
        <div class="fr-runtime">${L.ollama === 'detected' ? html`${icon('checkCircle', { size: 14, cls: 'fr-ok' })}<span><strong>Local runtime:</strong> Ollama detected</span>` : L.ollama === 'installing' ? html`${P.progress({ variant: 'spinner' })}<span><strong>Local runtime:</strong> Installing Ollama…</span>` : html`<span><strong>Local runtime:</strong> none found</span>${P.button('Install Ollama…', { size: 'small', action: ['fr.installOllama'] })}${P.button('Not Now', { size: 'small', variant: 'quiet', action: ['fr.ollamaNotNow'] })}`}</div>
        <div class="fr-privacy"><div class="fr-sublabel">Privacy mode</div>${P.radioGroup('fr-privacy', [
          { value: 'redacted', label: 'Cloud with redaction', note: 'Names and PII are replaced before anything leaves this Mac' },
          { value: 'cloud', label: 'Cloud allowed' },
          { value: 'local', label: 'Local only', note: 'Everything stays on this Mac' },
        ], L.privacy, { label: 'Privacy mode', bind: 'local.firstrun.privacy' })}</div>
        ${noAssist || L.noAssistantWarn ? C.inlineBanner({ severity: 'warning', text: 'Without an assistant Noter still records and transcribes; summaries wait until one is connected.' }) : ''}`;
      }
    }
  };

  NP.onMany({
    'fr.step': (a) => { F().step = a.index; },
    'fr.next': () => { const L = F(); if (L.marks[L.step] !== 'skipped') L.marks[L.step] = 'done'; L.step = Math.min(5, L.step + 1); },
    'fr.back': () => { const L = F(); L.step = Math.max(0, L.step - 1); },
    'fr.skip': () => { const L = F(); L.marks[L.step] = 'skipped'; L.step += 1; },
    'fr.finish': () => {
      const L = F();
      L.marks[5] = 'done';
      const stS = NP.local('selftest-fr').state;
      state.setup.micGranted = L.perms.mic === 'granted';
      state.setup.sysGranted = L.perms.sys === 'granted';
      state.setup.selfTestPassed = stS === 'passed' || stS === 'exclusion-off' || stS === 'exclusion-failed';
      state.setup.assistant = (L.keyState.anthropic === 'stored' || L.keyState.codex === 'stored' || L.ollama === 'detected' || (NP.auth && (NP.auth.signedIn('claude') || NP.auth.signedIn('chatgpt')))) ? 'api-key' : 'none';
      state.demo.today = 'default';
      NP.go('today');
      return false;
    },
    'fr.pause': () => { const L = F(); L.paused = !L.paused; },
    'fr.diskRetry': () => { const L = F(); L.disk = false; L.models = { speech: 3, speaker: 8, search: 2 }; },
    'fr.retryModel': () => { const L = F(); L.checksum = false; L.models.speech = 0; },
    'fr.permAllow': (a) => {
      const what = a.id === 'mic' ? 'the microphone' : 'record this computer\'s screen and audio';
      NP.openAlert({ title: `“Noter” would like to access ${what}.`, body: a.id === 'mic' ? 'Noter records your voice in calls and transcribes it on this Mac.' : 'Noter uses it only for this test and never records your screen.', variant: 'system', buttons: [{ label: "Don't Allow", action: 'fr.permAnswer', args: { id: a.id, ok: false } }, { label: 'Allow', variant: 'primary', action: 'fr.permAnswer', args: { id: a.id, ok: true } }] });
    },
    'fr.permAnswer': (a) => { state.alert = null; F().perms[a.id] = a.ok ? 'granted' : 'denied'; },
    'fr.permSettings': (a) => {
      const L = F(); L.perms[a.id] = 'checking';
      NP.flash('proto', 'System Settings opens at Privacy & Security; the row checks again when Noter is active', 2200);
      setTimeout(() => { L.perms[a.id] = 'granted'; const st = NP.local('selftest-fr'); if (st.state === 'permission-missing') st.state = null; NP.render(); }, 1300);
    },
    'fr.display': (a) => { NP.local('dp-' + (a.key || 'default')).value = a.value; if (a.key === 'fr') F().display = a.value; },
    'fr.stDetails': (a) => { const L = NP.local('selftest-' + a.key); L.details = !L.details; },
    'fr.stClip': (a) => runSelfTest(a.key, true),
    'fr.stRun': (a) => runSelfTest(a.key, false),
    'fr.keyVerify': (a) => {
      const L = F(); L.keyState[a.id] = 'verifying';
      setTimeout(() => { const v = (L.keys[a.id] || '').trim(); L.keyState[a.id] = !v || /wrong|bad/.test(v) ? 'rejected' : 'stored'; NP.render(); }, 800);
    },
    'fr.keyRemove': (a) => { const L = F(); L.keyState[a.id] = 'empty'; L.keys[a.id] = ''; },
    'fr.installOllama': () => { const L = F(); L.ollama = 'installing'; setTimeout(() => { L.ollama = 'detected'; L.noAssistantWarn = false; NP.render(); }, 1600); },
    'fr.ollamaNotNow': () => { const L = F(); L.ollama = 'missing'; },
    'fr.hkRecord': (a) => { const H = NP.local('hotkeys'); H.recording = H.recording === a.id ? null : a.id; delete H['err-' + a.id]; },
    'fr.hkClear': (a) => { const H = NP.local('hotkeys'); H[a.id] = ''; delete H['err-' + a.id]; },
  });

  const runSelfTest = (key, clip) => {
    const L = NP.local('selftest-' + key);
    if (key === 'fr' && F().models.speech < 100) { L.state = 'waiting'; return; }
    L.state = clip ? 'clip' : 'running';
    setTimeout(() => {
      if (clip) L.state = 'running';
      NP.render();
      setTimeout(() => {
        const failNext = NP.demo('firstrun') === 'one-silent' && key === 'fr' && !L.retried;
        L.retried = true;
        L.state = failNext ? 'failed' : 'passed';
        if (!failNext) state.setup.selfTestPassed = true;
        NP.render();
      }, 1300);
    }, clip ? 1400 : 0);
  };

  /* background downloads while the wizard is visible */
  setInterval(() => {
    if (state.surface !== 'firstrun') return;
    const L = NP.local('firstrun');
    if (!L.models || L.paused || L.noConnection || L.disk || !(L.step >= 1)) return;
    let changed = false;
    ['speech', 'speaker', 'search'].forEach((k) => {
      if (k === 'speech' && L.checksum) return;
      if (L.models[k] < 100) { L.models[k] = Math.min(100, L.models[k] + (k === 'speech' ? 3 : 5)); changed = true; }
    });
    const st = NP.local('selftest-fr');
    if (st.state === 'waiting' && L.models.speech >= 100) { runSelfTest('fr', false); }
    if (changed && (L.step === 1 || L.step === 2 || L.step > 1)) NP.render();
  }, 900);

  /* hotkey recording: physical keys, so Russian and German layouts work */
  document.addEventListener('keydown', (ev) => {
    const H = NP.local('hotkeys');
    if (!H.recording) return;
    ev.preventDefault(); ev.stopPropagation();
    const id = H.recording;
    if (ev.key === 'Escape') { H.recording = null; NP.render(); return; }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return;
    const k = ev.code.startsWith('Key') ? ev.code.slice(3) : ev.code.startsWith('Digit') ? ev.code.slice(5) : ev.key.length === 1 ? ev.key.toUpperCase() : ev.code;
    const chord = (ev.ctrlKey ? '⌃' : '') + (ev.altKey ? '⌥' : '') + (ev.shiftKey ? '⇧' : '') + (ev.metaKey ? '⌘' : '') + k;
    H.recording = null;
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) { H['err-' + id] = 'Add Command, Option or Control'; }
    else if (ev.metaKey && !ev.ctrlKey && !ev.altKey && k === 'M') { H['err-' + id] = 'Used by macOS for Minimize'; }
    else if (ev.ctrlKey && ev.altKey && !ev.metaKey) { H['err-' + id] = 'Used by VoiceOver'; }
    else { H[id] = chord; delete H['err-' + id]; }
    NP.render();
  }, true);

  /* =================================================================
     Notifications (cpt-noter-component-screen-notifications)
     ================================================================= */
  const NT_STATES = [
    { id: 'default', label: 'Outputs ready (NT-1)' },
    { id: 'failed', label: 'Outputs failed (NT-2)' },
    { id: 'capture', label: 'System audio silent, call window hidden (NT-3)' },
    { id: 'capture-mic', label: 'Microphone off, call window hidden (NT-3)' },
    { id: 'capture-engine', label: 'Not recording · engine stopped (NT-3)' },
    { id: 'several', label: 'Several calls in a row' },
    { id: 'not-asked', label: 'Permission not asked yet' },
    { id: 'denied', label: 'Permission denied' },
    { id: 'window-front', label: 'Main window already shows the call' },
    { id: 'held', label: 'Hidden for presenting / next call recording' },
  ];
  const banner = (id, title, body, action, args, thread) => NP.comp('cpt-noter-component-screen-notifications', { variant: id, state: 'delivered', tag: 'button', cls: 'nt-banner', attrs: { type: 'button', 'data-proto-action': action, 'data-proto-args': JSON.stringify(args || {}), 'aria-label': title + '. ' + body, 'data-thread': thread } },
    html`<span class="nt-banner__icon" aria-hidden="true">${icon('noter', { size: 22 })}</span><span class="nt-banner__text"><span class="nt-banner__top"><strong>${title}</strong><span class="np-dim">now</span></span><span class="nt-banner__body" lang="en">${body}</span></span>`);
  const NT1 = () => banner('nt-1', 'Summary ready', 'Planning: VHI 8.0 drawer redesign · 4 action items, 2 decisions', 'ntf.open', { callId: 'c-live' }, 'c-live');
  const NT2 = () => banner('nt-2', "Couldn't write the summary", 'Planning: VHI 8.0 drawer redesign · open the call to try again', 'ntf.open', { callId: 'c-live', failed: true }, 'c-live');
  const NT3 = (k) => k === 'mic' ? banner('nt-3', 'Microphone off', 'Recording continues with the other side only.', 'ntf.call', {}, 'capture')
    : k === 'engine' ? banner('nt-3', 'Not recording · engine stopped', 'Open the call window to try again.', 'ntf.call', { engine: true }, 'capture')
    : banner('nt-3', 'System audio silent', 'Recording continues with your microphone.', 'ntf.call', {}, 'capture');

  NP.surface('notifications', {
    label: 'Notifications',
    states: NT_STATES,
    render: (ctx) => {
      const d = ctx.demo;
      let banners = [];
      let note = '';
      if (d === 'default') banners = [NT1()];
      if (d === 'failed') banners = [NT2()];
      if (d === 'capture') banners = [NT3()];
      if (d === 'capture-mic') banners = [NT3('mic')];
      if (d === 'capture-engine') banners = [NT3('engine')];
      if (d.startsWith('capture')) note = html`<p>NT-3 is sent at once, never held, while no call surface is visible. It is not sent while Noter is hidden for presenting: then only the menu bar's degraded line shows the problem.</p>`;
      if (d === 'several') banners = [NT1(), banner('nt-1', 'Summary ready', 'Backend sync · 2 action items, 1 decision', 'ntf.open', { callId: 'c-backend' }, 'c-backend')];
      if (d === 'not-asked') note = html`<p>No notification is sent before you allow them. After the first recorded call the Call page shows this banner:</p>${C.inlineBanner({ severity: 'info', text: 'Get a notification when a summary is ready.', actions: [{ label: 'Notify Me When Summaries Are Ready', action: ['ntf.allow'] }], dismissible: true })}`;
      if (d === 'denied') note = html`<p>No notification after the next call. The Call page still loads without taking focus, the menu bar offers <strong>Open Last Summary — Design review · 09:30</strong>, and Settings › General shows:</p>${C.inlineBanner({ severity: 'warning', text: 'Notifications are off for Noter', actions: [{ label: 'Open System Settings…', action: ['proto.flash', { key: 'proto', text: 'Opens System Settings › Notifications › Noter' }] }] })}`;
      if (d === 'window-front') note = html`<p>No notification: the main window already shows this call. The page announces <strong>Summary ready</strong> politely to VoiceOver.</p>`;
      if (d === 'held') note = html`<p>Nothing arrives while a call records or while Noter is hidden for presenting. When capture stops or Noter is shown again, the held notifications arrive, one per call. The previous call's summary is already written during the next call; only its notification waits. NT-3 is never held, and is not sent at all while hidden for presenting.</p><div class="a-note__btns"><button type="button" class="np-hbar__btn" ${act('proto.setDemo', { key: 'notifications', id: 'several' })}>Deliver held notifications</button></div>`;
      const centre = html`<div class="nt-centre" aria-label="Notification Centre"><div class="nt-centre__h">Notification Centre · Noter</div>
        <div class="nt-thread"><div class="nt-thread__h">Planning: VHI 8.0 drawer redesign</div>${NT1()}${d === 'failed' ? NT2() : ''}</div>
        <div class="nt-thread"><div class="nt-thread__h">Backend sync</div>${banner('nt-1', 'Summary ready', 'Backend sync · 2 action items, 1 decision', 'ntf.open', { callId: 'c-backend' }, 'c-backend')}</div></div>`;
      return html`${NP.shell.caption('Notifications', ' · native macOS banners without buttons; titles and counts only, no sound')}
        <div data-component="cpt-noter-component-screen-notifications" data-state="${d}" class="nt-scene">
        ${desk({ h: 520, app: 'Finder', body: html`<div class="nt-stack" data-region="NT">${banners}</div>${note ? html`<div class="a-note" data-proto-chrome>${note}</div>` : ''}${d === 'default' || d === 'several' || d === 'failed' ? centre : ''}` })}
        </div>`;
    },
  });
  NP.onMany({
    'ntf.open': (a) => { NP.go('call-page', { callId: a.callId, view: 'summary', failed: a.failed || null }); return false; },
    'ntf.call': (a) => { state.surface = 'call'; if (!isRec()) NP.startRecording(); if (a && a.engine && NP.surfaces.call.onDemo) { state.demo.call = 'engine-stopped'; NP.surfaces.call.onDemo('engine-stopped'); } },
    'ntf.allow': () => { NP.openAlert({ title: '“Noter” would like to send you notifications.', body: 'Notifications may include alerts and badges.', variant: 'system', buttons: [{ label: "Don't Allow", action: 'ntf.answer', args: { ok: false } }, { label: 'Allow', variant: 'primary', action: 'ntf.answer', args: { ok: true } }] }); },
    'ntf.answer': (a) => { state.alert = null; state.demo.notifications = a.ok ? 'default' : 'denied'; },
  });

  /* fallback sheet for Delete Old Audio… (group C's Dialogs module may register the real one) */
  if (!NP.overlays['delete-old-audio']) {
    NP.overlay('delete-old-audio', {
      width: 480,
      title: () => 'Delete old audio',
      render: () => html`<div class="np-sheet__head"><div class="np-sheet__title">Delete audio older than 30 days?</div><div class="np-sheet__sub">Frees 6.2 GB. Transcripts and summaries stay.</div></div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button('Delete Audio', { variant: 'primary', cls: 'np-btn--destructive', action: ['a.deleteAudio'] })}</div>`,
    });
  }
  NP.on('a.deleteAudio', () => { state.sheet = null; state.demo.menubar = 'call-detected'; state.demo.record = 'closed'; NP.flash('proto', 'Deleted 6.2 GB of old audio · the menu bar offers Call Detected · Start Recording', 3000); });
})();
