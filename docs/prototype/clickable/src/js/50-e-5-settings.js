/* =====================================================================
   Group E — Screen — Settings window (cpt-noter-component-screen-settings)
   Separate window, 820 × 620 default. ST-R1 pane list with search,
   ST-R3 banner slot, ST-R2 pane (grouped inset form, at most 560 wide).
   Pane order follows DESIGN (it differs from NP.data.settingsPanes).
   ===================================================================== */
(function () {
  const { html, raw, act, comp, icon, P, C, data: D, state } = NP;

  const PANES = [
    { id: 'general', label: 'General', icon: 'gear', keys: 'launch login record notifications apps language storage calendars horizon ranking setup' },
    { id: 'audio', label: 'Audio & Transcription', icon: 'mic', keys: 'microphone output headphones speakers echo transcription archive languages glossary permission self-test models whisper' },
    { id: 'models', label: 'Models & Runtimes', icon: 'agent', keys: 'api key anthropic codex claude chatgpt account sign in login ollama local runtime spend' },
    { id: 'privacy', label: 'Privacy', icon: 'lock', keys: 'privacy mode redaction retention audio calendar talk-time silent voice profiles left mac audit share screen test zoom teams' },
    { id: 'callscreen', label: 'Call Screen & Menu Bar', icon: 'display', keys: 'display layout floating automatically latency text size menu bar title quick actions zoom' },
    { id: 'hotkeys', label: 'Hotkeys', icon: 'keyboard', keys: 'shortcut hotkey card keys pin dismiss undo restore' },
    { id: 'repositories', label: 'Repositories', icon: 'branch', keys: 'repository jira mapping folder tool handoff launch' },
    { id: 'knowledge', label: 'Knowledge Sources', icon: 'books', keys: 'source folder mcp confluence index sync' },
    { id: 'maintenance', label: 'Maintenance', icon: 'wand', keys: 'nightly battery backups jobs evidence bitbucket jira github' },
    { id: 'performance', label: 'Performance', icon: 'gauge', keys: 'stages sampled metrics thresholds bottleneck' },
    { id: 'updates', label: 'Updates', icon: 'download', keys: 'version channel beta install check' },
  ];
  D.settingsPanesDesign = PANES;
  const ALIAS = { recording: 'audio', people: 'privacy', advanced: 'updates' };
  const paneId = () => { let p = state.settingsPane || 'general'; p = ALIAS[p] || p; return PANES.some((x) => x.id === p) ? p : 'general'; };
  const ST = () => NP.eloc('settings', { search: '', sources: null, repos: null, glossary: null, privacyMode: 'redacted', retention: '30 days', talk: false, launch: true, offer: true, autoOpen: true, latency: false, textSize: 100, layout: 'Automatic', mbTitle: 'None', cardKeys: true, dismissKeys: false, battery: false, backups: 7, channel: 'Stable', install: 'auto', personal: false });

  /* form helpers (grouped inset form; label 40 %, control right) */
  const row = (label, control, note, o) => html`<div class="st-row${o && o.stack ? ' is-stack' : ''}"><div class="st-row__label">${label}</div><div class="st-row__ctl">${control}${note ? html`<div class="st-row__note">${note}</div>` : ''}</div></div>`;
  const group = (title, rows, o) => html`<section class="st-group"${raw(o && o.id ? ` id="${o.id}"` : '')}>${title ? html`<h3 class="st-group__h">${title}</h3>` : ''}<div class="st-group__box">${rows}</div>${o && o.foot ? html`<div class="st-group__foot">${o.foot}</div>` : ''}</section>`;
  const demo = () => NP.demo('settings');

  /* ---------------- panes ---------------- */
  const general = () => {
    const s = ST();
    const selfOk = state.setup.selfTestPassed !== false && demo() !== 'self-test';
    return html`
      ${group('', html`
        ${row('Launch at login', P.toggle('', s.launch, { id: 'st-launch', ariaLabel: 'Launch at login', bind: 'local.settings.launch' }))}
        ${row('Offer to record when a call starts', P.toggle('', selfOk && s.offer, { id: 'st-offer', ariaLabel: 'Offer to record when a call starts', disabled: !selfOk, bind: 'local.settings.offer' }),
          selfOk ? 'Noter always asks with the record prompt; it never records on its own.' : html`<span class="st-warnline">${icon('warning', { size: 12 })} Needs a passed audio self-test</span> ${P.button('Run Audio Self-Test…', { size: 'small', action: ['st.selfTest'] })}`)}
        ${demo() === 'notifications-off' ? row('Notifications', html`<span class="st-warnline">${icon('info', { size: 12 })} Notifications are off for Noter</span>`, html`${P.button('Open System Settings…', { size: 'small', action: ['proto.flash', { key: 'proto', text: 'Opens System Settings › Notifications › Noter' }] })} The menu bar still offers Open Last Summary.`) : ''}
      `)}
      ${group('Apps Noter doesn’t ask about', s.appsRemoved ? html`<div class="st-empty">${C.emptyState({ variant: 'section', title: 'Noter offers to record calls in every app.' })}</div>` : html`<div class="st-applist"><span class="st-app">${icon('globe', { size: 15 })} Safari</span><span class="np-dim">Calls in this app aren’t offered for recording.</span><span class="np-tb__spacer"></span>${P.button('Remove', { size: 'small', action: ['st.set', { k: 'appsRemoved', v: true }] })}</div>`)}
      ${group('Outputs and storage', html`
        ${row('Summary language', P.popup(['English', 'Russian', 'German', 'Language of the call'], 'English', { id: 'st-sumlang', label: 'Summary language' }), 'Applies to outputs written from now on.')}
        ${row('Storage location', html`<span class="st-path np-mono" title="${demo() === 'icloud' ? '~/Library/Mobile Documents/com~apple~CloudDocs/Noter' : '~/Library/Application Support/Noter'}">${demo() === 'icloud' ? '~/Library/Mobile Documents/…/Noter' : '~/Library/Application Support/Noter'}</span>${P.button('Change…', { size: 'small', action: ['proto.flash', { key: 'proto', text: 'macOS open panel for a folder' }] })}`,
          demo() === 'icloud' ? html`<span class="st-warnline">${icon('warning', { size: 12 })} This folder is in iCloud Drive, so your recordings sync off this Mac. Choose a local folder.</span>` : '')}
      `)}
      ${group('Today', html`
        ${row('Calendars shown', html`<div class="st-checks">${P.checkbox('Work', true, { id: 'st-cal-work' })}${P.checkbox('Virtuozzo shared', true, { id: 'st-cal-vz' })}${P.checkbox('Family', false, { id: 'st-cal-fam' })}</div>`)}
        ${row('Horizon', P.segmented(['Today', 'This Week'], s.horizon || 'This Week', { variant: 'option', label: 'Horizon', action: ['st.seg', { k: 'horizon' }] }))}
        ${row('Ranking', P.popup(['Due date, then owed to you', 'Owed to you first', 'Call order only'], 'Due date, then owed to you', { id: 'st-rank', label: 'Ranking' }))}
      `)}
      ${group('', row('Setup', P.button('Run Setup Again…', { action: ['st.firstRun'] }), 'Opens the first-run wizard. Your library and settings stay.'))}`;
  };

  const audio = () => {
    const s = ST();
    const downloading = demo() === 'model-downloading';
    const permRows = [{ id: 'mic', label: 'Microphone', status: 'granted', detail: 'MacBook Pro Microphone' }, { id: 'sys', label: 'System audio recording', status: 'granted' }];
    return html`
      ${group('Input and output', html`
        ${row('Microphone', html`<div class="st-inline">${P.popup(['MacBook Pro Microphone', 'AirPods Pro', 'Shure MV7'], 'MacBook Pro Microphone', { id: 'st-mic', label: 'Microphone' })}${P.levelMeter({ level: 5, label: 'Microphone level' })}</div>`)}
        ${row('Output', P.radioGroup('st-out', [{ value: 'auto', label: 'Detect automatically' }, { value: 'hp', label: 'Headphones' }, { value: 'sp', label: 'Speakers, with echo cancellation' }], s.output || 'auto', { bind: 'local.settings.output', label: 'Output' }))}
        ${row('', P.checkbox('Exclude Noter’s own sounds', s.exclude !== false, { id: 'st-excl', bind: 'local.settings.exclude' }), 'Replay while recording needs a headphone route and this setting.')}
      `)}
      ${group('Transcription', html`
        ${row('Live transcription', P.popup(['WhisperKit Large v3 Turbo', 'Parakeet TDT v3', 'WhisperKit Pro (licensed)'], 'WhisperKit Large v3 Turbo', { id: 'st-live', label: 'Live transcription' }), 'Applies from the next call.')}
        ${row('Archive pass', P.popup(['Large v3', 'Off'], 'Large v3', { id: 'st-arch', label: 'Archive pass' }))}
        ${row('Languages', html`<div class="st-checks">${P.checkbox('English', true, { id: 'st-l-en' })}${P.checkbox('Russian', true, { id: 'st-l-ru' })}${P.checkbox('German', true, { id: 'st-l-de' })}</div>`)}
      `)}
      ${group('Glossary', P.table({ variant: 'sortable', label: 'Glossary' }, html`<thead><tr>${P.th('Term')}${P.th('Latin variants')}${P.th('Cyrillic variants')}${P.th('Spoken forms')}</tr></thead><tbody>
          <tr><td>ostor</td><td>o-store, O-Store</td><td lang="ru">остор</td><td>oh store</td></tr>
          <tr><td>shaman</td><td>sharman</td><td lang="ru">шаман</td><td>sha man</td></tr>
          <tr><td>VSTOR</td><td>v-store</td><td lang="ru">встор</td><td>vee store</td></tr></tbody>`),
        { foot: html`${P.iconButton('plus', { label: 'Add Term', size: 'inline', action: ['proto.flash', { key: 'proto', text: 'Adds a glossary row; Activity then proposes applying it to older transcripts' }] })}${P.iconButton('minus', { label: 'Remove Term', size: 'inline', action: ['proto.noop'] })}<span class="np-dim">A new term leads to proposals in Activity.</span>` })}
      ${group('Permissions', html`${permRows.map((r) => NP.c('permissionCheckRow', r, { variant: 'status' }))}
        ${row('Audio self-test', P.button('Run Audio Self-Test…', { action: ['st.selfTest'] }), 'With Exclude Noter’s own sounds on, the test also checks that Noter’s own sounds stay out.')}`)}
      ${group('Models', html`
        ${C.statusRow({ id: 'm-turbo', name: 'WhisperKit Large v3 Turbo', status: downloading ? 'running' : 'ok', statusWord: downloading ? 'Updating' : 'Downloaded', subtitle: '1.6 GB · live transcription', progressText: 'Downloading 1.1 of 1.6 GB · 68 %' }, { variant: 'model' })}
        ${C.statusRow({ id: 'm-large', name: 'WhisperKit Large v3', status: 'ok', statusWord: 'Downloaded', subtitle: '3.1 GB · archive pass' }, { variant: 'model' })}
        ${C.statusRow({ id: 'm-diar', name: 'Speaker diarization', status: 'ok', statusWord: 'Previous version kept', subtitle: '120 MB · version 2.3, 2.2 kept' }, { variant: 'model' })}`)}`;
  };

  const models = () => {
    const s = ST();
    const rejected = demo() === 'key-rejected';
    const localNot = demo() === 'local-not-ready';
    return html`
      ${group('API keys', html`
        ${C.credentialRow({ id: 'anthropic', name: 'Anthropic API key', use: 'Claude Code for the live copilot, summaries and Ask', state: rejected ? 'rejected' : 'configured', reason: 'Anthropic rejected this key (invalid key)' }, { locked: demo() === 'keychain-locked' })}
        ${C.credentialRow({ id: 'codex', name: 'Codex API key', use: 'Codex for role reviews and handoffs; optional', state: 'not-set' }, { locked: demo() === 'keychain-locked' })}`)}
      ${group('Your own accounts', html`${C.accountRow('claude')}${C.accountRow('chatgpt')}`, { foot: html`<span class="np-dim">Add either account, or both. Noter never sees your password: Claude Code and Codex keep the sign-in in your Keychain.</span>` })}
      ${group('Local runtime', localNot
        ? C.statusRow({ id: 'rt-ollama', name: 'Qwen3 8B not downloaded (5.2 GB)', status: 'stale', statusWord: 'Not ready', subtitle: 'Ollama 0.6 detected', message: 'Without it, calls get no summary when you’re offline.', actions: [{ label: 'Download', action: ['st.retry', { id: 'rt-ollama', ms: 2200 }] }] }, { variant: 'runtime' })
        : C.statusRow({ id: 'rt-ollama2', name: 'Ollama detected · Qwen3 8B ready', status: 'ok', subtitle: 'Local fallback for every task · last used today 08:12' }, { variant: 'runtime' }))}
      ${group('Runtime per task', P.table({ variant: 'sortable', label: 'Runtime per task' }, html`<thead><tr>${P.th('Task')}${P.th('Runtime')}</tr></thead><tbody>
        ${[['Live copilot', 'claude-key'], ['Post-call analysis', 'claude-key'], ['Search answers', 'local']].map((r, i) => html`<tr><td>${r[0]}</td><td>${P.popup(NP.auth.RUNTIMES.map((x) => ({ value: x.id, label: x.label + (NP.auth.available(x.id) ? '' : ' — not connected'), disabled: !NP.auth.available(x.id) && x.id !== r[1] })), r[1], { id: 'st-rt-' + i, label: 'Runtime for ' + r[0], variant: 'inline' })}</td></tr>`)}</tbody>`))}
      ${group('Spend this week', html`<dl class="np-kv st-kv"><dt>Claude Code</dt><dd class="np-tnum">$4.12</dd><dt>Codex</dt><dd class="np-tnum">$1.06</dd><dt>Local share</dt><dd class="np-tnum">18 %</dd></dl>`, { foot: P.link('Show in Performance', { action: ['st.toMain', { screen: 'performance' }] }) })}`;
  };

  const privacy = () => {
    const s = ST();
    const modeWord = { redacted: 'Cloud, redacted', cloud: 'Cloud', local: 'Local only' }[s.privacyMode];
    const calStatus = demo() === 'calendar-off' ? (s.calAsked ? 'denied' : 'not-asked') : 'granted';
    const audit = demo() === 'nothing-left' ? [] : D.audit;
    return html`
      ${group('', html`
        ${row('Privacy mode', html`${P.radioGroup('st-pmode', [{ value: 'redacted', label: 'Cloud with redaction', note: 'Names and PII are replaced before anything leaves this Mac' }, { value: 'cloud', label: 'Cloud allowed', note: 'Text goes as is' }, { value: 'local', label: 'Local only', note: 'Every task runs on the local runtime' }], s.privacyMode, { bind: 'local.settings.privacyMode', label: 'Privacy mode' })}<div class="st-modenow">In force: ${C.modeIndicator({ variant: 'settings', mode: modeWord })}</div>`)}
        ${row('Audio retention', P.popup(['7 days', '30 days', '90 days', 'Forever', 'Never store audio'], s.retention, { id: 'st-ret', label: 'Audio retention', bind: 'local.settings.retention' }))}
        ${NP.c('permissionCheckRow', { id: 'cal', label: 'Calendar', status: calStatus, detail: 'Work, Virtuozzo shared' }, { variant: 'status' })}
        ${calStatus === 'not-asked' ? row('', html`${P.button('Allow Calendar Access', { size: 'small', action: ['st.set', { k: 'calAsked', v: true }] })}<span class="np-dim">The macOS prompt follows. Noter never asks during a recording.</span>`) : ''}
        ${row('Show talk-time share and “who was silent”', P.toggle('', s.talk, { id: 'st-talk', ariaLabel: 'Show talk-time share and who was silent', bind: 'local.settings.talk' }), 'Off by default. These rows don’t exist anywhere until you turn this on.')}
        ${row('Voice profiles', html`<span>2 people</span>${P.button('Manage on Person Pages', { size: 'small', action: ['st.toMain', { screen: 'people' }] })}`)}
      `)}
      ${group('What left this Mac', html`<div class="st-audit-bar">${P.popup(['All calls', 'Planning: VHI 8.0 drawer redesign', 'Backend sync'], 'All calls', { id: 'st-audit-call', label: 'Call' })}<span class="np-tb__spacer"></span>${P.button('Export…', { size: 'small', action: ['proto.flash', { key: 'proto', text: 'Save panel · “What left this Mac 16 Oct.csv”' }] })}</div>
        ${audit.length ? P.table({ variant: 'sortable', label: 'What left this Mac' }, html`<thead><tr>${P.th('Time')}${P.th('What')}${P.th('Size')}${P.th('Destination')}</tr></thead><tbody>${audit.map((a) => html`<tr><td class="np-tnum">${a.at}</td><td>${a.what}</td><td class="np-tnum">${a.bytes}</td><td>${/Jira/.test(a.what) ? 'Jira' : 'Claude Code'}</td></tr>`)}</tbody>`) : C.emptyState({ variant: 'section', title: 'Nothing has left this Mac.' })}`,
        { foot: html`<span class="np-tb__spacer"></span>${P.button('Screen Share Test…', { action: ['st.shareTest'] })}` })}`;
  };

  const callscreen = () => {
    const s = ST();
    const dpVariant = demo() === 'display-absent' ? 'absent' : demo() === 'one-display' ? 'one' : 'several';
    return html`
      ${group('Call screen', html`
        ${row('Call screen display', NP.c('displayPicker', { value: 'auto', variant: dpVariant, key: 'settings' }), null, { stack: true })}
        ${row('Layout', P.popup(['Automatic', 'Always floating'], s.layout, { id: 'st-layout', label: 'Layout', bind: 'local.settings.layout' }))}
        ${row('Open the call screen automatically', P.toggle('', s.autoOpen, { id: 'st-autoopen', ariaLabel: 'Open the call screen automatically', bind: 'local.settings.autoOpen' }), 'Opens the call window when recording starts, and moves it to a display that connects during the call.')}
        ${row('Show latency', P.toggle('', s.latency, { id: 'st-latency', ariaLabel: 'Show latency', bind: 'local.settings.latency' }))}
        ${row('Text size', P.slider({ id: 'st-textsize', value: s.textSize, min: 85, max: 150, step: 5, unit: '%', label: 'Text size', action: ['st.num', { k: 'textSize' }] }))}
      `)}
      ${group('Menu bar', html`
        ${row('Menu bar title', P.popup(['None', 'Elapsed Time', 'Newest Card'], s.mbTitle, { id: 'st-mbtitle', label: 'Menu bar title', bind: 'local.settings.mbTitle' }), 'Up to 24 characters, next to the Noter icon.')}
        ${row('Quick actions', html`<div class="st-checks">${['Pause', 'Mark Moment', 'Catch Me Up', 'Mute Copilot', 'Open Last Summary'].map((q, i) => P.checkbox(q, i !== 2, { id: 'st-qa-' + i }))}</div>`)}
      `)}`;
  };

  const hotkeys = () => {
    const s = ST();
    const d = demo();
    const hk = [['rec', 'Start or stop recording', '⌃⌥⌘R'], ['pause', 'Pause or resume', '⌃⌥⌘P'], ['mark', 'Mark moment', '⌃⌥⌘M'], ['catch', 'Catch me up', '⌃⌥⌘C'], ['ask', 'Ask about this call', '⌃⌥⌘A'], ['open', 'Open call screen', '⌃⌥⌘N'], ['mute', 'Mute copilot for 10 minutes', '⌃⌥⌘K'], ['hide', 'Hide for presenting', '⌃⌥⌘0']];
    return html`
      ${group('Global hotkeys', hk.map(([id, label, keys]) => NP.c('hotkeyRecorder', { id: 'hk-' + id, label, keys: d === 'hk-voiceover' && id === 'catch' ? '⌃⌥⌘C' : keys, error: d === 'hk-voiceover' && id === 'catch' ? 'Used by VoiceOver' : d === 'hk-nomod' && id === 'mark' ? 'Add Command, Option or Control' : null })))}
      ${group('Card keys during calls', html`
        ${row('Use card keys during calls', P.toggle('', s.cardKeys, { id: 'st-cardkeys', ariaLabel: 'Use card keys during calls', bind: 'local.settings.cardKeys' }))}
        ${NP.c('hotkeyRecorder', { id: 'hk-pin', label: 'Pin a card', keys: '⌃⌥⌘', variant: 'modifier-set', disabled: !s.cardKeys })}
        ${d === 'hk-card-conflict' ? html`<div class="st-conflict">${icon('warning', { size: 12 })} Card key ${P.kbd('⌃⌥⌘3')} is used by another app</div>` : ''}
        ${row('Dismiss with keys', P.toggle('', s.dismissKeys || d === 'hk-card-conflict2', { id: 'st-dismisskeys', ariaLabel: 'Dismiss with keys', bind: 'local.settings.dismissKeys', disabled: !s.cardKeys }))}
        ${NP.c('hotkeyRecorder', { id: 'hk-dismiss', label: 'Dismiss a card', keys: 'Pin keys + ⇧', variant: 'derived', disabled: !(s.dismissKeys) })}
        ${NP.c('hotkeyRecorder', { id: 'hk-undo', label: 'Undo last card action', keys: '⌃⌥⌘Z', disabled: !s.cardKeys })}
      `, { foot: html`<span class="np-dim">Pin and undo stay on when dismiss keys are off.</span><span class="np-tb__spacer"></span>${P.button('Restore Defaults', { action: ['st.hkDefaults'] })}` })}`;
  };

  const repositories = () => {
    const s = ST();
    if (s.repos == null) s.repos = demo() === 'no-repo' ? [] : D.repos.slice();
    return html`
      ${group('Mappings', s.repos.length ? P.table({ variant: 'sortable', label: 'Repository mappings' }, html`<thead><tr>${P.th('Project or component')}${P.th('Local path')}${P.th('Default tool')}</tr></thead><tbody>${s.repos.map((r, i) => html`<tr><td>${r.jira}</td><td class="np-mono" title="${r.path}">${r.path}</td><td>${P.popup(['Claude Code', 'Codex'], r.tool, { id: 'st-repo-' + i, label: 'Default tool for ' + r.jira, variant: 'inline' })}</td></tr>`)}</tbody>`)
        : C.emptyState({ variant: 'first-use', icon: 'branch', title: 'No repositories mapped', body: 'Map a Jira project or component to a folder so handoffs open in the right place.', actionLabel: 'Add Mapping…', action: ['st.mapping'] }),
        { foot: html`${P.iconButton('plus', { label: 'Add Mapping…', size: 'inline', action: ['st.mapping'] })}${P.iconButton('minus', { label: 'Remove Mapping', size: 'inline', action: ['st.repoRemove'], disabled: !s.repos.length })}` })}
      ${group('', row('Launch', html`<span class="st-launch">Launch handlers found: <span class="np-mono">claude-cli://, claude://, codex://</span> · terminal fallback: iTerm</span>`))}`;
  };

  const knowledge = () => {
    const s = ST();
    const d = demo();
    if (s.sources == null) s.sources = d === 'no-sources' ? [] : null;
    const base = [
      { id: 'src-conf', name: 'Confluence · DEV space', status: d === 'sign-in-expired' ? 'expired' : 'ok', statusWord: d === 'sign-in-expired' ? 'Sign-in expired' : 'Up to date', subtitle: d === 'sign-in-expired' ? 'Confluence sign-in expired · last sync 3 days ago' : '1,180 pages · synced 02:14', tag: 'Indexed', actions: d === 'sign-in-expired' ? [{ label: 'Sign In Again…', action: ['st.retry', { id: 'src-conf' }] }] : [{ label: 'Details…', action: ['st.sourceDetails', { name: 'Confluence · DEV space' }] }] },
      { id: 'src-jira', name: 'Jira · VSTOR', status: 'ok', subtitle: 'Looked up live · last lookup 10:14', tag: 'Live', actions: [{ label: 'Details…', action: ['st.sourceDetails', { name: 'Jira · VSTOR' }] }] },
      { id: 'src-specs', name: 'Drawer specs', status: d === 'source-failed' ? 'error' : 'ok', statusWord: d === 'source-failed' ? 'Failed' : 'Up to date', subtitle: '~/Documents/Specs · 58 files · synced 08:41', message: 'Drawer specs sync failed · folder not found', tag: 'Sensitive', actions: d === 'source-failed' ? [{ label: 'Locate…', action: ['proto.flash', { key: 'proto', text: 'macOS open panel to find the moved folder' }] }, { label: 'Try Again', action: ['st.retry', { id: 'src-specs' }] }] : [{ label: 'Details…', action: ['st.sourceDetails', { name: 'Drawer specs' }] }] },
    ];
    const list = (s.sources === null ? base : s.sources).concat(s.added || []);
    return html`
      ${group('Sources', list.length ? html`<div class="e-list">${list.map((r) => C.statusRow(r, { variant: 'source' }))}</div>`
        : C.emptyState({ variant: 'first-use', icon: 'books', title: 'No knowledge sources yet', body: 'Add a folder or an MCP server, and Noter cites it in search, Ask and cards.', actionLabel: 'Add Folder…', action: ['st.addFolder'] }),
        { foot: P.pulldown('Add Source', [{ label: 'Add Folder…', action: ['st.addFolder'] }, { label: 'Add MCP Server…', action: ['st.addMcp'] }], { anchorId: 'st-src-add', iconOnly: true, icon: 'plus', ariaLabel: 'Add Source', size: 'inline' }) })}
      <p class="st-hint">Sensitive sources are answered by the local model only. Sync failures also appear in Activity › Needs attention.</p>`;
  };

  const maintenance = () => {
    const s = ST();
    const d = demo();
    const live = d === 'jobs-during-call' || state.rec.status === 'recording';
    const jobs = [
      { id: 'job-recon', name: 'Reconciliation', status: live ? 'waiting' : 'ok', statusWord: live ? 'Waiting' : 'Up to date', subtitle: live ? 'Jobs wait until the call ends' : 'Nightly · last run 03:12 · 37 changes in 9 calls', actions: [{ label: 'Run Now', action: ['st.retry', { id: 'job-recon' }] }] },
      { id: 'job-evidence', name: 'Evidence collection', status: d === 'job-failed' ? 'error' : live ? 'waiting' : 'ok', statusWord: d === 'job-failed' ? 'Failed' : live ? 'Waiting' : 'Up to date', subtitle: live ? 'Jobs wait until the call ends' : 'Nightly · last run 03:05 · 1 item closed, 1 proposal', message: 'Evidence check failed: Jira not reachable', actions: [{ label: 'Run Now', action: ['st.retry', { id: 'job-evidence' }] }] },
      { id: 'job-topics', name: 'Topic threads', status: live ? 'waiting' : 'ok', subtitle: live ? 'Jobs wait until the call ends' : 'Nightly · last run 03:20 · 1 merge suggested', actions: [{ label: 'Run Now', action: ['st.retry', { id: 'job-topics' }] }] },
      { id: 'job-index', name: 'Search index', status: 'running', subtitle: 'Rebuilding after the model update', progressText: 'Rebuilding · 64 %' },
      { id: 'job-backup', name: 'Backup', status: 'error', subtitle: 'Nightly · last run yesterday 23:00', message: 'Backup disk not connected', actions: [{ label: 'Run Now', action: ['st.retry', { id: 'job-backup' }] }] },
    ];
    const bkt = d === 'evidence-missing' && !s.bktInstalled;
    return html`
      ${group('Schedule', html`
        ${row('Nightly window', html`<div class="st-inline">${P.textField({ id: 'st-from', value: '02:00', ariaLabel: 'From', cls: 'st-time' })}<span>to</span>${P.textField({ id: 'st-to', value: '05:00', ariaLabel: 'To', cls: 'st-time' })}</div>`)}
        ${row('Allow on battery', P.toggle('', s.battery, { id: 'st-battery', ariaLabel: 'Allow on battery', bind: 'local.settings.battery' }))}
        ${row('Backups kept', P.textField({ id: 'st-backups', variant: 'number', value: s.backups, min: 1, max: 30, ariaLabel: 'Backups kept', cls: 'st-num' }))}
      `)}
      ${group('Jobs', html`<div class="e-list">${jobs.map((j) => C.statusRow(j, { variant: 'job' }))}</div>`)}
      ${group('Evidence sources', html`<div class="e-list">
        ${C.statusRow({ id: 'ev-jira', name: 'Jira (acli)', status: 'ok', statusWord: 'Detected', subtitle: 'acli 1.4 · VSTOR' }, { variant: 'evidence' })}
        ${C.statusRow({ id: 'ev-bkt', name: 'Bitbucket (bkt)', status: bkt ? 'not-configured' : 'ok', statusWord: bkt ? 'Not configured' : 'Detected', subtitle: bkt ? 'Not configured · install bkt' : 'bkt 0.9 · vhi-frontend', actions: bkt ? [{ label: 'Check Again', action: ['st.set', { k: 'bktInstalled', v: true }] }] : [] }, { variant: 'evidence' })}
        ${C.statusRow({ id: 'ev-gh', name: 'GitHub (gh)', status: 'not-configured', statusWord: 'Not configured', subtitle: 'Not configured · install gh' }, { variant: 'evidence' })}
        ${C.statusRow({ id: 'ev-calls', name: 'Later calls', status: 'ok', statusWord: 'On', subtitle: 'A later call that says an item is done becomes a proposal' }, { variant: 'evidence' })}
      </div><p class="st-hint">Closes automatically only for a linked key with a Done transition or a merged pull request; everything else is proposed.</p>`,
        { foot: html`<span class="np-tb__spacer"></span>${P.button('Show Activity', { action: ['st.toMain', { screen: 'activity' }] })}` })}`;
  };

  const performancePane = () => html`
    ${group('', html`
      ${row('Stages sampled', html`<div class="st-checks">${D.perfStages ? D.perfStages.map((x, i) => P.checkbox(x.label, true, { id: 'st-stg-' + i })) : ''}</div>`)}
      ${row('Keep metrics for', P.popup(['90 days', '1 year'], '90 days', { id: 'st-keep', label: 'Keep metrics for' }))}
    `)}
    ${group('Bottleneck thresholds', P.table({ variant: 'sortable', label: 'Bottleneck thresholds' }, html`<thead><tr>${P.th('Status')}${P.th('When p95 is above')}</tr></thead><tbody>
      <tr><td>Near</td><td>${P.textField({ id: 'st-thr-near', variant: 'number', value: 90, ariaLabel: 'Near threshold percent', cls: 'st-num' })} % of budget</td></tr>
      <tr><td>Over</td><td>${P.textField({ id: 'st-thr-over', variant: 'number', value: 105, ariaLabel: 'Over threshold percent', cls: 'st-num' })} % of budget</td></tr></tbody>`), { foot: html`<span class="np-dim">The thresholds drive the Performance screen.</span>` })}`;

  const updates = () => {
    const s = ST();
    const ready = demo() === 'update-ready';
    return html`
      ${ready ? C.inlineBanner({ severity: 'info', text: 'Version 1.2 installs on next launch', actions: [{ label: 'Restart Now', action: ['proto.flash', { key: 'proto', text: 'Noter restarts; recording must be stopped first' }] }], dismissible: false }) : ''}
      ${group('', html`
        ${row('Version', html`<span class="np-tnum">Noter 1.1.3 (412)</span>${P.link('Release notes', { external: true, action: ['proto.flash', { key: 'proto', text: 'Opens the release notes' }] })}`)}
        ${row('Channel', P.popup(['Stable', 'Beta'], s.channel, { id: 'st-channel', label: 'Channel', bind: 'local.settings.channel' }))}
        ${row('Install updates', P.radioGroup('st-install', [{ value: 'auto', label: 'Automatically on next launch' }, { value: 'ask', label: 'Ask me' }], s.install, { bind: 'local.settings.install', label: 'Install updates' }))}
        ${row('', html`${P.button('Check Now', { action: ['st.checkNow'], loading: !!NP.flashed('st-checking') })}${NP.flashed('st-uptodate') ? C.inlineStatus('Noter is up to date', { variant: 'trailing' }) : ''}`)}
        ${row('Model bundle', html`<span>Speech models 2026.10 · up to date</span>`)}
      `)}`;
  };

  const RENDER = { general, audio, models, privacy, callscreen, hotkeys, repositories, knowledge, maintenance, performance: performancePane, updates };

  NP.surface('settings', {
    label: 'Settings',
    states: [
      { id: 'default', label: 'Normal' },
      { id: 'key-rejected', label: 'Models · Key rejected' },
      { id: 'keychain-locked', label: 'Models · Keychain locked' },
      { id: 'local-not-ready', label: 'Models · Local model not ready' },
      { id: 'nothing-left', label: 'Privacy · Nothing left this Mac' },
      { id: 'calendar-off', label: 'Privacy · Calendar access off' },
      { id: 'no-sources', label: 'Knowledge · No sources' },
      { id: 'source-failed', label: 'Knowledge · Source sync failed' },
      { id: 'sign-in-expired', label: 'Knowledge · Sign-in expired' },
      { id: 'no-repo', label: 'Repositories · None mapped' },
      { id: 'hk-voiceover', label: 'Hotkeys · Used by VoiceOver' },
      { id: 'hk-nomod', label: 'Hotkeys · Shortcut without a modifier' },
      { id: 'hk-card-conflict', label: 'Hotkeys · Card key used by another app' },
      { id: 'self-test', label: 'General · Self-test not passed' },
      { id: 'notifications-off', label: 'General · Notifications off' },
      { id: 'icloud', label: 'General · Storage in iCloud Drive' },
      { id: 'model-downloading', label: 'Audio · Model downloading' },
      { id: 'display-absent', label: 'Call screen · Display not connected' },
      { id: 'one-display', label: 'Call screen · One display' },
      { id: 'job-failed', label: 'Maintenance · Job failed' },
      { id: 'jobs-during-call', label: 'Maintenance · Call is live' },
      { id: 'evidence-missing', label: 'Maintenance · Evidence tool missing' },
      { id: 'update-ready', label: 'Updates · Update ready' },
      { id: 'no-match', label: 'Search · No setting matches' },
    ],
    onDemo: (id) => {
      const s = ST();
      Object.assign(s, { search: id === 'no-match' ? 'zoom calls' : '', sources: null, repos: null, added: [], calAsked: false, bktInstalled: false });
      Object.keys(NP.local('e-status', {})).forEach((k) => delete state.local['e-status'][k]);
      Object.keys(NP.local('e-cred', {})).forEach((k) => delete state.local['e-cred'][k]);
      const pane = { 'key-rejected': 'models', 'keychain-locked': 'models', 'local-not-ready': 'models', 'nothing-left': 'privacy', 'calendar-off': 'privacy', 'no-sources': 'knowledge', 'source-failed': 'knowledge', 'sign-in-expired': 'knowledge', 'no-repo': 'repositories', 'hk-voiceover': 'hotkeys', 'hk-nomod': 'hotkeys', 'hk-card-conflict': 'hotkeys', 'self-test': 'general', 'notifications-off': 'general', icloud: 'general', 'model-downloading': 'audio', 'display-absent': 'callscreen', 'one-display': 'callscreen', 'job-failed': 'maintenance', 'jobs-during-call': 'maintenance', 'evidence-missing': 'maintenance', 'update-ready': 'updates' }[id];
      if (pane) state.settingsPane = pane;
    },
    render: (ctx) => {
      const s = ST();
      const cur = paneId();
      const pane = PANES.find((p) => p.id === cur);
      const q = (s.search || '').trim().toLowerCase();
      const shown = q ? PANES.filter((p) => (p.label + ' ' + p.keys).toLowerCase().includes(q)) : PANES;
      const banner = demo() === 'keychain-locked' && cur === 'models' && !s.keychainOk ? C.inlineBanner({ severity: 'error', text: 'Keychain is locked', actions: [{ label: 'Try Again', action: ['st.set', { k: 'keychainOk', v: true }] }] }) : '';
      let body;
      try { body = RENDER[cur](); } catch (e) { console.error(e); body = html`<pre class="np-err">${e.stack}</pre>`; }
      const win = NP.shell.window({
        component: 'cpt-noter-component-screen-settings',
        title: pane.label, w: 860, minH: 620, cls: 'st-win', variant: cur, state: ctx.demo,
        body: html`<div class="st-body">
          ${NP.region('ST-R1', { tag: 'nav', cls: 'st-panes', label: 'Settings panes' }, html`
            ${P.searchField({ id: 'st-search', placeholder: 'Search', bind: 'local.settings.search', value: s.search, live: true })}
            ${shown.length ? html`<div class="st-panelist" role="list"${raw(` data-component="${P.PRIM}" data-primitive="source-list" data-variant="settings-panes"`)}>${shown.map((p) => html`<a href="#" role="listitem" class="st-pane-item${p.id === cur ? ' is-sel' : ''}" aria-current="${p.id === cur ? 'page' : 'false'}" ${act('st.pane', { id: p.id })}>${icon(p.icon, { size: 15 })}<span>${p.label}</span></a>`)}</div>`
              : html`<div class="st-nomatch">No settings match “${s.search}”</div>`}`)}
          <div class="st-main" data-proto-scroll="settings-${cur}">
            ${banner ? NP.region('ST-R3', { cls: 'st-banner', label: 'Pane banner' }, banner) : ''}
            ${NP.region('ST-R2', { cls: 'st-pane', label: pane.label }, html`<h2 class="t-title3 st-pane__title">${pane.label}</h2>${body}`)}
          </div>
        </div>`,
      });
      return html`${NP.shell.caption('Settings window', ' · separate window, 820 × 620 default, 11 panes')}${win}`;
    },
  });

  /* ---------------- actions ---------------- */
  NP.on('st.pane', (a) => { state.settingsPane = a.id; });
  NP.on('st.set', (a) => { ST()[a.k] = a.v; });
  NP.on('st.seg', (a) => { ST()[a.k] = a.value; });
  NP.on('st.num', (a) => { ST()[a.k] = Number(a.value); });
  NP.on('st.firstRun', () => { NP.show('firstrun'); return false; });
  NP.on('st.toMain', (a) => { NP.go(a.screen, a.params || {}); return false; });
  NP.on('st.selfTest', () => { if (NP.actions['dialogs.selfTest']) return NP.actions['dialogs.selfTest'](); NP.flash('proto', 'The self-test sheet lives in the dialogs module'); });
  NP.on('st.shareTest', () => { if (NP.overlays['dlg-share-test']) { NP.openSheet('dlg-share-test', {}); return false; } NP.flash('proto', 'The Screen Share Test sheet lives in the dialogs module'); });
  NP.on('st.mapping', () => { if (NP.overlays['dlg-mapping']) { NP.openSheet('dlg-mapping', {}); return false; } ST().repos = D.repos.slice(); });
  NP.on('st.repoRemove', () => { const s = ST(); s.repos = (s.repos || []).slice(0, -1); });
  NP.on('st.addMcp', () => { if (NP.overlays['dlg-mcp']) { NP.openSheet('dlg-mcp', {}); return false; } });
  NP.on('st.hkDefaults', () => { const H = NP.local('hotkeys', {}); Object.keys(H).forEach((k) => delete H[k]); NP.flash('proto', 'Restored every hotkey and checked the set again · no conflicts', 2500); });
  NP.on('st.checkNow', () => { NP.flash('st-checking', 'x', 900); setTimeout(() => { NP.flash('st-uptodate', 'x', 3000); NP.render(); }, 900); });

  /* Add Folder… → open panel → source sheet → indexing row */
  NP.on('st.addFolder', () => { NP.openSheet('e-source', { mode: 'add' }); return false; });
  NP.on('st.sourceDetails', (a) => { NP.openSheet('e-source', { mode: 'details', name: a.name }); return false; });
  NP.overlay('e-source', {
    width: 520,
    title: (p) => (p.mode === 'add' ? 'Add Folder' : p.name),
    render: (p) => {
      const f = NP.local('e-source', { mode: 'indexed', schedule: 'On change', privacy: 'Normal' });
      const add = p.mode === 'add';
      return html`<div data-component="cpt-noter-component-screen-dialogs" data-variant="sheet" data-state="${add ? 'add-folder' : 'source-details'}">
        <div class="np-sheet__head"><div class="np-sheet__title">${add ? 'Add Folder' : p.name}</div><div class="np-sheet__sub">${add ? html`<span class="np-mono">~/Documents/Release notes</span> · 24 files` : 'Source details'}</div></div>
        <div class="np-sheet__body">
          ${row('Mode', P.radioGroup('src-mode', [{ value: 'live', label: 'Live', note: 'Read when asked; nothing is copied' }, { value: 'indexed', label: 'Indexed', note: 'Copied into the local index for fast search' }], f.mode, { bind: 'local.e-source.mode', label: 'Mode' }))}
          ${row('Schedule', P.popup(['On change', 'Every hour', 'Every 6 hours', 'Only by hand'], f.schedule, { id: 'src-sched', label: 'Schedule', bind: 'local.e-source.schedule' }))}
          ${row('Privacy class', P.segmented(['Normal', 'Sensitive'], f.privacy, { variant: 'option', label: 'Privacy class', action: ['st.srcPrivacy'] }), 'Sensitive sources are answered by the local model only.')}
          ${row('Scope', P.textField({ id: 'src-scope', value: add ? 'All files, Markdown and PDF' : '1,180 pages', ariaLabel: 'Scope' }))}
          ${add ? '' : html`<div class="st-inline">${P.button('Re-index', { size: 'small', action: ['sheet.close'] })}${P.button('Revoke Token…', { size: 'small', action: ['st.revoke', { name: p.name }] })}${P.button('Remove Source…', { size: 'small', cls: 'np-btn--destructive', action: ['st.removeSource', { name: p.name }] })}</div>`}
        </div>
        <div class="np-sheet__foot">${P.button('Cancel', { action: ['sheet.close'] })}${P.button(add ? 'Add Source' : 'Done', { variant: 'primary', action: [add ? 'st.addSourceDone' : 'sheet.close'] })}</div>
      </div>`;
    },
  });
  NP.on('st.srcPrivacy', (a) => { NP.local('e-source', {}).privacy = a.value; });
  NP.on('st.addSourceDone', () => {
    const s = ST(); const f = NP.local('e-source', {});
    s.added = (s.added || []).concat([{ id: 'src-new', name: 'Release notes', status: 'running', subtitle: '~/Documents/Release notes · 24 files', progressText: 'Indexing 9 of 24 files', tag: f.privacy || 'Normal' }]);
    NP.local('e-status', {})['src-new'] = { status: 'running', progress: 38 };
    state.sheet = null;
    setTimeout(() => { NP.local('e-status', {})['src-new'] = { status: 'ok' }; const x = s.added.find((y) => y.id === 'src-new'); if (x) x.subtitle = '~/Documents/Release notes · 24 files · synced just now'; NP.render(); }, 2200);
  });
  NP.on('st.removeSource', (a) => NP.openAlert({ title: `Remove “${a.name}”?`, body: 'Its 1,180 indexed pages leave search and answers. Nothing in Confluence changes.', variant: 'destructive', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Remove', variant: 'destructive', action: 'st.removeSourceYes', args: { name: a.name } }] }));
  NP.on('st.removeSourceYes', (a) => { const s = ST(); state.alert = null; state.sheet = null; s.sources = [{ id: 'src-jira', name: 'Jira · VSTOR', status: 'ok', subtitle: 'Looked up live · last lookup 10:14', tag: 'Live' }]; NP.flash('proto', `Removed “${a.name}”`, 2200); });
  NP.on('st.revoke', (a) => NP.openAlert({ title: 'Revoke Noter’s access to Confluence?', body: 'Syncing stops until you sign in again.', variant: 'warning', buttons: [{ label: 'Cancel', variant: 'primary', action: 'alert.close' }, { label: 'Revoke', action: 'alert.close' }] }));

  NP.galleries.dialogs.push({ id: 'e-source', label: 'Settings · Add Folder…', surface: 'settings', open: () => { state.settingsPane = 'knowledge'; NP.openSheet('e-source', { mode: 'add' }); } });
})();
