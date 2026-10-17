/* =====================================================================
   Group C — Screen — Dialogs, sheets and popovers
   (cpt-noter-component-screen-dialogs). Native alerts (AL), sheets (SH)
   and popovers (PO) of the main window, each listed in the harness
   "Dialogs" menu through NP.galleries.dialogs.
   ===================================================================== */
(function () {
  'use strict';
  const { html, raw, comp, icon, P, C, data: D } = NP;
  const DLG = 'cpt-noter-component-screen-dialogs';
  const S = () => NP.local('c-dialogs', {});
  const plural = NP.cItem.plural;

  /** Sheet content root: data-component="screen-dialogs" data-variant="<id>" */
  const sheet = (id, o) => html`<div data-component="${DLG}" data-variant="${id}" data-state="${o.state || 'open'}">
    <div class="np-sheet__head"><h2 class="np-sheet__title">${o.title}</h2>${o.sub ? html`<p class="np-sheet__sub">${o.sub}</p>` : ''}</div>
    <div class="np-sheet__body">${o.body || ''}</div>
    <div class="np-sheet__foot">${o.footLead || ''}<span class="np-tb__spacer"></span>${o.foot}</div></div>`;
  const cancel = () => P.button('Cancel', { action: ['sheet.close'] });
  const field = (label, ctl, note) => html`<label class="dlg-field"><span class="dlg-field__lab">${label}</span><span class="dlg-field__ctl">${ctl}${note ? html`<span class="dlg-field__note">${note}</span>` : ''}</span></label>`;
  const busy = (k) => !!NP.flashed('busy-' + k);
  const runBusy = (k, ms, then) => { NP.flash('busy-' + k, 'busy', ms); setTimeout(() => { then(); NP.render(); }, ms); };
  const alertBtns = (cancelLabel, okLabel, okAction, okArgs, destructive) => [
    { label: cancelLabel || 'Cancel', variant: 'primary', action: 'alert.close' },
    { label: okLabel, variant: destructive === false ? 'secondary' : 'destructive', action: okAction || 'dlg.alertDone', args: okArgs },
  ];

  /* ---------------- sheets ---------------- */
  NP.overlay('dlg-export', {
    width: 480, title: () => 'Export',
    render: (p) => {
      const s = S(); s.exp = s.exp || { summary: true, transcript: false, audio: false, step: 'choose' };
      if (s.exp.step === 'save') {
        return sheet('export', { title: 'Save', state: 'save-panel', sub: 'macOS save panel', body: html`${field('Save As', P.textField({ id: 'exp-name', value: 'Planning 16 Oct', ariaLabel: 'Save As' }))}${field('Where', P.popup(['Downloads', 'Documents', 'Desktop', 'Projects › noter-exports'], 'Downloads', { id: 'exp-where', label: 'Where' }))}`,
          foot: html`${P.button('Cancel', { action: ['dlg.expBack'] })}${P.button('Save', { variant: 'primary', action: ['dlg.expSave', { fk: p.fk }] })}` });
      }
      return sheet('export', {
        title: 'Export', sub: 'Scope: ' + (p.scope || 'Whole call'), state: busy('exp') ? 'busy' : 'open',
        body: html`<div class="dlg-checks">
          ${P.checkbox('Summary and items', s.exp.summary, { id: 'exp-sum', bind: 'local.c-dialogs.exp.summary' })}
          ${P.checkbox('Transcript', s.exp.transcript, { id: 'exp-tr', bind: 'local.c-dialogs.exp.transcript' })}
          ${P.checkbox('Audio', s.exp.audio, { id: 'exp-au', bind: 'local.c-dialogs.exp.audio' })}</div>
          <p class="np-dim">Writes a folder with Markdown files, the transcript as SRT and JSON, and the audio while it is kept.</p>`,
        foot: html`${cancel()}${P.button('Export…', { variant: 'primary', loading: busy('exp'), action: ['dlg.expGo'] })}`,
      });
    },
  });
  NP.overlay('dlg-export-log', {
    width: 480, title: () => 'Export Log',
    render: (p) => sheet('export-log', {
      title: 'Export Log', sub: 'Changes of ' + (p.scope || 'this call'),
      body: html`${field('Period', P.popup(p.scope && p.scope.startsWith('“') ? ['Whole call'] : ['Today', 'Last 7 days', 'Last 30 days', 'Custom…'], p.scope && p.scope.startsWith('“') ? 'Whole call' : 'Last 7 days', { id: 'log-period', label: 'Period' }))}
        ${field('Format', P.radioGroup('log-format', [{ value: 'md', label: 'Markdown', note: 'One line per change, for reading' }, { value: 'json', label: 'JSON', note: 'Every field, for scripts' }], S().logFormat || 'md', { bind: 'local.c-dialogs.logFormat', label: 'Format' }))}`,
      foot: html`${cancel()}${P.button('Export…', { variant: 'primary', action: ['dlg.done', { text: 'Exported log to Downloads/Noter log 16 Oct.' + ((S().logFormat || 'md') === 'json' ? 'json' : 'md') }] })}`,
    }),
  });
  NP.overlay('dlg-regenerate', {
    width: 520, title: () => 'Regenerate Outputs',
    render: (p) => {
      const s = S(); s.regen = s.regen || { summary: true, items: true, reviews: false };
      return sheet('regenerate-outputs', {
        title: 'Regenerate Outputs', state: busy('regen') ? 'busy' : 'open',
        body: html`${field('Runtime and model', P.popup(['Claude Code · Sonnet', 'Claude Code · Opus', 'Codex · gpt-5-codex', 'Local model · Qwen3 14B'], 'Claude Code · Sonnet', { id: 'rg-model', label: 'Runtime and model' }))}
          ${field('Skill', P.popup(['summary.md v3 (built-in)', 'summary-short.md v1', 'planning-call.md v2'], 'summary.md v3 (built-in)', { id: 'rg-skill', label: 'Skill' }))}
          ${field('Sections', html`<div class="dlg-checks">${P.checkbox('Summary', s.regen.summary, { id: 'rg-s', bind: 'local.c-dialogs.regen.summary' })}${P.checkbox('Decisions, action items and open questions', s.regen.items, { id: 'rg-i', bind: 'local.c-dialogs.regen.items' })}${P.checkbox('Role reviews', s.regen.reviews, { id: 'rg-r', bind: 'local.c-dialogs.regen.reviews' })}</div>`)}
          <p class="dlg-note">${icon('info', { size: 12 })}Your edits are kept and shown as a diff.</p>`,
        foot: html`${cancel()}${P.button('Regenerate', { variant: 'primary', loading: busy('regen'), action: ['dlg.regenGo'] })}`,
      });
    },
  });
  NP.overlay('dlg-delete-old-audio', {
    width: 480, title: () => 'Delete Old Audio',
    render: () => sheet('delete-old-audio', { title: 'Delete Old Audio', state: busy('olda') ? 'busy' : 'open',
      body: html`<p>Delete audio older than 30 days? Frees 6.2 GB. Transcripts and summaries stay.</p><p class="np-dim">Recording goes on while this runs.</p>`,
      foot: html`${cancel()}${P.button('Delete Audio', { variant: 'destructive', loading: busy('olda'), action: ['dlg.busyDone', { k: 'olda', text: 'Deleted audio of 14 calls · 6.2 GB freed' }] })}` }),
  });
  NP.overlay('dlg-voice', {
    width: 480, title: () => 'Set Up Voice Profile',
    render: (p) => sheet('set-up-voice-profile', { title: 'Set Up Voice Profile', sub: (D.person(p.personId || 'p-anna')).name,
      body: html`<p>A voice profile is encrypted, stays on this Mac and can be deleted at any time.</p><p class="np-dim">Noter builds it from the lines already named as ${D.person(p.personId || 'p-anna').short} in 31 calls.</p>`,
      foot: html`${cancel()}${P.button('Create Profile', { variant: 'primary', action: ['dlg.done', { text: 'Voice profile created for ' + D.person(p.personId || 'p-anna').short }] })}` }),
  });
  NP.overlay('dlg-brief', {
    width: 640, title: () => 'Export Improvement Brief',
    render: () => sheet('export-improvement-brief', { title: 'Export Improvement Brief',
      body: html`<div class="dlg-row2">${field('Period', P.popup(['Last 7 days', 'Last 30 days', 'This release'], 'Last 7 days', { id: 'br-period', label: 'Period' }))}${field('Metrics', html`<div class="dlg-checks">${P.checkbox('Card latency', true, { id: 'br-1' })}${P.checkbox('Retrieval stage', true, { id: 'br-2' })}${P.checkbox('Model stage', true, { id: 'br-3' })}</div>`)}</div>
        ${NP.c('promptEditor', { variant: 'read-only', key: 'brief', caption: 'improvement-brief-16-oct.md', value: '# Improvement brief · 9–16 Oct\n\nCard latency p95 is 10.8 s against a target of 10 s.\nRetrieval takes 1,350 ms against a budget of 800 ms (+69 %).\nModel takes 2,900 ms against 2,500 ms.\n\nSuggested first step: cache the embedding of the last 60 s of transcript between triggers.' })}`,
      foot: html`${P.button('Copy as Prompt', { flashKey: 'br-copy', action: ['proto.flash', { key: 'br-copy', text: 'Copied' }] })}${P.button('Save as Markdown…', { action: ['dlg.done', { text: 'Saved to Downloads/improvement-brief-16-oct.md' }] })}${P.button('Open in Codex', { action: ['dlg.done', { text: 'Opened Codex with the brief' }] })}${P.button('Open in Claude Code', { variant: 'primary', action: ['dlg.done', { text: 'Opened Claude Code with the brief' }] })}`,
      footLead: cancel() }),
  });
  NP.overlay('dlg-share-test', {
    width: 640, title: () => 'Screen Share Test',
    render: () => {
      const s = S(); const run = s.shareRun;
      const rows = [['Call window', 'Hidden', 'Hidden'], ['Record prompt', 'Hidden', 'Hidden'], ['Main window', 'Visible', 'Visible'], ['Menu bar extra', 'Visible', 'Visible']];
      return sheet('screen-share-test', { title: 'Screen Share Test', state: busy('share') ? 'busy' : run ? 'ran' : 'open',
        body: html`<h3 class="t-headline">What a share would show</h3>
          ${P.table({ variant: 'read-only', label: 'What a share would show' }, html`<thead><tr>${P.th('Surface')}${P.th('Window share')}${P.th('Whole display')}</tr></thead><tbody>${rows.map((r) => html`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[0] === 'Call window' || r[0] === 'Record prompt' ? html`<span class="dlg-warn">${icon('warning', { size: 11 })}May be visible</span>` : r[2]}</td></tr>`)}</tbody>`)}
          ${s.shareAsk ? html`<div class="dlg-perm" data-component="cpt-noter-component-ui-status-row" data-state="asking">${icon('display', { size: 13 })}<span>Screen Recording · needed for this test only</span><span class="np-tb__spacer"></span>${P.button('Continue', { size: 'small', variant: 'primary', action: ['dlg.sharePermOk'] })}</div>` : ''}
          ${run ? html`<div class="dlg-capture"><div><div class="dlg-capture__h">On your screen</div><div class="dlg-capture__img">${icon('display', { size: 40 })}<span>Call window, main window</span></div></div><div><div class="dlg-capture__h">What the share sees</div><div class="dlg-capture__img">${icon('display', { size: 40 })}<span>Main window only</span></div></div></div>
            ${C.inlineStatus('Call window and record prompt hidden from window shares', { variant: 'trailing' })}` : ''}
          ${C.inlineBanner({ severity: 'info', dismissible: false, text: 'Hidden from Teams, Meet and window-filtered Zoom shares only. A whole-display share may show every window. Share a window, not a display, or press ⌃⌥⌘0 to hide Noter.' })}`,
        footLead: P.button(run ? 'Run Again' : 'Run Capture Test', { loading: busy('share'), action: ['dlg.shareRun'] }),
        foot: P.button('Done', { variant: 'primary', action: ['sheet.close'] }) });
    },
  });
  NP.overlay('dlg-mcp', {
    width: 560, title: () => 'Add MCP Server',
    render: () => sheet('add-mcp-server', { title: 'Add MCP Server',
      body: html`${field('Server', P.popup(['Confluence (Atlassian)', 'Google Drive', 'Notion', 'GitHub', 'Custom…'], 'Confluence (Atlassian)', { id: 'mcp-server', label: 'Server' }))}
        ${field('Mode', P.radioGroup('mcp-mode', [{ value: 'live', label: 'Live', note: 'Looked up after calls and in Ask; nothing is copied. Runs only in Cloud allowed, and each lookup is logged in Privacy' }, { value: 'indexed', label: 'Indexed', note: 'Copied into the local index; sign-in opens in your browser' }], S().mcpMode || 'indexed', { bind: 'local.c-dialogs.mcpMode', label: 'Mode' }))}
        ${field('Schedule', P.popup(['Every 6 hours', 'Every hour', 'Daily', 'Only by hand'], 'Every 6 hours', { id: 'mcp-sched', label: 'Schedule' }))}
        ${field('Privacy class', P.popup(['Normal', 'Sensitive'], 'Normal', { id: 'mcp-priv', label: 'Privacy class' }), 'Sensitive sources are answered by the local model only')}
        ${field('Scope', P.textField({ id: 'mcp-scope', value: 'DEV space', ariaLabel: 'Scope' }))}`,
      foot: html`${cancel()}${P.button('Add Source', { variant: 'primary', action: ['dlg.done', { text: 'Added Confluence · DEV space; first sync running' }] })}` }),
  });
  NP.overlay('dlg-mapping', {
    width: 520, title: () => 'Add Mapping',
    render: (p) => sheet('add-mapping', { title: 'Add Mapping', sub: p.key ? 'From the Handoff drawer' : '',
      body: html`${field('Jira project or component', P.textField({ id: 'map-key', value: p.key || '', placeholder: 'VSTOR · frontend', ariaLabel: 'Jira project or component' }))}
        ${field('Folder', html`<span class="dlg-inline">${P.textField({ id: 'map-folder', value: '~/projects/vhi-frontend', readonly: true, ariaLabel: 'Folder', mono: true })}${P.button('Choose…', { action: ['proto.flash', { key: 'proto', text: 'macOS open panel' }] })}</span>`)}
        ${field('Default tool', P.segmented(['Claude Code', 'Codex'], 'Claude Code', { variant: 'option', label: 'Default tool' }))}`,
      foot: html`${cancel()}${P.button('Add Mapping', { variant: 'primary', action: ['dlg.mapDone'] })}` }),
  });
  NP.overlay('dlg-api-key', {
    width: 480, title: () => 'API Key',
    render: () => {
      const s = S(); const st = s.key || 'idle';
      return sheet('api-key', { title: 'Replace Anthropic API Key', state: st,
        body: html`${field('API key', P.textField({ variant: 'secure', id: 'key-v', value: 'sk-ant-api03-xxxxxxxxxxxx', ariaLabel: 'API key', invalid: st === 'invalid', message: 'Anthropic rejected this key (invalid key)' }), 'Paste works; the key goes to the Keychain only')}
          ${st === 'locked' ? C.inlineBanner({ severity: 'error', text: 'Keychain is locked', actions: [{ label: 'Try Again', action: ['dlg.key', { v: 'idle' }] }] }) : ''}
          ${st === 'ok' ? C.inlineStatus('Verified · Claude Code can use this key', { variant: 'trailing' }) : ''}
          <div class="dlg-inline">${P.button('Verify', { loading: busy('key'), action: ['dlg.keyVerify'] })}<span class="np-dim">Demo:</span>${P.link('Rejected key', { action: ['dlg.key', { v: 'invalid' }] })}${P.link('Keychain locked', { action: ['dlg.key', { v: 'locked' }] })}</div>`,
        foot: html`${cancel()}${P.button('Save', { variant: 'primary', disabled: st !== 'ok', action: ['dlg.done', { text: '••••••••  Stored in the Keychain' }] })}` });
    },
  });
  NP.overlay('dlg-selftest', {
    width: 560, title: () => 'Audio Self-Test',
    render: () => sheet('run-audio-self-test', { title: 'Run Audio Self-Test',
      sub: 'Plays a short clip and listens to your microphone and system audio. Any sound playing in another app also works.',
      body: NP.c('selfTestPanel', { variant: 'sheet', state: S().selftest || 'idle' }),
      foot: html`${cancel()}${P.button('Done', { variant: 'primary', action: ['dlg.selfTestDone'] })}` }),
  });

  /* ---------------- popovers ---------------- */
  NP.overlay('dlg-due', {
    width: 280,
    render: (p) => {
      const days = Array.from({ length: 31 }, (_, i) => i + 1);
      return html`<div class="np-pop__body" data-component="${DLG}" data-variant="due-date" data-state="open">
        <div class="np-pop__title">October 2026</div>
        <div class="dlg-cal" role="grid" aria-label="October 2026">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => html`<span class="dlg-cal__h">${d}</span>`)}${raw('<span></span><span></span><span></span>')}${days.map((d) => html`<button type="button" class="dlg-cal__d${d === 16 ? ' is-today' : ''}${d === 17 ? ' is-sel' : ''}" ${NP.act('dlg.duePick', { d, itemId: p.itemId })}>${d}</button>`)}</div></div>`;
    },
  });

  /* ---------------- actions ---------------- */
  const doneFlash = (text) => { NP.state.sheet = null; NP.state.popover = null; NP.flash('proto', text, 2600); };
  NP.onMany({
    'dlg.openSheet': (a) => { NP.state.popover = null; NP.openSheet(a.id, a.props || {}); return false; },
    'dlg.done': (a) => doneFlash(a.text || 'Done'),
    'dlg.popDone': (a) => doneFlash(a.text || 'Done'),
    'dlg.alertDone': (a) => { NP.state.alert = null; if (a && a.text) NP.flash('proto', a.text, 2600); },
    'dlg.busyDone': (a) => { runBusy(a.k, 900, () => doneFlash(a.text)); },
    'dlg.export': (a) => { S().exp = null; NP.openSheet('dlg-export', a || {}); return false; },
    'dlg.expGo': () => { runBusy('exp', 700, () => { S().exp.step = 'save'; }); },
    'dlg.expBack': () => { S().exp.step = 'choose'; },
    'dlg.expSave': (a) => { NP.state.sheet = null; NP.flash((a.fk || 'share-pc-toolbar') + '-export', 'Exported to Downloads/Planning 16 Oct', 8000); },
    'dlg.exportLog': (a) => { NP.openSheet('dlg-export-log', a || {}); return false; },
    'dlg.regenerate': (a) => { NP.openSheet('dlg-regenerate', a || {}); return false; },
    'dlg.regenGo': () => { runBusy('regen', 900, () => { NP.state.sheet = null; const l = NP.local('call-page'); l.regenerating = true; setTimeout(() => { l.regenerating = false; NP.state.demo['call-page'] = 'regenerated'; NP.render(); }, 1400); }); },
    'dlg.addMapping': (a) => { NP.openSheet('dlg-mapping', a || {}); return false; },
    'dlg.mapDone': () => { NP.state.sheet = null; const H = NP.local('c-handoff', {}); Object.values(H).forEach((h) => { h.noMapping = false; }); NP.flash('proto', 'Added mapping VSTOR · frontend → ~/projects/vhi-frontend', 2600); },
    'dlg.shareRun': () => { if (!S().sharePerm) { S().shareAsk = true; return; } runBusy('share', 1100, () => { S().shareRun = true; }); },
    'dlg.sharePermOk': () => { const s = S(); s.shareAsk = false; s.sharePerm = true; runBusy('share', 1100, () => { s.shareRun = true; }); },
    'dlg.key': (a) => { S().key = a.v; },
    'dlg.keyVerify': () => { runBusy('key', 900, () => { S().key = 'ok'; }); },
    'dialogs.selfTest': () => { S().selftest = 'idle'; NP.openSheet('dlg-selftest', {}); return false; },
    'dlg.selfTestDone': () => { NP.state.sheet = null; },
    'dlg.duePopover': (a) => { NP.state.popover = { id: 'dlg-due', anchor: a.anchor, props: a }; NP.state.menu = null; },
    'dlg.duePick': (a) => { const it = a.itemId && D.item(a.itemId); if (it) { it.due = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(2026, 9, a.d).getDay()] + ' ' + a.d + ' Oct'; const st = NP.local('c-inspector')[it.id]; if (st) st.draft.due = it.due; } NP.state.popover = null; },
    // alerts (native, irreversible actions only)
    'dlg.deleteCall': (a) => { const c = D.call(a.callId || 'c-live'); NP.openAlert({ title: `Delete “${c.title}”?`, body: 'This removes its audio, transcript, summary, items and cards. You can’t undo this.', variant: 'destructive', buttons: alertBtns('Cancel', 'Delete', 'dlg.deleteCallGo', { callId: c.id }) }); return false; },
    'dlg.deleteCallGo': (a) => { NP.state.alert = null; const c = D.call(a.callId); NP.go('library', { view: 'calls' }); NP.flash('proto', `Deleted “${c.title}” (the prototype keeps its sample data)`, 3000); return false; },
    'dlg.deleteAudio': (a) => { NP.openAlert({ title: 'Delete the audio of this call?', body: 'The transcript, summary and items stay. Replay stops working for this call. You can’t undo this.', variant: 'destructive', buttons: alertBtns('Cancel', 'Delete Audio', 'dlg.deleteAudioGo', a) }); return false; },
    'dlg.deleteAudioGo': (a) => { NP.state.alert = null; const l = NP.local('call-page'); l.audioDeleted = l.audioDeleted || {}; l.audioDeleted[a.callId || 'c-live'] = true; NP.flash('proto', 'Audio deleted · transcript kept', 2600); },
  });

  const alertOf = (title, body, cancelLabel, okLabel, destructive, text) => () => NP.openAlert({ title, body, variant: destructive === false ? 'warning' : 'destructive', buttons: alertBtns(cancelLabel, okLabel, 'dlg.alertDone', { text: text || okLabel + ' · done' }, destructive) });
  NP.galleries.dialogs = (NP.galleries.dialogs || []).concat([
    { id: 'al-quit', label: 'Alert · Quit while recording', surface: 'main', open: alertOf('Noter is recording “Planning: VHI 8.0 drawer redesign”', 'Quitting stops the recording. The transcript so far is kept.', 'Cancel', 'Stop and Quit', false, 'Stopped and quit') },
    { id: 'al-del-call', label: 'Alert · Delete Call…', surface: 'main', open: () => NP.actions['dlg.deleteCall']({ callId: 'c-live' }) },
    { id: 'al-del-3', label: 'Alert · Delete 3 calls', surface: 'main', open: alertOf('Delete 3 calls?', 'This removes their audio, transcripts, summaries, items and cards. You can’t undo this.', 'Cancel', 'Delete 3 Calls', true, 'Deleted 3 calls') },
    { id: 'al-del-person', label: 'Alert · Delete Person…', surface: 'main', open: () => NP.actions['ppl.deleteAsk']({ id: 'p-anna' }) },
    { id: 'al-del-profile', label: 'Alert · Delete Profile…', surface: 'main', open: () => NP.actions['ppl.deleteVoice']({ id: 'p-anna' }) },
    { id: 'al-del-audio', label: 'Alert · Delete Audio Now…', surface: 'main', open: () => NP.actions['dlg.deleteAudio']({ callId: 'c-live' }) },
    { id: 'al-remove-source', label: 'Alert · Remove Source…', surface: 'main', open: alertOf('Remove “Confluence · DEV space”?', 'Its 1,180 indexed pages leave search and answers. Nothing in Confluence changes.', 'Cancel', 'Remove', true) },
    { id: 'al-revoke', label: 'Alert · Revoke Token…', surface: 'main', open: alertOf('Revoke Noter’s access to Confluence?', 'Syncing stops until you sign in again.', 'Cancel', 'Revoke', false) },
    { id: 'al-remove-agent', label: 'Alert · Remove Agent…', surface: 'main', open: alertOf('Remove “Security reviewer”?', 'Its skill file moves to the Trash. Past cards and reviews keep its name.', 'Cancel', 'Remove', true) },
    { id: 'sh-export', label: 'Sheet · Export…', surface: 'main', open: () => NP.actions['dlg.export']({ scope: 'Whole call', fk: 'share-pc-toolbar' }) },
    { id: 'sh-export-log', label: 'Sheet · Export Log…', surface: 'main', open: () => NP.openSheet('dlg-export-log', { scope: 'Activity, last 7 days' }) },
    { id: 'sh-regen', label: 'Sheet · Regenerate Outputs…', surface: 'main', open: () => NP.openSheet('dlg-regenerate', { callId: 'c-live' }) },
    { id: 'sh-old-audio', label: 'Sheet · Delete Old Audio…', surface: 'main', open: () => NP.openSheet('dlg-delete-old-audio', {}) },
    { id: 'sh-voice', label: 'Sheet · Set Up Voice Profile…', surface: 'main', open: () => NP.openSheet('dlg-voice', { personId: 'p-anna' }) },
    { id: 'sh-details', label: 'Sheet · Edit Details…', surface: 'main', open: () => NP.actions['ppl.edit']({ id: 'p-pavel' }) },
    { id: 'sh-merge-people', label: 'Sheet · Merge With… (people)', surface: 'main', open: () => NP.actions['ppl.mergeSheet']({ from: 'p-anna' }) },
    { id: 'sh-merge-topic', label: 'Sheet · Merge With… (topic)', surface: 'main', open: () => NP.actions['lib.mergeSheet']({ from: 't-ws', to: 't-notif' }) },
    { id: 'sh-brief', label: 'Sheet · Export Improvement Brief…', surface: 'main', open: () => NP.openSheet('dlg-brief', {}) },
    { id: 'sh-share-test', label: 'Sheet · Screen Share Test…', surface: 'main', open: () => { S().shareRun = false; S().shareAsk = false; if (NP.surfaces.settings) NP.state.surface = 'settings'; NP.openSheet('dlg-share-test', {}); } },
    { id: 'sh-mcp', label: 'Sheet · Add MCP Server…', surface: 'main', open: () => NP.openSheet('dlg-mcp', {}) },
    { id: 'sh-mapping', label: 'Sheet · Add Mapping…', surface: 'main', open: () => NP.openSheet('dlg-mapping', {}) },
    { id: 'sh-key', label: 'Sheet · Replace API key…', surface: 'main', open: () => { S().key = 'idle'; NP.openSheet('dlg-api-key', {}); } },
    { id: 'sh-selftest', label: 'Sheet · Run Audio Self-Test…', surface: 'main', open: () => NP.actions['dialogs.selfTest']() },
    { id: 'po-topic', label: 'Popover · Rename… (topic)', surface: 'main', open: () => NP.actions['lib.renamePop']({ id: 't-ws', anchor: 'gallery' }) },
    { id: 'po-tag', label: 'Popover · Add Tag…', surface: 'main', open: () => NP.actions['lib.addTagPop']({ ids: ['c-live', 'c-backend', 'c-design'], anchor: 'gallery' }) },
    { id: 'po-due', label: 'Popover · Due date', surface: 'main', open: () => { NP.state.popover = { id: 'dlg-due', anchor: 'gallery', props: {} }; } },
  ]);
})();
