/* =====================================================================
   Shells: prototype harness (not product UI), window chrome helper,
   Shell — Main window (cpt-noter-component-shell-main-window),
   overlay layers (sheets, alerts, popovers, menus), handoff inspector.
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, icon, P, C, state } = NP;
  const S = NP.shell;

  /* ---------------- window chrome ----------------
     window({component, kind, title, w, h, cls, body, toolbar, region, state, variant, noLights})
     Draws a macOS window frame; sheets/alerts of this surface render inside it. */
  S.lights = (o) => html`<span class="np-lights" aria-hidden="true"><span class="np-light np-light--close"></span><span class="np-light np-light--min"></span><span class="np-light np-light--zoom"${o && o.noZoom ? raw(' data-off') : ''}></span></span>`;
  S.window = (o) => {
    o = o || {};
    const style = [o.w ? `width:${o.w}px` : '', o.h ? `height:${o.h}px` : '', o.minH ? `min-height:${o.minH}px` : ''].filter(Boolean).join(';');
    return html`<div class="np-win${o.cls ? ' ' + o.cls : ''}"${attrs({ 'data-component': o.component, 'data-variant': o.variant, 'data-state': o.state, 'data-region': o.region, style: style || null, role: 'group', 'aria-label': o.title || null })}>
      ${o.titlebar === false ? '' : html`<div class="np-win__titlebar">${o.noLights ? '' : S.lights(o)}<span class="np-win__title">${o.title || ''}</span>${o.titleTrailing || ''}</div>`}
      ${o.body}
      ${S.windowOverlays()}
    </div>`;
  };
  /** Caption above a surface on the desk (prototype chrome). */
  S.caption = (text, sub) => html`<div class="np-cap" data-proto-chrome>${text}${sub ? html`<span>${sub}</span>` : ''}</div>`;

  /* ---------------- overlays inside a window ---------------- */
  S.windowOverlays = () => {
    let out = '';
    if (state.sheet) {
      const def = NP.overlays[state.sheet.id];
      const firstShow = !state.sheet._shown; state.sheet._shown = true;
      out += html`<div class="np-sheet-layer${firstShow ? ' is-new' : ''}"><div class="np-sheet"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'sheet', 'data-variant': def && def.width ? String(def.width) : null, 'data-state': state.sheet.props.busy ? 'busy' : 'open', role: 'dialog', 'aria-modal': 'true', 'aria-label': def && def.title ? def.title(state.sheet.props) : state.sheet.id, style: def && def.width ? `width:${def.width}px` : null })}>${def ? def.render(state.sheet.props) : html`<p>Missing sheet ${state.sheet.id}</p>`}</div></div>`;
    }
    if (state.alert) {
      const a = state.alert;
      out += html`<div class="np-alert-layer"><div data-component="cpt-noter-component-screen-dialogs" data-variant="alert" data-state="${a.variant || 'warning'}"><div class="np-alert" role="alertdialog" aria-modal="true" aria-label="${a.title}"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'alert', 'data-variant': a.variant || 'warning' })}>
        <div class="np-alert__icon">${icon('noter', { size: 40 })}</div>
        <div class="np-alert__title">${a.title}</div>
        ${a.body ? html`<div class="np-alert__body">${a.body}</div>` : ''}
        ${a.checkbox ? html`<div class="np-alert__check">${P.checkbox(a.checkbox, false, {})}</div>` : ''}
        <div class="np-alert__btns">${((bs) => bs.filter((b) => b.variant !== 'primary').concat(bs.filter((b) => b.variant === 'primary')))(a.buttons || [{ label: 'OK', variant: 'primary', action: 'alert.close' }]).map((b) => P.button(b.label, { variant: b.variant || 'secondary', action: [b.action || 'alert.close', b.args] }))}</div>
      </div></div></div>`;
    }
    return raw(out);
  };
  NP.on('alert.close', () => { state.alert = null; });
  NP.on('sheet.close', () => { state.sheet = null; });

  /* floating layer (popovers + menus), positioned next to data-proto-anchor */
  S.floatingLayer = () => {
    let out = '';
    if (state.popover) {
      const def = NP.overlays[state.popover.id];
      out += html`<div class="np-pop" data-proto-float="${state.popover.anchor}"${attrs({ 'data-proto-align': def && def.align, 'data-component': P.PRIM, 'data-primitive': 'popover', 'data-variant': state.popover.id, role: 'dialog', style: def && def.width ? `width:${def.width}px` : null })}>${def ? def.render(state.popover.props) : 'Missing popover ' + state.popover.id}</div>`;
    }
    if (state.menu) {
      out += html`<div class="np-float-menu" data-proto-float="${state.menu.anchor}">${P.menu(state.menu.items || [])}</div>`;
    }
    return raw(out);
  };

  /* ---------------- Main window ---------------- */
  const SECTIONS = [
    { key: 'today', label: 'Today', icon: 'sun', screen: 'today', kc: '1' },
    { key: 'ask', label: 'Ask', icon: 'bubble', screen: 'ask', kc: '2' },
    { group: 'Library' },
    { key: 'library', label: 'Calls', icon: 'list', screen: 'library', params: { view: 'calls' }, kc: '3' },
    { key: 'people', label: 'People', icon: 'people', screen: 'people', kc: '4' },
    { key: 'topics', label: 'Topics', icon: 'thread', screen: 'library', params: { view: 'topics' }, kc: '5' },
    { group: 'Workspace' },
    { key: 'activity', label: 'Activity', icon: 'inbox', screen: 'activity', kc: '6' },
    { key: 'agents', label: 'Agents', icon: 'agent', screen: 'agents', kc: '7' },
    { key: 'performance', label: 'Performance', icon: 'gauge', screen: 'performance', kc: '8' },
  ];
  S.SECTIONS = SECTIONS;
  S.goSection = (key) => {
    const s = SECTIONS.find((x) => x.key === key);
    if (!s) return;
    if (!NP.screens[s.screen]) { NP.flash('proto', s.label + ' is not built yet'); NP.render(); return; }
    NP.go(s.screen, Object.assign({}, s.params || {}));
  };
  NP.on('nav.section', (a) => { S.goSection(a.key); return false; });

  const currentSection = () => {
    const r = state.route;
    const def = NP.screens[r.screen];
    if (def && typeof def.section === 'function') return def.section(ctxFor(r.screen));
    if (def && def.section) return def.section;
    if (r.screen === 'library') return r.params.view === 'topics' || r.params.view === 'thread' ? 'topics' : 'library';
    if (r.screen === 'person') return 'people';
    return r.screen;
  };

  const sidebarBadges = () => ({
    activity: { count: NP.data.proposals.length - ((state.local.activity && state.local.activity.decided) ? Object.keys(state.local.activity.decided).length : 0), warn: true, aria: 'problem' },
    agents: { warn: NP.data.agents.some((a) => a.enabled && a.status === 'unavailable') },
    performance: { warn: NP.data.metrics.some((m) => m.status === 'off') },
  });

  const sidebar = () => {
    const sec = currentSection();
    const badges = sidebarBadges();
    const rec = state.rec.status === 'recording' || state.rec.status === 'paused';
    const footerMode = state.setup.assistant === 'none' ? 'No assistant' : (rec ? state.rec.mode : 'Idle · API key · local fallback ready');
    return html`<aside class="np-sidebar" data-region="MW-R2" aria-label="Sidebar">
      <div class="np-sidebar__top">${S.lights()}${P.iconButton('sidebar', { label: 'Hide Sidebar', size: 'toolbar', action: ['shell.toggleSidebar'], help: 'Hide Sidebar (⌃⌘S)', cls: 'np-sidebar__toggle' })}</div>
      <nav class="np-srclist" role="list"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'source-list' })}>
        ${rec ? html`<div class="np-srclist__live" data-variant="live-row">${C.recordingIndicator({ variant: 'live-row', status: state.rec.status === 'paused' ? 'paused' : 'recording' })}</div>` : ''}
        ${SECTIONS.map((s) => {
          if (s.group) return html`<div class="np-srclist__group" data-variant="group-header">${s.group}</div>`;
          const b = badges[s.key] || {};
          const sel = sec === s.key;
          const outputsWriting = s.key === 'library' && state.outputsWriting;
          return html`<a href="#" role="listitem" class="np-srclist__item${sel ? ' is-sel' : ''}${s.screen && !NP.screens[s.screen] ? ' is-missing' : ''}" data-variant="item" data-state="${sel ? 'selected' : 'default'}" aria-current="${sel ? 'page' : 'false'}" ${act('nav.section', { key: s.key })} title="${s.label} (⌘${s.kc})">
            ${icon(s.icon, { size: 15 })}<span class="np-srclist__label">${s.label}</span>
            ${outputsWriting ? P.progress({ variant: 'spinner', label: 'Writing outputs' }) : ''}
            ${b.count ? html`<span class="np-srclist__badge" data-variant="badge">${b.count}</span>` : ''}
            ${b.warn ? html`<span class="np-srclist__warn" title="Needs attention">${icon('warning', { size: 12, label: 'problem' })}</span>` : ''}
          </a>`;
        })}
      </nav>
      <div class="np-sidebar__footer" data-variant="footer">${C.modeIndicator({ variant: 'sidebar', mode: state.setup.assistant === 'none' ? 'No assistant' : rec ? state.rec.mode : 'Cloud, redacted', text: footerMode })}</div>
    </aside>`;
  };
  NP.on('shell.toggleSidebar', () => { state.sidebar = !state.sidebar; });

  const ctxFor = (key) => {
    const r = state.route;
    return { key, route: r, params: r.params || {}, demo: NP.demo(key), local: NP.local(key), state };
  };
  S.ctx = ctxFor;

  const toolbar = (def, ctx) => {
    const title = def && def.title ? (typeof def.title === 'function' ? def.title(ctx) : def.title) : 'Not built';
    const sub = def && def.subtitle ? (typeof def.subtitle === 'function' ? def.subtitle(ctx) : def.subtitle) : '';
    const center = def && def.toolbarCenter ? def.toolbarCenter(ctx) : '';
    const actions = def && def.toolbarActions ? def.toolbarActions(ctx) : '';
    const search = def && def.search === false ? '' : P.searchField({ id: 'mw-search', placeholder: (def && def.searchPlaceholder) || 'Search calls, people, documents', bind: 'local.shell.search', value: (state.local.shell || {}).search || '', enter: 'shell.search', cls: 'np-toolbar__search' });
    return html`<header class="np-toolbar" data-region="MW-R1"${attrs({ 'data-component': P.PRIM, 'data-primitive': 'toolbar' })}>
      ${state.sidebar ? '' : html`${S.lights()}${P.iconButton('sidebar', { label: 'Show Sidebar', action: ['shell.toggleSidebar'], help: 'Show Sidebar (⌃⌘S)' })}`}
      <span class="np-toolbar__nav">${P.iconButton('back', { label: 'Back', action: ['nav.back'], disabled: state.hIndex === 0, help: 'Back (⌘[)' })}${P.iconButton('forward', { label: 'Forward', action: ['nav.forward'], disabled: state.hIndex >= state.history.length - 1, help: 'Forward (⌘])' })}</span>
      <div class="np-toolbar__titles"><h1 class="np-toolbar__title" title="${title}">${title}</h1>${sub ? html`<span class="np-toolbar__sub">${sub}</span>` : ''}</div>
      ${center ? html`<div class="np-toolbar__center">${center}</div>` : ''}
      <span class="np-tb__spacer"></span>
      ${actions ? html`<div class="np-toolbar__actions">${actions}</div>` : ''}
      ${search}
    </header>`;
  };
  NP.on('shell.search', (a) => { const q = (a.value || '').trim(); NP.go('library', { view: 'search', q }); return false; });

  const bannerSlot = (def, ctx) => {
    let list = (def && def.banners ? def.banners(ctx) : []) || [];
    list = list.filter((b) => b && !(state.dismissed && b.id && state.dismissed[b.id]));
    if (state.setup.selfTestPassed === false && ctx.key !== 'today') list.push({ id: 'selftest', severity: 'warning', text: 'Call detection is off until the audio self-test passes', actions: [{ label: 'Run Audio Self-Test…', action: ['dialogs.selfTest'] }, { label: 'Finish Setup…', link: true, action: ['today.finishSetup'] }] });
    if (!list.length) return '';
    const order = { error: 0, warning: 1, degraded: 2, info: 3, success: 4 };
    list.sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9));
    const first = list[0];
    const rest = list.slice(1);
    return html`<div class="np-bannerslot" data-region="MW-R5">${C.inlineBanner(Object.assign({}, first, { more: !state.bannersExpanded && rest.length ? rest.length : null }))}${state.bannersExpanded ? rest.map((b) => C.inlineBanner(b)) : ''}</div>`;
  };

  const inspectorSlot = (def, ctx) => {
    let ins = state.inspector;
    if (!ins && def && def.defaultInspector && !ctx.local.hideInspector) ins = def.defaultInspector(ctx);
    if (!ins) return '';
    const idef = NP.inspectors[ins.kind];
    const w = (idef && idef.width) || 320;
    return html`<aside class="np-inspector" data-region="MW-R4" style="width:${w}px" aria-label="Inspector">
      ${idef ? idef.render(ins.props || {}, ctx) : html`<div class="np-pad">Inspector “${ins.kind}” is not built yet. ${P.button('Close', { action: ['shell.closeInspector'] })}</div>`}
    </aside>`;
  };
  NP.on('shell.closeInspector', () => {
    if (state.inspector) state.inspector = null;
    else { const def = NP.screens[state.route.screen]; if (def) NP.local(def.key).hideInspector = true; }
  });

  S.mainWindow = () => {
    const key = state.route.screen;
    const def = NP.screens[key];
    const ctx = ctxFor(key);
    let body;
    try {
      body = def ? def.render(ctx) : C.emptyState({ variant: 'large', icon: 'wand', title: 'This page is not built yet', body: 'Screen “' + key + '” has no module in this build.' });
    } catch (e) { console.error(e); body = html`<pre class="np-err">${e.stack || e.message}</pre>`; }
    return html`<div class="np-win np-win--main${state.sidebar ? '' : ' no-sidebar'}" data-component="cpt-noter-component-shell-main-window" data-state="${state.rec.status === 'recording' || state.rec.status === 'paused' ? 'capturing' : 'idle'}">
      ${state.sidebar ? html`${sidebar()}${P.splitDivider()}` : ''}
      <div class="np-main">
        ${toolbar(def, ctx)}
        ${bannerSlot(def, ctx)}
        <div class="np-body">
          <div class="np-content" data-region="MW-R3" data-proto-scroll="content-${key}">
            <div${attrs({ 'data-component': def ? def.id : null, 'data-state': ctx.demo, 'data-variant': def && def.variant ? def.variant(ctx) : null, class: 'np-screen np-screen--' + key })}>${body}</div>
          </div>
          ${inspectorSlot(def, ctx)}
        </div>
      </div>
      ${S.windowOverlays()}
    </div>`;
  };

  /* ---------------- Harness (prototype chrome) ---------------- */
  const SURFACES = [
    { key: 'main', label: 'Main window' },
    { key: 'call', label: 'Call window' },
    { key: 'record', label: 'Record prompt' },
    { key: 'menubar', label: 'Menu bar' },
    { key: 'firstrun', label: 'First run' },
    { key: 'settings', label: 'Settings' },
    { key: 'notifications', label: 'Notifications' },
  ];

  const statesFor = () => {
    if (state.surface === 'main') { const d = NP.screens[state.route.screen]; return d ? { key: d.key, label: (typeof d.title === 'function' ? d.title(ctxFor(d.key)) : d.title) || d.key, states: d.states || [] } : null; }
    const s = NP.surfaces[state.surface];
    return s ? { key: s.key, label: s.label, states: s.states || [] } : null;
  };

  S.harness = () => {
    const sf = statesFor();
    const cur = sf ? NP.demo(sf.key) : 'default';
    const statesItems = sf && sf.states.length ? sf.states.map((s) => ({ label: s.label, checked: s.id === cur, action: ['proto.setDemo', { key: sf.key, id: s.id }] })) : [{ label: 'No extra states for this view', disabled: true }];
    NP._menus['h-states'] = statesItems;
    const dialogItems = (NP.galleries.dialogs || []).map((d) => ({ label: d.label, action: ['proto.openDialog', { id: d.id }] }));
    NP._menus['h-dialogs'] = dialogItems.length ? dialogItems : [{ label: 'No dialogs registered', disabled: true }];
    const surfaceBody = (() => {
      try {
        if (state.surface === 'main') return html`${S.caption('Main window', ' · 1280 × 820 default, minimum 900 × 600')}${S.mainWindow()}`;
        const s = NP.surfaces[state.surface];
        if (!s) return html`${S.caption(state.surface)}${C.emptyState({ icon: 'wand', title: 'Not built yet', body: 'Surface “' + state.surface + '” has no module.' })}`;
        return s.render(ctxForSurface(s.key));
      } catch (e) { console.error(e); return html`<pre class="np-err">${e.stack || e.message}</pre>`; }
    })();
    const recItems = [
      { label: 'Idle', checked: state.rec.status === 'idle', action: ['proto.rec', { status: 'idle' }] },
      { label: 'Recording', checked: state.rec.status === 'recording', action: ['proto.rec', { status: 'recording' }] },
      { label: 'Paused', checked: state.rec.status === 'paused', action: ['proto.rec', { status: 'paused' }] },
      { divider: true },
      { label: 'Microphone access off (Record still works)', checked: !state.setup.micGranted, action: ['proto.setup', { k: 'micGranted' }] },
      { label: 'System audio access off (Record still works)', checked: !state.setup.sysGranted, action: ['proto.setup', { k: 'sysGranted' }] },
      { label: 'Self-test not passed (call detection off)', checked: !state.setup.selfTestPassed, action: ['proto.setup', { k: 'selfTestPassed' }] },
      { label: 'No assistant configured', checked: state.setup.assistant === 'none', action: ['proto.setup', { k: 'assistant' }] },
      { label: 'Increase contrast (macOS accessibility)', checked: state.contrast === 'more', action: ['proto.contrast'] },
      { divider: true },
      { label: 'Claude account signed in', checked: !!(NP.auth && NP.auth.signedIn('claude')), action: ['auth.toggleDemo', { p: 'claude' }] },
      { label: 'ChatGPT account signed in', checked: !!(NP.auth && NP.auth.signedIn('chatgpt')), action: ['auth.toggleDemo', { p: 'chatgpt' }] },
    ];
    NP._menus['h-scenario'] = recItems;
    const missing = NP.flashed('proto-missing') || NP.flashed('proto');
    return html`<div class="np-harness${state.inspect ? ' is-inspecting' : ''}${state.handoffPanel ? ' has-panel' : ''}">
      <header class="np-hbar" data-proto-chrome>
        <div class="np-hbar__brand">${icon('noter', { size: 16 })}<span>Noter</span><em>clickable prototype</em></div>
        <nav class="np-hbar__tabs" aria-label="Surfaces">${SURFACES.map((s) => html`<button type="button" class="np-hbar__tab${state.surface === s.key ? ' is-on' : ''}" aria-pressed="${String(state.surface === s.key)}" ${act('surface.show', { surface: s.key })}>${s.label}</button>`)}
          <button type="button" class="np-hbar__tab" data-proto-anchor="h-dialogs" ${act('proto.menu', { anchor: 'h-dialogs' })}>Dialogs ▾</button></nav>
        <div class="np-hbar__tools">
          <button type="button" class="np-hbar__btn" data-proto-anchor="h-states" ${act('proto.menu', { anchor: 'h-states' })} title="Show this view in another state from DESIGN">State: ${sf && sf.states.length ? (sf.states.find((s) => s.id === cur) || sf.states[0]).label : 'Normal'} ▾</button>
          <button type="button" class="np-hbar__btn" data-proto-anchor="h-scenario" ${act('proto.menu', { anchor: 'h-scenario' })}>Capture: ${state.rec.status === 'idle' ? 'Idle' : state.rec.status === 'paused' ? 'Paused' : 'Recording'} ▾</button>
          <span class="np-hbar__seg" role="radiogroup" aria-label="Appearance">${['system', 'light', 'dark'].map((t) => html`<button type="button" role="radio" aria-checked="${String(state.theme === t)}" class="${state.theme === t ? 'is-on' : ''}" ${act('proto.theme', { theme: t })}>${t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}</button>`)}</span>
          <button type="button" class="np-hbar__btn${state.inspect ? ' is-on' : ''}" aria-pressed="${String(state.inspect)}" ${act('proto.inspect')} title="Hover any element to see its DESIGN component; click to pin it">Inspect</button>
          <button type="button" class="np-hbar__btn${state.handoffPanel ? ' is-on' : ''}" aria-pressed="${String(state.handoffPanel)}" ${act('proto.panel')}>Components</button>
        </div>
      </header>
      <div class="np-stage">
        <div class="np-desk" data-proto-scroll="desk">
          ${surfaceBody}
          ${S.floatingLayer()}
        </div>
        ${state.handoffPanel ? html`<aside class="np-hpanel" data-proto-chrome aria-label="Components on this view"><div class="np-hpanel__inner" id="np-hpanel"></div></aside>` : ''}
      </div>
      ${missing ? html`<div class="np-toast" data-proto-chrome role="status">${missing}</div>` : ''}
      <div class="np-inspect-tip" id="np-inspect-tip" data-proto-chrome hidden></div>
    </div>`;
  };
  const ctxForSurface = (key) => ({ key, demo: NP.demo(key), local: NP.local(key), state });
  S.surfaceCtx = ctxForSurface;

  NP.on('proto.setDemo', (a) => {
    state.demo[a.key] = a.id;
    const def = NP.screens[a.key] || NP.surfaces[a.key];
    if (def && def.onDemo) def.onDemo(a.id, a.key === state.route.screen ? ctxFor(a.key) : ctxForSurface(a.key));
  });
  NP.on('proto.theme', (a) => { state.theme = a.theme; NP.savePref('theme', a.theme); });
  NP.on('proto.contrast', () => { state.contrast = state.contrast === 'more' ? null : 'more'; });
  NP.on('proto.inspect', () => { state.inspect = !state.inspect; if (!state.inspect) S.hideTip(); });
  NP.on('proto.panel', () => { state.handoffPanel = !state.handoffPanel; });
  NP.on('proto.rec', (a) => {
    if (a.status === 'idle') state.rec.status = 'idle';
    else if (a.status === 'recording') { if (state.rec.status === 'paused') { state.rec.startedAt += Date.now() - state.rec.pausedAt; state.rec.status = 'recording'; } else NP.startRecording(); }
    else if (a.status === 'paused') { if (state.rec.status === 'idle') NP.startRecording(); state.rec.status = 'paused'; state.rec.pausedAt = Date.now(); }
  });
  NP.on('proto.setup', (a) => {
    if (a.k === 'assistant') state.setup.assistant = state.setup.assistant === 'none' ? 'api-key' : 'none';
    else state.setup[a.k] = !state.setup[a.k];
  });
  NP.on('proto.openDialog', (a) => { const d = (NP.galleries.dialogs || []).find((x) => x.id === a.id); if (d) { if (d.surface) state.surface = d.surface; d.open(); } });

  /* ---------------- Handoff tools: inspect tip + components panel ---------------- */
  const describe = (el) => {
    const out = [];
    let n = el;
    while (n && n !== document.body && out.length < 6) {
      if (n.getAttribute) {
        const c = n.getAttribute('data-component');
        if (c) {
          out.push({ el: n, component: c, primitive: n.getAttribute('data-primitive'), variant: n.getAttribute('data-variant'), state: n.getAttribute('data-state'), size: n.getAttribute('data-size') });
        } else if (n.getAttribute('data-region') && out.length < 6) {
          out.push({ el: n, region: n.getAttribute('data-region') });
        }
      }
      n = n.parentElement;
    }
    return out;
  };
  const tipHtml = (chain) => chain.map((d, i) => d.region
    ? `<div class="np-tip__row is-region"><b>region</b> ${NP.esc(d.region)}</div>`
    : `<div class="np-tip__row${i === 0 ? ' is-main' : ''}"><code>${NP.esc(d.component.replace('cpt-noter-component-', ''))}</code>${d.primitive ? ` <span>${NP.esc(d.primitive)}</span>` : ''}${d.variant ? ` <i>variant=${NP.esc(d.variant)}</i>` : ''}${d.size ? ` <i>size=${NP.esc(d.size)}</i>` : ''}${d.state ? ` <i>state=${NP.esc(d.state)}</i>` : ''}</div>`).join('');
  S.hideTip = () => { const t = document.getElementById('np-inspect-tip'); if (t) t.hidden = true; document.querySelectorAll('.np-inspect-hl').forEach((e) => e.classList.remove('np-inspect-hl')); };
  NP.inspectTool = {
    hover(ev) {
      const target = ev.target.closest('[data-component],[data-region]');
      const tip = document.getElementById('np-inspect-tip');
      if (!tip) return;
      document.querySelectorAll('.np-inspect-hl').forEach((e) => e.classList.remove('np-inspect-hl'));
      if (!target || target.closest('[data-proto-chrome]')) { tip.hidden = true; return; }
      const chain = describe(target);
      if (!chain.length) { tip.hidden = true; return; }
      const first = chain.find((d) => d.component) || chain[0];
      first.el.classList.add('np-inspect-hl');
      tip.innerHTML = tipHtml(chain);
      tip.hidden = false;
      const r = first.el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = r.top - th - 6; if (top < 50) top = Math.min(window.innerHeight - th - 8, r.bottom + 6);
      let left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
      tip.style.top = top + 'px'; tip.style.left = left + 'px';
    },
    click(ev) {
      if (ev.target.closest('[data-proto-chrome]')) return false;
      const target = ev.target.closest('[data-component]');
      if (!target) return false;
      ev.preventDefault(); ev.stopPropagation();
      const chain = describe(target).filter((d) => d.component);
      state.pinned = chain.map((d) => ({ component: d.component, primitive: d.primitive, variant: d.variant, state: d.state, size: d.size }));
      state.handoffPanel = true;
      NP.render();
      return true;
    },
    refresh() { /* tip follows the mouse; nothing to do */ },
  };

  /* Components panel: what is on the current view, built from the DOM after each render */
  const fillPanel = () => {
    const host = document.getElementById('np-hpanel');
    if (!host) return;
    const desk = document.querySelector('.np-desk');
    const els = desk ? desk.querySelectorAll('[data-component]') : [];
    const map = new Map();
    els.forEach((el) => {
      const id = el.getAttribute('data-component');
      const prim = el.getAttribute('data-primitive');
      const key = prim ? id + '::' + prim : id;
      if (!map.has(key)) map.set(key, { id, prim, count: 0, variants: new Set(), states: new Set() });
      const m = map.get(key); m.count++;
      const v = el.getAttribute('data-variant'); if (v) m.variants.add(v);
      const s = el.getAttribute('data-state'); if (s) m.states.add(s);
    });
    const rows = [...map.values()].sort((a, b) => {
      const rank = (x) => (x.id.includes('-shell-') ? 0 : x.id.includes('-screen-') ? 1 : x.prim ? 3 : 2);
      return rank(a) - rank(b) || a.id.localeCompare(b.id) || String(a.prim).localeCompare(String(b.prim));
    });
    const pinned = state.pinned ? `<section class="np-hp__pinned"><h3>Pinned element</h3>${state.pinned.map((d, i) => `<div class="np-hp__pin${i === 0 ? ' is-main' : ''}"><code>${NP.esc(d.component)}</code>${d.primitive ? `<div>data-primitive="${NP.esc(d.primitive)}"</div>` : ''}${d.variant ? `<div>data-variant="${NP.esc(d.variant)}"</div>` : ''}${d.size ? `<div>data-size="${NP.esc(d.size)}"</div>` : ''}${d.state ? `<div>data-state="${NP.esc(d.state)}"</div>` : ''}</div>`).join('')}<button type="button" class="np-hbar__btn" data-proto-action="proto.unpin">Clear</button></section>` : '';
    host.innerHTML = `${pinned}<h3>On this view · ${rows.length} kinds</h3><p class="np-hp__hint">Every element carries <code>data-component</code>; primitives add <code>data-primitive</code>. Click a row to highlight it.</p><ul class="np-hp__list">${rows.map((r) => `<li><button type="button" class="np-hp__row" data-hl="${NP.esc(r.id)}" data-hl-prim="${NP.esc(r.prim || '')}"><code>${NP.esc(r.id.replace('cpt-noter-component-', ''))}${r.prim ? ' · ' + NP.esc(r.prim) : ''}</code><span class="np-hp__count">${r.count}</span>${r.variants.size ? `<span class="np-hp__meta">variants: ${NP.esc([...r.variants].join(', '))}</span>` : ''}${r.states.size ? `<span class="np-hp__meta">states: ${NP.esc([...r.states].join(', '))}</span>` : ''}</button></li>`).join('')}</ul>`;
    host.querySelectorAll('[data-hl]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-hl'); const pr = b.getAttribute('data-hl-prim');
      const sel = '[data-component="' + id + '"]' + (pr ? '[data-primitive="' + pr + '"]' : '');
      const found = document.querySelectorAll('.np-desk ' + sel);
      found.forEach((e) => { e.classList.add('np-flash-hl'); setTimeout(() => e.classList.remove('np-flash-hl'), 1600); });
      if (found[0]) found[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
  };
  NP.onAfterRender(fillPanel);
  NP.on('proto.unpin', () => { state.pinned = null; });
})();
