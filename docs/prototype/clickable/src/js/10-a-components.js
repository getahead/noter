/* =====================================================================
   Group A components (DESIGN 3.2, table B):
   record-prompt (1), status-item (7), upcoming-call-card (29),
   wizard-stepper (49), permission-check-row (50), self-test-panel (51),
   display-picker (52), hotkey-recorder (53)
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, comp, icon, P, data: D } = NP;
  const C = NP.C;

  /* ---------------- 1. Record prompt ----------------
     recordPrompt({variant: default|disk-low|system-audio-off|call-ended|new-meeting, state, app, key}) */
  C.recordPrompt = (o) => {
    o = o || {};
    const variant = o.variant || 'default';
    const app = o.app || 'Microsoft Teams';
    const L = NP.local('rp');
    if (variant === 'call-ended') {
      const paused = L.hover;
      const secs = L.countdown == null ? 10 : L.countdown;
      return comp('record-prompt', { variant, state: paused ? 'countdown-paused' : 'countdown-running', cls: 'rp-panel', attrs: { role: 'dialog', 'aria-label': 'The call seems to have ended', 'data-proto-rp': 'countdown' } },
        html`${NP.region('RP-R1', { tag: 'div', cls: 'rp-r1' }, html`
          <div class="rp-r1__text"><div class="rp-title">The call seems to have ended</div>
          <div class="rp-sub">${app} stopped using audio and the microphone 20 s ago. ${paused ? 'Paused while you\'re here' : html`Stopping in <span class="np-tnum">${secs}</span> s.`}</div>
          <div class="rp-countdown" aria-hidden="true"><span style="width:${secs * 10}%"></span></div></div>`)}
        ${NP.region('RP-R3', { tag: 'div', cls: 'rp-r3' }, html`${P.button('Stop Now', { action: ['rp.stopNow'] })}<span class="np-tb__spacer"></span>${P.button('Keep Recording', { variant: 'primary', action: ['rp.keep'] })}`)}`);
    }
    if (variant === 'new-meeting') {
      return comp('record-prompt', { variant, state: 'default', cls: 'rp-panel', attrs: { role: 'dialog', 'aria-label': 'A new meeting may have started' } },
        html`${NP.region('RP-R1', { tag: 'div', cls: 'rp-r1' }, html`<div class="rp-r1__text"><div class="rp-title">A new meeting may have started: <span lang="en">1:1 with Anna K.</span></div><div class="rp-sub">Planning: VHI 8.0 drawer redesign is still recording.</div></div>`)}
        ${NP.region('RP-R3', { tag: 'div', cls: 'rp-r3' }, html`${P.button('Keep in This Call', { action: ['rp.keepInCall'] })}<span class="np-tb__spacer"></span>${P.button('Start as New Call', { variant: 'primary', action: ['rp.newCall'] })}`)}`);
    }
    const safari = app === 'Safari';
    const notNowItems = [
      { label: 'Not Now', action: ['rp.notNow'] },
      { divider: true },
      { label: `Don't Ask for ${app}…`, action: ['rp.dontAskStart'] },
    ];
    const notNow = P.pulldown('Not Now', notNowItems, { anchorId: 'rp-notnow', variant: 'panel' });
    let actions;
    if (L.dontAsk) {
      actions = html`<div class="rp-inline" role="group" aria-label="Don't ask for ${app}">
        ${safari ? html`<p>Calls in Safari, such as Google Meet, won't be offered for recording either.</p>` : html`<p>${app} won't be offered for recording again.</p>`}
        <div class="rp-inline__btns">${P.button('Back', { action: ['rp.dontAskBack'] })}${P.button("Don't Ask", { variant: 'primary', action: ['rp.dontAsk'] })}</div></div>`;
    } else if (variant === 'disk-low') {
      actions = html`<div class="rp-reason">${icon('warning', { size: 13 })}<span>Not enough disk space to record (420 MB free)</span></div>
        <div class="rp-btnrow">${notNow}${P.button('Delete Old Audio…', { action: ['rp.deleteOldAudio'] })}<span class="np-tb__spacer"></span>${P.button('Record', { variant: 'primary', disabled: true, kbd: '⌃⌥⌘R' })}</div>`;
    } else if (variant === 'system-audio-off') {
      actions = html`<div class="rp-reason">${icon('warning', { size: 13 })}<span>System audio access is off</span></div>
        <div class="rp-btnrow">${notNow}<span class="np-tb__spacer"></span>${P.button('Open System Settings…', { variant: 'primary', action: ['rp.openSysSettings'] })}</div>`;
    } else {
      actions = html`<div class="rp-btnrow">${notNow}${P.button('Record as Sensitive', { action: ['rp.record', { sensitive: true }] })}<span class="np-tb__spacer"></span>${P.button('Record', { variant: 'primary', action: ['rp.record'], kbd: '⌃⌥⌘R' })}</div>`;
    }
    return comp('record-prompt', { variant, state: variant === 'disk-low' || variant === 'system-audio-off' ? 'disabled' : (L.dontAsk ? 'not-a-call' : 'default'), cls: 'rp-panel', attrs: { role: 'dialog', 'aria-label': 'Record this call?' } },
      html`${NP.region('RP-R1', { tag: 'div', cls: 'rp-r1' }, html`
        <span class="rp-appicon" aria-hidden="true">${icon(safari ? 'globe' : 'people', { size: 20 })}</span>
        <div class="rp-r1__text"><div class="rp-title">Record this call?</div><div class="rp-sub">${o.event ? html`<span lang="en">${o.event}</span>` : `${app} is using the microphone`}</div></div>
        ${P.iconButton('x', { label: 'Close', size: 'inline', action: ['rp.notNow'] })}`)}
      ${NP.region('RP-R3', { tag: 'div', cls: 'rp-r3 rp-r3--stack' }, actions)}`);
  };

  /* ---------------- 7. Status item ----------------
     Glyph + native menu. statusItem({state, glyph, hidden, open, title, menu: html}) */
  const GLYPH = {
    idle: '<rect x="4" y="2.5" width="10" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.6 6.5h4.8M6.6 9h4.8M6.6 11.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    recording: '<rect x="4" y="2.5" width="10" height="13" rx="2.2" fill="currentColor"/><circle cx="9" cy="9" r="2.4" fill="var(--mb-bar)"/>',
    paused: '<rect x="4" y="2.5" width="10" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.4 6.5v5M10.6 6.5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    muted: '<rect x="4" y="2.5" width="10" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.6 6.5h4.8M6.6 9h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 15.5l13-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const EYE = '<g transform="translate(10.5 10.5) scale(.45)"><circle cx="8" cy="8" r="8" fill="var(--mb-bar)"/><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 13L13 3" stroke="currentColor" stroke-width="2"/></g>';
  C.statusGlyph = (glyph, o) => {
    o = o || {};
    const label = { idle: 'Noter, not recording', recording: 'Noter, recording', paused: 'Noter, paused', muted: 'Noter, copilot muted' }[glyph] + (o.hidden ? ', hidden for presenting' : '');
    return raw(`<svg class="mb-glyph" width="18" height="18" viewBox="0 0 18 18" role="img" aria-label="${NP.esc(label)}">${GLYPH[glyph] || GLYPH.idle}${o.hidden ? EYE : ''}</svg>`);
  };
  C.statusItem = (o) => {
    o = o || {};
    const glyph = o.glyph || 'idle';
    const variant = glyph + '-glyph' + (o.hidden ? '-hidden' : '');
    return comp('status-item', { variant, state: o.state || 'menu-open', cls: 'mb-item' + (o.open ? ' is-open' : ''), attrs: { 'data-region': 'MB-R1' } },
      html`<button type="button" class="mb-item__btn" aria-haspopup="menu" aria-expanded="${String(!!o.open)}" ${act('mb.toggle')}>${C.statusGlyph(glyph, o)}${o.title && !o.hidden ? html`<span class="mb-item__title np-tnum">${o.title}</span>` : ''}</button>
      ${o.open && o.menu ? o.menu : ''}`);
  };

  /* ---------------- 29. Upcoming call card ----------------
     upcomingCallCard(event, {variant: today|week|live|unmatched|nothing-open, key, expanded, rows, maxRows}) */
  C.upcomingCallCard = (ev, o) => {
    o = o || {};
    const variant = o.variant || 'today';
    const L = NP.local('today');
    const rec = NP.state.rec.status === 'recording' || NP.state.rec.status === 'paused';
    if (variant === 'unmatched') {
      return comp('upcoming-call-card', { variant, state: 'live', cls: 'td-card np-card is-live' },
        html`<div class="td-card__head"><div class="td-card__time">${C.recordingIndicator({ variant: 'dot', clock: false })}</div>
        <div class="td-card__title">Recording · Microsoft Teams · ${NP.clock(false)}</div>
        ${P.button('Open Call Screen', { variant: 'primary', size: 'small', action: ['call.show'] })}</div>`);
    }
    const items = (ev.items || []).map(D.item).filter((i) => i && (i.status !== 'done' || NP.flashed('row-' + i.id)));
    const qs = (ev.questions || []).map(D.item).filter(Boolean);
    const count = items.length + qs.length;
    if (variant === 'week') {
      const open = !!L.weekOpen && L.weekOpen[ev.id];
      return comp('upcoming-call-card', { variant, state: open ? 'expanded' : 'collapsed', cls: 'td-week' },
        html`<div class="td-week__line">${P.disclosure(html`<span class="td-week__day">${ev.day}</span> <span lang="en">${ev.title}</span>`, open, { variant: 'row', action: ['today.weekToggle', { id: ev.id }] })}${ev.summary === 'Local only' ? html`<span class="td-localtag">${icon('lock', { size: 11 })}Local only</span>` : html`<span class="td-week__sum">${ev.summary}</span>`}</div>
        ${open ? html`<div class="td-card__rows">${items.map((i) => NP.A.itemRow(i))}${!items.length ? C.emptyState({ variant: 'section', title: 'Nothing open' }) : ''}</div>` : ''}`);
    }
    const live = variant === 'live' || (rec && ev.callId === NP.state.rec.callId);
    const expanded = o.expanded !== false;
    const max = o.maxRows || 5;
    const showAll = L.showAll && L.showAll[ev.id];
    const rows = [...items.map((i) => ({ i, kind: 'item' })), ...qs.map((i) => ({ i, kind: 'q' }))];
    const visible = showAll ? rows : rows.slice(0, max);
    const moreAnchor = 'td-more-' + ev.id;
    NP._menus[moreAnchor] = [
      { label: 'Call Type', submenu: true, action: ['proto.flash', { key: 'proto', text: 'Call Type ▸ Planning · 1:1 · Backend sync · Vendor' }] },
      { label: 'Mark as Sensitive', action: ['today.sensitive', { id: ev.id }] },
      { label: 'Show Previous Call', action: ['nav.go', { screen: 'call-page', params: { callId: ev.lastCallId || 'c-backend', view: 'summary' } }] },
    ];
    const sensitive = L.sensitive && L.sensitive[ev.id];
    const state = live ? 'live' : sensitive ? 'sensitive' : (L.loadingItems ? 'loading-items' : (expanded ? 'expanded' : 'collapsed'));
    if (!expanded) {
      return comp('upcoming-call-card', { variant: 'today', state: 'collapsed', cls: 'td-card td-card--collapsed np-card' },
        html`<div class="td-card__head">${P.disclosure(html`<span class="td-card__time np-tnum">${ev.time}</span><span class="td-card__title" lang="en">${ev.title}</span>`, false, { variant: 'row', action: ['today.expand', { id: ev.id }] })}<span class="td-card__count">${count ? `${count} open item${count === 1 ? '' : 's'}` : 'Nothing open'}</span></div>`);
    }
    return comp('upcoming-call-card', { variant: live ? 'live' : (count ? 'today' : 'nothing-open'), state, cls: 'td-card np-card' + (live ? ' is-live' : '') },
      html`<div class="td-card__head" title="These items load into the copilot when the call starts.">
        <div class="td-card__time np-tnum">${live ? C.recordingIndicator({ variant: 'dot', clock: false }) : ''}${ev.time}</div>
        <div class="td-card__main">
          <div class="td-card__titlerow"><span class="td-card__title" lang="en" title="${ev.title}">${ev.title}</span>
            ${live ? P.button('Open Call Screen', { variant: 'primary', size: 'small', action: ['call.show'], kbd: '⌃⌥⌘N' }) : ''}
            ${P.pulldown('More', NP._menus[moreAnchor], { anchorId: moreAnchor, iconOnly: true, ariaLabel: 'More actions for ' + ev.title, help: 'More' })}
            ${o.collapsible ? P.iconButton('chevronUp', { label: 'Collapse', size: 'inline', action: ['today.expand', { id: ev.id }] }) : ''}</div>
          <div class="td-card__att">${(ev.people || []).map((p) => C.personChip(p))}<span class="td-card__platform">· ${ev.platform}</span>${sensitive ? html`<span class="td-localtag">${icon('lock', { size: 11 })}Local only</span>` : ''}</div>
          ${ev.lastTime ? html`<div class="td-card__last"><span>Last time:</span> ${C.provenanceChip({ kind: 'past-call', label: ev.lastTime, callId: ev.lastCallId, span: '00:00:00' }, { variant: 'inline' })}</div>` : ''}
        </div></div>
      <div class="td-card__rows">
        ${L.loadingItems ? html`<div class="td-skel"></div><div class="td-skel"></div>` : (!rows.length ? C.emptyState({ variant: 'section', title: 'Nothing open' }) : visible.map((r) => (r.kind === 'q' ? NP.A.questionRow(r.i) : NP.A.itemRow(r.i))))}
        ${!showAll && rows.length > max ? P.link(`Show ${rows.length - max} More`, { action: ['today.showAll', { id: ev.id }] }) : ''}
      </div>`);
  };

  /* ---------------- 49. Wizard stepper ----------------
     wizardStepper({steps:[{label, state, progress}], current, action}) */
  C.wizardStepper = (o) => {
    o = o || {};
    const steps = o.steps || [];
    return comp('wizard-stepper', { variant: o.variant || 'first-pass', state: 'step-' + ((o.current || 0) + 1), tag: 'ol', cls: 'fr-steps', attrs: { 'aria-label': 'Setup steps' } },
      steps.map((s, i) => {
        const st = i === o.current ? 'current' : s.state || 'upcoming';
        const clickable = st === 'done' || st === 'skipped' || st === 'error';
        const glyph = st === 'done' ? icon('check', { size: 12 }) : st === 'skipped' ? raw('<span aria-hidden="true">–</span>') : st === 'error' ? icon('warning', { size: 12 }) : String(i + 1);
        const inner = html`<span class="fr-step__mark">${glyph}</span><span class="fr-step__label">${s.label}</span>${s.running ? html`<span class="fr-ring" title="Downloading in the background · ${s.progress} %" style="--p:${s.progress}"></span>` : ''}${st === 'skipped' ? html`<span class="np-sr">Skipped</span>` : ''}`;
        return html`<li class="fr-step is-${st}" data-state="${st}"${st === 'current' ? raw(' aria-current="step"') : ''}>${clickable ? html`<button type="button" class="fr-step__btn" ${act(o.action || 'fr.step', { index: i })}>${inner}</button>` : html`<span class="fr-step__btn">${inner}</span>`}</li>`;
      }));
  };

  /* ---------------- 50. Permission check row ----------------
     permissionCheckRow(row, {variant: setup|status|test-only})
     row = {id, label, status: granted|missing|denied|checking|not-asked, detail, why, howto} */
  C.permissionCheckRow = (row, o) => {
    o = o || {};
    const variant = o.variant || 'setup';
    const st = row.status || 'not-asked';
    const word = { granted: 'Granted', missing: 'not allowed yet', 'not-asked': 'Not allowed yet', denied: 'not allowed', checking: 'Checking…' }[st];
    const ic = st === 'granted' ? icon('checkCircle', { size: 15 }) : st === 'checking' ? P.progress({ variant: 'spinner', label: 'Checking' }) : st === 'not-asked' ? icon('info', { size: 15 }) : icon('warning', { size: 15 });
    let action = '';
    if (variant !== 'status' || st !== 'granted') {
      if (st === 'not-asked' && row.id === 'mic') action = P.button('Allow…', { action: ['fr.permAllow', { id: row.id }] });
      else if (variant === 'test-only' && st === 'not-asked') action = P.button('Continue', { variant: 'primary', action: ['fr.permAllow', { id: row.id }] });
      else if (st !== 'granted' && st !== 'checking') action = P.button('Open System Settings…', { action: ['fr.permSettings', { id: row.id }] });
    }
    const mic = row.id === 'mic' && st === 'granted';
    return comp('permission-check-row', { variant, state: st, cls: 'fr-perm is-' + st },
      html`<span class="fr-perm__icon">${ic}</span>
      <div class="fr-perm__main">
        <div class="fr-perm__head"><span class="fr-perm__name">${row.label}</span>${row.detail && st === 'granted' ? html`<span class="np-dim"> · ${row.detail}</span>` : ''}<span class="fr-perm__word"> · ${word}</span></div>
        ${variant !== 'status' && row.why ? html`<div class="fr-perm__why">${row.why}</div>` : ''}
        ${variant !== 'status' && row.howto && st !== 'granted' ? html`<div class="fr-perm__how">${row.howto}</div>` : ''}
        ${mic && variant !== 'status' ? html`<span class="fr-perm__meter">${P.levelMeter({ level: 6, label: 'Microphone level' })}<span class="fr-perm__hear">Hearing you</span></span>` : ''}
      </div>
      ${action ? html`<span class="fr-perm__act">${action}</span>` : ''}`);
  };

  /* ---------------- 51. Self-test panel ----------------
     selfTestPanel({variant: wizard|sheet|settings, state, key})
     state: idle | waiting | clip | running | passed | failed | exclusion-off | exclusion-failed | permission-missing */
  C.selfTestPanel = (o) => {
    o = o || {};
    const key = o.key || 'default';
    const L = NP.local('selftest-' + key);
    const st = L.state || o.state || 'idle';
    const variant = o.variant === 'wizard' ? 'step' : (o.variant || 'step');
    const live = st === 'running' || st === 'clip';
    const passed = st === 'passed' || st === 'exclusion-off' || st === 'exclusion-failed';
    const you = st === 'permission-missing' ? 0 : live ? 7 : passed ? 5 : st === 'failed' ? 6 : 2;
    const others = st === 'permission-missing' ? 0 : st === 'clip' ? 8 : st === 'running' ? 4 : passed ? 3 : 0;
    const res = (ok, text, kind) => html`<li class="fr-st__res is-${kind || (ok ? 'ok' : 'pending')}">${icon(kind === 'info' ? 'info' : kind === 'warn' ? 'warning' : ok ? 'checkCircle' : 'ring', { size: 13 })}<span>${text}</span></li>`;
    let progressLine = '';
    if (st === 'waiting') progressLine = html`<div class="fr-st__prog">${P.progress({ value: 62, label: 'Speech model' })}<span>Waiting for the speech model · 62 %</span></div>`;
    if (st === 'clip') progressLine = html`<div class="fr-st__prog" title="Noter lets its own test clip into the capture for this test only.">${P.progress({ variant: 'spinner' })}<span>Listening for the clip…</span></div>`;
    if (st === 'running') progressLine = html`<div class="fr-st__prog">${P.progress({ variant: 'spinner' })}<span>Checking that Noter's own sounds stay out…</span></div>`;
    return comp('self-test-panel', { variant, state: st, cls: 'fr-st' },
      html`<div class="fr-st__head"><span class="fr-st__title">Self-test</span>${passed ? html`<span class="fr-st__passed" role="status">${icon('checkCircle', { size: 14 })}Self-test passed</span>` : ''}</div>
      <div class="fr-st__meters">
        <span class="fr-st__meter"><span class="fr-st__ml">You</span>${P.levelMeter({ level: you, label: 'Microphone level' })}</span>
        <span class="fr-st__meter"><span class="fr-st__ml">Others</span>${P.levelMeter({ level: others, label: 'System audio level' })}</span>
      </div>
      <div class="fr-st__live" aria-live="off">${st === 'clip' || passed ? html`<span lang="en">Noter test.</span> <span lang="ru">Привет.</span> <span lang="de">Hallo.</span> ${C.languageTag('EN')} ${C.languageTag('RU')} ${C.languageTag('DE')}` : html`<span class="np-dim">The live transcript line appears here while the test runs.</span>`}</div>
      ${progressLine}
      ${st === 'failed' ? html`<div class="fr-st__fail">${icon('warning', { size: 14 })}<span>We hear your microphone but not system audio. Play any sound in another app and try again.</span></div>` : ''}
      ${st === 'permission-missing' ? html`<div class="fr-st__fail">${icon('warning', { size: 14 })}<span>System audio recording is not allowed yet.</span>${P.button('Open System Settings…', { size: 'small', action: ['fr.permSettings', { id: 'sys' }] })}</div>` : ''}
      ${passed ? html`<ul class="fr-st__results">
        ${res(true, 'System audio arrives')}${res(true, 'Your microphone arrives')}${res(true, 'Both streams line up')}
        ${st === 'exclusion-off' ? res(false, "Noter's own sounds are recorded. Replay while recording stays off. Change this in Settings › Audio & Transcription.", 'info') : st === 'exclusion-failed' ? res(false, "Noter's own sounds reached the recording. Replay while recording stays off until this passes.", 'warn') : res(true, "Noter's own sounds stay out of the recording")}
      </ul>${P.disclosure('Details', !!L.details, { variant: 'row', action: ['fr.stDetails', { key }] })}${L.details ? html`<div class="fr-st__details np-tnum">Lag between streams 38 ms · alignment ±12 ms · clip heard after 420 ms</div>` : ''}` : ''}
      <div class="fr-st__actions">
        <div class="fr-st__clip">${P.button('Play Test Clip', { icon: 'play', action: ['fr.stClip', { key }], disabled: st === 'permission-missing' || st === 'waiting' })}<span class="fr-st__hint">Or play any sound in another app<br>Say a few words while the clip plays.</span></div>
        ${P.button('Run Test', { variant: variant === 'step' ? 'secondary' : 'primary', action: ['fr.stRun', { key }], loading: st === 'running', disabled: st === 'waiting' || st === 'permission-missing' })}
      </div>`);
  };

  /* ---------------- 52. Display picker ----------------
     displayPicker({value, variant: several|one|absent, key}) */
  C.displayPicker = (o) => {
    o = o || {};
    const key = o.key || 'default';
    const L = NP.local('dp-' + key);
    const variant = o.variant || 'several';
    const value = L.value || o.value || 'auto';
    const displays = [
      { id: 'builtin', name: 'Built-in Retina Display', res: '1512 × 982', x: 0, y: 46, w: 150, h: 98, callApp: true },
      { id: 'lg', name: 'LG UltraFine', res: '2560 × 1440', x: 160, y: 0, w: 220, h: 124 },
    ];
    const chosen = value === 'auto' ? 'lg' : value;
    if (variant === 'one') {
      return comp('display-picker', { variant: 'one-display', state: 'selected', cls: 'fr-dp' },
        html`<div class="fr-dp__one"><div class="fr-dp__screen is-sel"><span class="fr-dp__callapp">Call app</span><span class="fr-dp__float" aria-hidden="true"></span><span class="fr-dp__name">Built-in Retina Display</span><span class="fr-dp__res np-tnum">1512 × 982</span></div>
        <p class="fr-dp__note">With one display, the call opens as a floating panel beside the call app. Connect a second display and the call screen fills it.</p></div>
        ${P.radioGroup('dp-' + key, [{ value: 'auto', label: 'The display without the call app' }], 'auto', { label: 'Call screen display' })}`);
    }
    const opts = [{ value: 'auto', label: 'The display without the call app', note: 'Recommended' }, ...displays.map((d) => ({ value: d.id, label: d.name + (d.callApp ? ' · Call app is here' : '') }))];
    if (variant === 'absent') opts.push({ value: 'lg-old', label: 'LG UltraFine 5K (not connected)' });
    return comp('display-picker', { variant: variant === 'absent' ? 'remembered-absent' : 'several-displays', state: 'selected', cls: 'fr-dp' },
      html`<div class="fr-dp__draw" role="presentation">${displays.map((d) => html`<button type="button" class="fr-dp__screen${chosen === d.id ? ' is-sel' : ''}" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px" ${act('fr.display', { key, value: d.id })} aria-label="${d.name}">
        ${chosen === d.id ? html`<span class="fr-dp__check">${icon('check', { size: 11 })}</span>` : ''}<span class="fr-dp__name">${d.name}</span><span class="fr-dp__res np-tnum">${d.res}</span>${d.callApp ? html`<span class="fr-dp__callapp">Call app is here</span>` : ''}</button>`)}</div>
      ${P.radioGroup('dp-' + key, opts.map((x) => Object.assign({}, x, { label: x.label })), value, { label: 'Call screen display', action: ['fr.display', { key }] })}`);
  };

  /* ---------------- 53. Hotkey recorder ----------------
     hotkeyRecorder({id, label, keys, state, variant: single|modifier-set|derived, disabled}) */
  C.hotkeyRecorder = (o) => {
    o = o || {};
    const H = NP.local('hotkeys');
    const rec = H.recording === o.id;
    const keys = H[o.id] != null ? H[o.id] : o.keys;
    const err = H['err-' + o.id] || o.error;
    const variant = o.variant || 'single';
    const st = o.disabled ? 'disabled' : rec ? 'recording' : err ? (err.startsWith('Add') ? 'invalid' : 'conflict') : keys ? 'idle' : 'cleared';
    const field = variant === 'derived'
      ? html`<span class="hk-field is-ro">${keys ? P.kbd(keys) : ''}</span>`
      : html`<button type="button" class="hk-field${rec ? ' is-rec' : ''}" ${act('fr.hkRecord', { id: o.id })} ${o.disabled ? raw('disabled') : ''} aria-label="${o.label}: ${keys || 'none'}. Click to record a new shortcut">${rec ? html`<span class="np-dim">Type a shortcut…</span>` : keys ? P.kbd(keys) : html`<span class="np-dim">None</span>`}</button>`;
    return comp('hotkey-recorder', { variant, state: st, cls: 'hk-row' + (o.disabled ? ' is-disabled' : '') },
      html`<span class="hk-label">${o.label}</span>
      <span class="hk-ctl">${field}${variant === 'modifier-set' ? html`<span class="np-dim">+ 1, 2 or 3</span>` : ''}${keys && variant === 'single' && !o.disabled ? P.iconButton('x', { label: 'Clear shortcut', size: 'inline', action: ['fr.hkClear', { id: o.id }] }) : ''}</span>
      ${err && !rec ? html`<span class="hk-err">${icon('warning', { size: 12 })}${err}</span>` : ''}`);
  };

  /* ---------------- shared row fallbacks (used when group C / E modules are absent) ---------------- */
  NP.A = NP.A || {};
  NP.A.itemRow = (item, o) => {
    if (typeof C.actionItemRow === 'function') return C.actionItemRow(item, Object.assign({ variant: 'compact', key: 'today' }, o || {}));
    const p = D.person(item.owner);
    const done = item.status === 'done';
    const flash = NP.flashed('row-' + item.id);
    const meta = [item.due === 'Today' ? 'due today' : item.due ? item.due : null, item.owedToYou ? 'owed to you' : null, item.issue || null].filter(Boolean).join(' · ');
    const st = done ? 'ticked' : item.status === 'handed-off' ? 'handed-off' : item.review === 'suggested' ? 'suggested' : 'open';
    const L = NP.local('today');
    return html`${comp('action-item-row', { variant: 'compact', state: st, cls: 'td-row' + (done ? ' is-done' : ''), attrs: { lang: item.lang } },
      html`${P.checkbox('', done, { ariaLabel: 'Done: ' + item.text, action: ['today.tick', { id: item.id }], id: 'tick-' + item.id })}
      ${C.personChip(item.owner)}
      <span class="td-row__text" title="${item.text}">${item.text}</span>
      <span class="td-row__meta">${meta ? html`· ${meta}` : ''}${item.from ? html` · ${C.provenanceChip({ kind: 'past-call', label: item.from, callId: 'c-1on1-anna-9', span: item.span }, { variant: 'inline' })}` : ''}</span>
      ${item.review === 'suggested' && !done ? P.badge('Suggested', { kind: 'status', tone: 'info' }) : ''}
      ${item.status === 'handed-off' ? P.badge('Handed off · ' + ((item.handoff && item.handoff.state) || 'open'), { kind: 'status', tone: 'neutral' }) : ''}
      <span class="np-tb__spacer"></span>
      ${flash ? C.inlineStatus(flash, { variant: 'row-outcome', actionLabel: 'Undo', action: ['today.untick', { id: item.id }] }) : ''}
      ${item.engineering && item.owner === 'p-you' && !done ? P.button('Handoff', { size: 'small', action: ['item.handoff', { id: item.id }] }) : ''}
      ${P.iconButton('info', { label: 'Item inspector', size: 'inline', action: ['item.inspect', { id: item.id }], help: 'Show in Item inspector (⌘I)' })}`)}
      ${L.handoffAsk === item.id ? NP.A.handoffAsk(item) : ''}
      ${L.evidenceFailed === item.id ? html`<div class="td-rownote">${icon('warning', { size: 12 })}Evidence check failed: Jira not reachable</div>` : ''}`;
  };
  NP.A.handoffAsk = (item) => html`<div class="td-handoffask" role="group" aria-label="Did the handoff land?" data-state="open-handoff"><span>Did the handoff land?</span>${P.button('Yes, Landed', { size: 'small', variant: 'primary', action: ['today.handoffAnswer', { id: item.id, a: 'landed' }] })}${P.button('Done Another Way', { size: 'small', action: ['today.handoffAnswer', { id: item.id, a: 'other' }] })}${P.button('Keep Open', { size: 'small', variant: 'quiet', action: ['today.handoffAnswer', { id: item.id, a: 'keep' }] })}</div>`;
  NP.A.questionRow = (item) => {
    if (typeof C.outputItemRow === 'function') return C.outputItemRow(item, { variant: 'compact' });
    return comp('output-item-row', { variant: 'compact-question', state: 'open', cls: 'td-row td-row--q', attrs: { lang: item.lang } },
      html`<span class="td-row__qmark" aria-label="Open question">?</span><span class="td-row__text">${item.text}</span><span class="td-row__meta">${item.parked ? html`· parked on ${item.parked} ` : ''}${C.provenanceChip({ kind: 'past-call', label: item.span, callId: item.callId, span: item.span }, { variant: 'timestamp' })}</span>`);
  };
})();
