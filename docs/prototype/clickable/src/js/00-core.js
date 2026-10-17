/* =====================================================================
   Noter clickable prototype — core runtime
   Prototype-only plumbing. Nothing in this file is product UI.
   Handoff contract: see README.md (data-component, data-primitive,
   data-variant, data-state, data-region). Attributes prefixed
   data-proto-* belong to the prototype runtime and must be ignored
   by development.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Raw HTML + auto-escaping template tag ---------- */
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const val = (v) => {
    if (v == null || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(val).join('');
    return esc(v);
  };
  /** html`...` — interpolated strings are escaped, Raw/arrays pass through. */
  const html = (strings, ...vals) => {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
    return new Raw(out);
  };
  const raw = (s) => new Raw(String(s == null ? '' : s));
  const join = (arr, sep) => raw(arr.filter((x) => x != null && x !== false && x !== '').map(val).join(sep ? val(sep) : ''));

  /** attrs({a:1, b:true, c:null}) -> ' a="1" b' (Raw). */
  const attrs = (obj) => {
    if (!obj) return raw('');
    let s = '';
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v == null || v === false) continue;
      if (v === true) s += ' ' + k;
      else s += ' ' + k + '="' + esc(typeof v === 'object' ? JSON.stringify(v) : v) + '"';
    }
    return raw(s);
  };

  /* ---------- Component ids ---------- */
  const cid = (key) => (key.startsWith('cpt-') ? key : 'cpt-noter-component-ui-' + key);
  const sid = (key) => (key.startsWith('cpt-') ? key : 'cpt-noter-component-screen-' + key);

  /**
   * comp('copilot-card', {variant, state, region, tag, cls, attrs}, inner)
   * Root element of a DESIGN complex component (index table B).
   */
  const comp = (key, o, inner) => {
    o = o || {};
    const tag = o.tag || 'div';
    return html`<${raw(tag)}${attrs(Object.assign({
      'data-component': cid(key),
      'data-variant': o.variant,
      'data-state': o.state,
      'data-region': o.region,
      class: o.cls,
    }, o.attrs || {}))}>${inner}</${raw(tag)}>`;
  };
  /** region('TD-R3', {cls, tag, label}, inner) — a layout region of a screen. */
  const region = (code, o, inner) => {
    o = o || {};
    const tag = o.tag || 'section';
    return html`<${raw(tag)}${attrs(Object.assign({ 'data-region': code, class: o.cls, 'aria-label': o.label }, o.attrs || {}))}>${inner}</${raw(tag)}>`;
  };

  /* ---------- State ---------- */
  const loadPref = (k, d) => { try { const v = localStorage.getItem('noter-proto:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem('noter-proto:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  const state = {
    theme: loadPref('theme', 'system'),         // system | light | dark
    contrast: null,                              // null (follow macOS) | 'more' (Increase Contrast)
    inspect: false,                              // handoff inspector overlay
    handoffPanel: false,                         // component list panel
    surface: 'main',                             // main | call | record | menubar | firstrun | settings | notifications
    route: { screen: 'today', params: {} },
    history: [{ screen: 'today', params: {} }],
    hIndex: 0,
    sidebar: true,
    inspector: null,                             // {kind, props}
    sheet: null,                                 // {id, props}
    alert: null,                                 // {title, body, buttons:[{label, variant, action, args}]}
    popover: null,                               // {id, anchor, props}
    menu: null,                                  // {anchor, items}
    undo: null,                                  // {message, context, label, action, args, at}
    flash: {},                                   // key -> {text, until}
    demo: {},                                    // screen/surface key -> demo state id
    local: {},                                   // screen key -> local state object
    banners: [],                                 // app-level banners for MW-R5 (set by screens' demo states)
    setup: { micGranted: true, sysGranted: true, selfTestPassed: true, assistant: 'api-key' },   // PM-60: no flag here ever blocks a start
    rec: {                                       // live capture scenario
      status: 'idle',                            // idle | recording | paused | closing
      callId: 'c-live',
      startedAt: 0,
      pausedAt: 0,
      mode: 'Cloud, redacted',
      layout: 'dedicated',                       // dedicated | floating | collapsed
    },
  };

  /* ---------- Registries ---------- */
  const screens = {};      // main-window pages
  const surfaces = {};     // top-level windows/surfaces
  const overlays = {};     // sheets / popovers by id
  const inspectors = {};   // MW-R4 inspector renderers by kind
  const actions = {};      // action name -> fn(args, ev, el) ; return false to skip re-render
  const galleries = { dialogs: [] };

  const screen = (key, def) => { def.key = key; def.id = def.id || sid(def.idKey || key); screens[key] = def; return def; };
  const surface = (key, def) => { def.key = key; surfaces[key] = def; return def; };
  const overlay = (id, def) => { overlays[id] = def; return def; };
  const inspector = (kind, def) => { inspectors[kind] = def; return def; };
  const on = (name, fn) => { actions[name] = fn; };
  const on_ = (obj) => Object.keys(obj).forEach((k) => on(k, obj[k]));

  /** act('name', args) -> attribute string for a clickable element. */
  const act = (name, args) => attrs({ 'data-proto-action': name, 'data-proto-args': args == null ? null : JSON.stringify(args) });

  /** Per-screen local view state (in-memory only, like the real window store's view state). */
  const local = (key, init) => {
    if (!state.local[key]) state.local[key] = typeof init === 'function' ? init() : Object.assign({}, init || {});
    else if (init) {
      const defs = typeof init === 'function' ? init() : init;
      if (defs && typeof defs === 'object') Object.keys(defs).forEach((k) => { if (!(k in state.local[key])) state.local[key][k] = defs[k]; });
    }
    return state.local[key];
  };
  const demo = (key) => state.demo[key] || 'default';

  /* ---------- Navigation ---------- */
  const go = (screenKey, params, opts) => {
    opts = opts || {};
    state.surface = 'main';
    const r = { screen: screenKey, params: params || {} };
    if (!opts.replace) {
      state.history = state.history.slice(0, state.hIndex + 1);
      state.history.push(r);
      state.hIndex = state.history.length - 1;
    } else {
      state.history[state.hIndex] = r;
    }
    state.route = r;
    if (!opts.keepInspector) state.inspector = null;
    state.popover = null; state.menu = null;
    window.scrollTo && document.querySelector('[data-proto-scroll="content"]') && (document.querySelector('[data-proto-scroll="content"]').scrollTop = 0);
    render();
  };
  const back = () => { if (state.hIndex > 0) { state.hIndex--; state.route = state.history[state.hIndex]; state.inspector = null; render(); } };
  const forward = () => { if (state.hIndex < state.history.length - 1) { state.hIndex++; state.route = state.history[state.hIndex]; state.inspector = null; render(); } };
  const show = (surfaceKey) => { state.surface = surfaceKey; state.popover = null; state.menu = null; render(); };

  /* ---------- Overlays ---------- */
  const openSheet = (id, props) => { state.sheet = { id, props: props || {} }; state.popover = null; state.menu = null; render(); };
  const closeSheet = () => { state.sheet = null; render(); };
  const openAlert = (a) => { state.alert = a; state.popover = null; state.menu = null; render(); };
  const closeAlert = () => { state.alert = null; render(); };
  const openPopover = (id, anchor, props) => { state.popover = { id, anchor, props: props || {} }; state.menu = null; render(); };
  const closePopover = () => { state.popover = null; render(); };
  const openMenu = (anchor, items) => { state.menu = { anchor, items }; state.popover = null; render(); };
  const openInspector = (kind, props) => { state.inspector = { kind, props: props || {} }; render(); };
  const closeInspector = () => { state.inspector = null; render(); };

  /** Undo strip (cpt-noter-component-ui-undo-strip). */
  const undo = (message, opts) => {
    opts = opts || {};
    state.undo = { message, context: opts.context, label: opts.label || 'Undo', action: opts.action, args: opts.args, redoAction: opts.redoAction, redoMessage: opts.redoMessage, at: Date.now(), where: opts.where || 'main' };
    const at = state.undo.at;
    setTimeout(() => { if (state.undo && state.undo.at === at && !state.undo.hover) { state.undo = null; render(); } }, opts.ms || 10000);
  };
  /** Inline status (cpt-noter-component-ui-inline-status): flash(key, text, ms). */
  const flash = (key, text, ms) => {
    const until = Date.now() + (ms || 2000);
    state.flash[key] = { text, until };
    setTimeout(() => { const f = state.flash[key]; if (f && f.until === until) { delete state.flash[key]; render(); } }, (ms || 2000) + 20);
  };
  const flashed = (key) => (state.flash[key] ? state.flash[key].text : null);

  /* ---------- Recording clock ---------- */
  const elapsedMs = () => {
    const r = state.rec;
    if (r.status === 'idle') return 0;
    const now = r.status === 'paused' ? r.pausedAt : Date.now();
    return Math.max(0, now - r.startedAt);
  };
  const fmtClock = (ms, short) => {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const p = (n) => String(n).padStart(2, '0');
    return short && h === 0 ? `${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
  };
  /** A live-updating clock span. */
  const clock = (short) => html`<span class="np-tnum"${attrs({ 'data-proto-clock': short ? 'short' : 'long' })}>${fmtClock(elapsedMs(), short)}</span>`;
  /** A new capture from Today, the record prompt or the menu bar: default layout, normal call-window state. */
  const freshCall = () => { state.rec.layout = 'dedicated'; delete state.demo.call; delete state.local.cw; };
  const startRecording = (opts) => {
    opts = opts || {};
    Object.assign(state.rec, { status: 'recording', startedAt: Date.now() - (opts.offsetMs != null ? opts.offsetMs : 23 * 60000 + 14000), pausedAt: 0 });
    if (opts.callId) state.rec.callId = opts.callId;
    if (opts.layout) state.rec.layout = opts.layout;
  };

  /* ---------- Rendering ---------- */
  let root = null;
  let scheduled = false;
  const afterRender = [];
  const onAfterRender = (fn) => afterRender.push(fn);

  const render = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; renderNow(); });
  };
  const renderNow = () => {
    if (!root) return;
    // keep focus + selection + scroll positions
    const ae = document.activeElement;
    const focusId = ae && ae.id && root.contains(ae) ? ae.id : null;
    let selStart = null, selEnd = null;
    try { if (focusId && 'selectionStart' in ae) { selStart = ae.selectionStart; selEnd = ae.selectionEnd; } } catch (e) { /* */ }
    const scrolls = {};
    root.querySelectorAll('[data-proto-scroll]').forEach((el) => { scrolls[el.getAttribute('data-proto-scroll')] = [el.scrollTop, el.scrollLeft]; });

    applyTheme();
    root.innerHTML = String(NP.shell.harness());

    root.querySelectorAll('[data-proto-scroll]').forEach((el) => {
      const s = scrolls[el.getAttribute('data-proto-scroll')];
      if (s) { el.scrollTop = s[0]; el.scrollLeft = s[1]; }
    });
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { try { el.focus({ preventScroll: true }); if (selStart != null) el.setSelectionRange(selStart, selEnd); } catch (e) { /* */ } }
    }
    positionFloating();
    afterRender.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    if (state.inspect) NP.inspectTool && NP.inspectTool.refresh();
  };

  const applyTheme = () => {
    const d = document.documentElement;
    if (state.theme === 'system') d.removeAttribute('data-theme'); else d.setAttribute('data-theme', state.theme);
    if (state.contrast) d.setAttribute('data-contrast', state.contrast); else d.removeAttribute('data-contrast');
  };

  /** Position popovers and menus next to their anchors (data-proto-anchor). */
  const positionFloating = () => {
    root.querySelectorAll('[data-proto-float]').forEach((fl) => {
      const id = fl.getAttribute('data-proto-float');
      const anchor = root.querySelector('[data-proto-anchor="' + id + '"]');
      const layer = fl.offsetParent || document.body;
      const lr = layer.getBoundingClientRect();
      let top = layer.scrollTop + 80, left = Math.max(8, (layer.clientWidth - fl.offsetWidth) / 2 + layer.scrollLeft);
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        const fw = fl.offsetWidth, fh = fl.offsetHeight;
        left = r.left - lr.left + layer.scrollLeft;
        top = r.bottom - lr.top + 6 + layer.scrollTop;
        if (fl.getAttribute('data-proto-align') === 'end') left = r.right - lr.left - fw + layer.scrollLeft;
        const maxLeft = layer.scrollWidth - fw - 8;
        if (left > maxLeft) left = Math.max(8, maxLeft);
        if (left < 8) left = 8;
        const viewBottom = lr.top + layer.clientHeight;
        if (r.bottom + fh + 12 > Math.max(viewBottom, window.innerHeight) && r.top - lr.top - fh - 6 > 0) top = r.top - lr.top - fh - 6 + layer.scrollTop;
      }
      fl.style.left = left + 'px';
      fl.style.top = top + 'px';
      fl.style.visibility = 'visible';
    });
  };

  /* ---------- Events ---------- */
  const parseArgs = (el) => { const a = el.getAttribute('data-proto-args'); if (!a) return undefined; try { return JSON.parse(a); } catch (e) { return a; } };
  const runAction = (el, ev) => {
    const name = el.getAttribute('data-proto-action');
    const fn = actions[name];
    if (!fn) { console.warn('[proto] no action', name); flash('proto-missing', 'Not wired in the prototype: ' + name, 1800); render(); return; }
    const res = fn(parseArgs(el), ev, el);
    if (res !== false) render();
  };

  const setPath = (path, value) => {
    const parts = path.split('.');
    let o = state;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = value;
  };
  const getPath = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state);

  const bindEvents = () => {
    root.addEventListener('click', (ev) => {
      if (state.inspect && NP.inspectTool && NP.inspectTool.click(ev)) return;
      const t = ev.target;
      // close floating layers on outside click
      if ((state.popover || state.menu) && !t.closest('[data-proto-float]') && !t.closest('[data-proto-anchor]')) {
        state.popover = null; state.menu = null;
        if (!t.closest('[data-proto-action]')) { render(); return; }
      }
      const el = t.closest('[data-proto-action]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (el.matches('input[type=checkbox],input[type=radio]') ) { /* handled by change */ return; }
      if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'FORM') ev.preventDefault();
      if (el.tagName === 'SELECT') return;
      ev.stopPropagation();
      if (el.closest('.np-menu') && el.getAttribute('data-proto-action') !== 'proto.menu') state.menu = null;
      runAction(el, ev);
    });
    root.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.matches('[data-proto-bind]')) {
        const p = el.getAttribute('data-proto-bind');
        setPath(p, el.type === 'checkbox' ? el.checked : el.value);
        if (!el.hasAttribute('data-proto-action')) { render(); return; }
      }
      if (el.matches('[data-proto-action]') && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'range')) {
        const name = el.getAttribute('data-proto-action');
        const fn = actions[name];
        if (fn) { const res = fn(Object.assign({}, parseArgs(el) || {}, { value: el.type === 'checkbox' ? el.checked : el.value }), ev, el); if (res !== false) render(); }
      }
    });
    root.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.matches('[data-proto-bind]') && el.type !== 'checkbox') {
        setPath(el.getAttribute('data-proto-bind'), el.value);
        if (el.hasAttribute('data-proto-live')) render();
      }
    });
    root.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target.closest('[data-proto-action]');
      if (f) runAction(f, ev);
    });
    root.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (ev.key === 'Enter' && el.matches('input[data-proto-enter]')) {
        ev.preventDefault();
        const name = el.getAttribute('data-proto-enter');
        const fn = actions[name];
        if (fn) { const res = fn(Object.assign({}, parseArgs(el) || {}, { value: el.value }), ev, el); if (res !== false) render(); }
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (state.inspect) { state.inspect = false; render(); return; }
        if (state.menu || state.popover) { state.menu = null; state.popover = null; render(); return; }
        if (state.alert) { state.alert = null; render(); return; }
        if (state.sheet) { state.sheet = null; render(); return; }
        if (state.inspector) { state.inspector = null; render(); return; }
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      if (typing) return;
      // ⌃1..⌃8 (⌘1..⌘8 belongs to the browser) — prototype aliases of the sidebar keys
      if (ev.ctrlKey && !ev.metaKey && /^[1-8]$/.test(ev.key) && state.surface === 'main') {
        const k = ['today', 'ask', 'library', 'people', 'topics', 'activity', 'agents', 'performance'][+ev.key - 1];
        ev.preventDefault(); NP.shell.goSection(k);
      }
      if (ev.ctrlKey && ev.key === '[') { ev.preventDefault(); back(); }
      if (ev.ctrlKey && ev.key === ']') { ev.preventDefault(); forward(); }
    });
    root.addEventListener('mouseover', (ev) => { if (state.inspect && NP.inspectTool) NP.inspectTool.hover(ev); });
    // pause undo strip while hovered (DESIGN: undo strip pauses while hovered)
    root.addEventListener('mouseenter', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-component="cpt-noter-component-ui-undo-strip"]') && state.undo) state.undo.hover = true;
    }, true);
    root.addEventListener('mouseleave', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-component="cpt-noter-component-ui-undo-strip"]') && state.undo) {
        state.undo.hover = false; const at = state.undo.at = Date.now();
        setTimeout(() => { if (state.undo && state.undo.at === at && !state.undo.hover) { state.undo = null; render(); } }, 10000);
      }
    }, true);
    window.addEventListener('resize', () => positionFloating());
  };

  const tick = () => {
    if (state.rec.status === 'recording' || state.rec.status === 'paused') {
      const ms = elapsedMs();
      root.querySelectorAll('[data-proto-clock]').forEach((el) => { el.textContent = fmtClock(ms, el.getAttribute('data-proto-clock') === 'short'); });
    }
  };

  const boot = () => {
    root = document.getElementById('np-root');
    bindEvents();
    // deep link: #screen-key
    const h = (location.hash || '').replace('#', '');
    if (h && screens[h]) { state.route = { screen: h, params: {} }; state.history = [state.route]; }
    else if (h && surfaces[h]) state.surface = h;
    renderNow();
    setInterval(tick, 1000);
    try { if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render()); } catch (e) { /* */ }
  };

  const NP = window.NP = {
    Raw, html, raw, esc, join, attrs, cid, sid, comp, region,
    state, screens, surfaces, overlays, inspectors, actions, galleries,
    screen, surface, overlay, inspector, on, on: on, onMany: on_, act, local, demo,
    go, back, forward, show,
    openSheet, closeSheet, openAlert, closeAlert, openPopover, closePopover, openMenu, openInspector, closeInspector,
    undo, flash, flashed, clock, fmtClock, elapsedMs, startRecording, freshCall,
    render, renderNow, onAfterRender, setPath, getPath, savePref, loadPref, boot,
    data: {}, C: {}, P: {}, shell: {},
  };
})();
