/* =====================================================================
   Primitives — cpt-noter-component-ui-primitives (DESIGN 3.2, 26 primitives)
   Every primitive root carries:
     data-component="cpt-noter-component-ui-primitives"
     data-primitive="<push-button|icon-button|...>"
     data-variant / data-size / data-state where they apply
   Common option keys for clickable primitives:
     action: 'name' | ['name', args]   -> prototype click handler
     id, cls, attrs (extra attributes), help (help tag text), disabled
   ===================================================================== */
(function () {
  const { html, raw, attrs, act, icon, esc } = NP;
  const PRIM = 'cpt-noter-component-ui-primitives';

  const actAttrs = (a) => {
    if (!a) return raw('');
    if (Array.isArray(a)) return act(a[0], a[1]);
    return act(a);
  };
  const base = (prim, o, extra) => attrs(Object.assign({
    'data-component': PRIM,
    'data-primitive': prim,
    'data-variant': o.variant,
    'data-size': o.size,
    'data-state': o.state,
    'data-region': o.region,
    id: o.id,
    title: o.help,
  }, extra || {}, o.attrs || {}));

  /** key-cap: kbd('⌃⌥⌘R') */
  const kbd = (keys, o) => { o = o || {}; return html`<kbd${base('key-cap', { variant: keys.length > 1 ? 'chord' : 'single' })} class="np-kbd${o.cls ? ' ' + o.cls : ''}" aria-hidden="true">${keys}</kbd>`; };

  /**
   * push-button. variant: secondary (default) | primary | quiet | destructive
   * size: small | regular (default) | large. icon, kbd, loading, disabled, anchor (popover anchor id)
   */
  const button = (label, o) => {
    o = o || {};
    const variant = o.variant || 'secondary';
    const size = o.size || 'regular';
    const state = o.loading ? 'loading' : o.disabled ? 'disabled' : o.state;
    const flash = o.flashKey && NP.flashed(o.flashKey);
    return html`<button type="${o.submit ? 'submit' : 'button'}" class="np-btn np-btn--${variant} np-btn--${size}${o.cls ? ' ' + o.cls : ''}"${base('push-button', Object.assign({}, o, { variant, size, state }), {
      disabled: o.disabled ? true : null,
      'aria-keyshortcuts': o.shortcut,
      'aria-label': o.ariaLabel,
      'data-proto-anchor': o.anchor,
      'aria-expanded': o.expanded == null ? null : String(!!o.expanded),
    })}${actAttrs(o.action)}>${o.loading ? raw('<span class="np-spin" aria-hidden="true"></span>') : (o.icon ? icon(o.icon, { size: size === 'small' ? 12 : 14 }) : '')}${flash ? html`<span class="np-btn__flash">${icon('check', { size: 12 })}${flash}</span>` : html`<span>${label}</span>`}${o.kbd ? kbd(o.kbd) : ''}${o.chevron ? icon('chevronDown', { size: 10, cls: 'np-btn__chev' }) : ''}</button>`;
  };

  /** icon-button. label is required (VoiceOver + help tag). size: toolbar | inline */
  const iconButton = (name, o) => {
    o = o || {};
    const size = o.size || 'toolbar';
    return html`<button type="button" class="np-ibtn np-ibtn--${size}${o.on ? ' is-on' : ''}${o.cls ? ' ' + o.cls : ''}"${base('icon-button', Object.assign({}, o, { size, state: o.disabled ? 'disabled' : o.state }), {
      'aria-label': o.label, title: o.help || o.label, 'data-help-tag': o.help || o.label, disabled: o.disabled ? true : null,
      'aria-pressed': o.pressed == null ? null : String(!!o.pressed),
      'data-proto-anchor': o.anchor,
    })}${actAttrs(o.action)}>${icon(name, { size: size === 'inline' ? 13 : 15 })}${o.badge ? html`<span class="np-ibtn__badge">${o.badge}</span>` : ''}</button>`;
  };

  /** segmented-control. items: [{value,label,icon}]; variant: view | option */
  const segmented = (items, value, o) => {
    o = o || {};
    const variant = o.variant || 'view';
    return html`<div class="np-seg${o.cls ? ' ' + o.cls : ''}" role="${variant === 'view' ? 'tablist' : 'radiogroup'}"${base('segmented-control', Object.assign({}, o, { variant }), { 'aria-label': o.label })}>${items.map((it) => {
      const v = typeof it === 'string' ? it : it.value;
      const l = typeof it === 'string' ? it : it.label;
      const sel = v === value;
      return html`<button type="button" class="np-seg__item${sel ? ' is-sel' : ''}" role="${variant === 'view' ? 'tab' : 'radio'}" aria-selected="${String(sel)}" ${o.action ? act(Array.isArray(o.action) ? o.action[0] : o.action, Object.assign({}, Array.isArray(o.action) ? o.action[1] : {}, { value: v })) : ''}>${it.icon ? icon(it.icon, { size: 13 }) : ''}${l}${it.count != null ? html` <span class="np-seg__count">${it.count}</span>` : ''}</button>`;
    })}</div>`;
  };

  /** popup-button (native select). options: [{value,label}] | strings. action receives {value}. */
  const popup = (options, value, o) => {
    o = o || {};
    return html`<span class="np-popup np-popup--${o.variant || 'form'}${o.cls ? ' ' + o.cls : ''}"${base('popup-button', Object.assign({ variant: o.variant || 'form' }, o, { id: null }))}><select${attrs({ id: o.id, 'aria-label': o.label, disabled: o.disabled ? true : null, 'data-proto-bind': o.bind })}${actAttrs(o.action)}>${options.map((op) => {
      const v = typeof op === 'string' ? op : op.value; const l = typeof op === 'string' ? op : op.label;
      return html`<option value="${v}"${v === value ? raw(' selected') : ''}${op.disabled ? raw(' disabled') : ''}>${l}</option>`;
    })}</select>${icon('updown', { size: 11, cls: 'np-popup__chev' })}</span>`;
  };

  /**
   * pull-down-button: a button that opens a menu.
   * items: [{label, action:['name',args], kbd, destructive, disabled, divider, submenu:[...] , checked}]
   */
  const pulldown = (label, items, o) => {
    o = o || {};
    const anchorId = o.anchorId || ('pd-' + (o.id || label).toString().replace(/\W+/g, '-').toLowerCase());
    const open = NP.state.menu && NP.state.menu.anchor === anchorId;
    const inner = o.iconOnly
      ? iconButton(o.icon || 'ellipsis', { label: o.ariaLabel || label, size: o.size || 'inline', action: ['proto.menu', { anchor: anchorId }], anchor: anchorId, cls: o.cls, help: o.help, attrs: { 'data-primitive': 'pull-down-button', 'aria-haspopup': 'menu', 'aria-expanded': String(open), 'data-variant': o.variant || 'item-menu' } })
      : button(label, { variant: o.buttonVariant || 'secondary', size: o.size, icon: o.icon, chevron: true, cls: o.cls, action: ['proto.menu', { anchor: anchorId }], anchor: anchorId, expanded: open, attrs: { 'data-primitive': 'pull-down-button', 'aria-haspopup': 'menu', 'data-variant': o.variant || 'toolbar' } });
    NP._menus[anchorId] = items;
    return inner;
  };
  NP._menus = {};

  /** menu (rendered by the shell into the floating layer) */
  const menu = (items, o) => {
    o = o || {};
    return html`<div class="np-menu" role="menu"${base('menu', { variant: o.variant || 'item-menu' })}>${items.map((it) => {
      if (it.divider) return raw('<div class="np-menu__sep" role="separator"></div>');
      if (it.header) return html`<div class="np-menu__hdr">${it.header}</div>`;
      return html`<button type="button" role="menuitem" class="np-menu__item${it.destructive ? ' is-danger' : ''}"${attrs({ disabled: it.disabled ? true : null, 'aria-checked': it.checked == null ? null : String(!!it.checked) })}${actAttrs(it.action)}><span class="np-menu__check">${it.checked ? icon('check', { size: 12 }) : ''}</span><span class="np-menu__label">${it.label}</span>${it.submenu ? icon('chevronRight', { size: 11 }) : ''}${it.kbd ? html`<span class="np-menu__kbd">${it.kbd}</span>` : ''}</button>`;
    })}</div>`;
  };

  /** checkbox. action receives {value: checked}. */
  const checkbox = (label, checked, o) => {
    o = o || {};
    const state = o.mixed ? 'mixed' : checked ? 'on' : 'off';
    return html`<label class="np-check${o.cls ? ' ' + o.cls : ''}${o.disabled ? ' is-disabled' : ''}"${base('checkbox', Object.assign({ variant: o.variant || 'single' }, o, { id: null, state }))}><input type="checkbox"${attrs({ id: o.id, checked: !!checked, disabled: o.disabled ? true : null, 'data-proto-bind': o.bind, 'aria-label': label ? null : o.ariaLabel, 'aria-checked': o.mixed ? 'mixed' : null })}${actAttrs(o.action)}><span class="np-check__box" aria-hidden="true">${o.mixed ? icon('minus', { size: 11 }) : checked ? icon('check', { size: 11 }) : ''}</span>${label ? html`<span class="np-check__label">${label}</span>` : ''}</label>`;
  };

  /** toggle (switch). size: regular | small */
  const toggle = (label, on, o) => {
    o = o || {};
    return html`<label class="np-toggle np-toggle--${o.size || 'regular'}${o.cls ? ' ' + o.cls : ''}${o.disabled ? ' is-disabled' : ''}"${base('toggle', Object.assign({ size: o.size || 'regular' }, o, { id: null, state: on ? 'on' : 'off' }))}>${label && !o.labelAfter ? html`<span class="np-toggle__label">${label}</span>` : ''}<input type="checkbox" role="switch"${attrs({ id: o.id, checked: !!on, disabled: o.disabled ? true : null, 'data-proto-bind': o.bind, 'aria-label': label ? null : o.ariaLabel })}${actAttrs(o.action)}><span class="np-toggle__track" aria-hidden="true"><span class="np-toggle__thumb"></span></span>${label && o.labelAfter ? html`<span class="np-toggle__label">${label}</span>` : ''}</label>`;
  };

  /** radio-group. options: [{value,label,note}] */
  const radioGroup = (name, options, value, o) => {
    o = o || {};
    return html`<div class="np-radios${o.cls ? ' ' + o.cls : ''}" role="radiogroup"${base('radio-group', Object.assign({ variant: 'vertical' }, o), { 'aria-label': o.label })}>${options.map((op) => html`<label class="np-radio"><input type="radio" name="${name}" value="${op.value}"${op.value === value ? raw(' checked') : ''}${op.disabled ? raw(' disabled') : ''}${attrs({ 'data-proto-bind': o.bind })}${actAttrs(o.action)}><span class="np-radio__dot" aria-hidden="true"></span><span><span class="np-radio__label">${op.label}</span>${op.note ? html`<span class="np-radio__note">${op.note}</span>` : ''}</span></label>`)}</div>`;
  };

  /**
   * text-field. variant: single | multi | secure | number | date
   * bind: state path ('local.ask.q'), live: re-render on input, enter: action name on Return
   */
  const textField = (o) => {
    o = o || {};
    const variant = o.variant || (o.multiline ? 'multi' : 'single');
    const state = o.invalid ? 'invalid' : o.disabled ? 'disabled' : o.readonly ? 'read-only' : null;
    const common = attrs({ id: o.id, placeholder: o.placeholder, disabled: o.disabled ? true : null, readonly: o.readonly ? true : null, 'aria-label': o.ariaLabel || o.label, 'aria-invalid': o.invalid ? 'true' : null, 'data-proto-bind': o.bind, 'data-proto-live': o.live ? true : null, 'data-proto-enter': o.enter, lang: o.lang, spellcheck: o.mono ? 'false' : null });
    const field = variant === 'multi'
      ? html`<textarea class="np-field__input${o.mono ? ' np-mono' : ''}" rows="${o.rows || 3}"${common}>${o.value || ''}</textarea>`
      : html`<input class="np-field__input${o.mono ? ' np-mono' : ''}" type="${variant === 'secure' ? 'password' : variant === 'number' ? 'number' : variant === 'date' ? 'date' : 'text'}" value="${o.value == null ? '' : o.value}"${common}${attrs({ min: o.min, max: o.max, step: o.step })}>`;
    return html`<span class="np-field np-field--${variant}${o.invalid ? ' is-invalid' : ''}${o.cls ? ' ' + o.cls : ''}"${base('text-field', Object.assign({}, o, { variant, state, id: null }))}>${o.label && o.showLabel ? html`<span class="np-field__label">${o.label}</span>` : ''}${field}${o.trailing || ''}${o.invalid && o.message ? html`<span class="np-field__msg">${icon('error', { size: 12 })}${o.message}</span>` : ''}</span>`;
  };

  /**
   * search-field. variant: plain | tokens | token-field
   * tokens: [{label, kind}] ; tokenAction: action to remove ({index})
   */
  const searchField = (o) => {
    o = o || {};
    const variant = o.variant || (o.tokens ? 'tokens' : 'plain');
    const state = o.state || (o.value ? 'typing' : (o.tokens && o.tokens.length ? 'tokens' : 'empty'));
    return html`<label class="np-search np-search--${variant}${o.cls ? ' ' + o.cls : ''}"${base('search-field', Object.assign({}, o, { variant, state, id: null }))}>${variant !== 'token-field' ? icon('search', { size: 13, cls: 'np-search__icon' }) : ''}${(o.tokens || []).map((t, i) => html`<span class="np-token" data-token-kind="${t.kind || 'filter'}">${t.label}<button type="button" class="np-token__x" aria-label="Remove ${t.label}"${o.tokenAction ? act(o.tokenAction, { index: i }) : ''}>${icon('x', { size: 9 })}</button></span>`)}<input type="search"${attrs({ id: o.id, placeholder: o.placeholder, value: o.value || '', 'aria-label': o.ariaLabel || o.placeholder, 'data-proto-bind': o.bind, 'data-proto-live': o.live ? true : null, 'data-proto-enter': o.enter, autocomplete: 'off' })}></label>`;
  };

  /** slider with a paired number field */
  const slider = (o) => {
    o = o || {};
    return html`<span class="np-slider"${base('slider', Object.assign({ variant: 'with-field' }, o, { id: null }))}><input type="range"${attrs({ id: o.id, min: o.min || 0, max: o.max || 100, step: o.step || 1, value: o.value, 'aria-label': o.label, 'aria-valuetext': o.valueText || (o.value + (o.unit || '')) })}${actAttrs(o.action)}><span class="np-field np-field--number" data-primitive="text-field" data-variant="number"><input class="np-field__input np-tnum" type="number"${attrs({ value: o.value, min: o.min, max: o.max, 'aria-label': o.label })}${actAttrs(o.action)}></span>${o.unit ? html`<span class="np-slider__unit">${o.unit}</span>` : ''}</span>`;
  };

  /** progress: variant bar | spinner ; value 0..100 or null for indeterminate */
  const progress = (o) => {
    o = o || {};
    if (o.variant === 'spinner') return html`<span class="np-spin${o.cls ? ' ' + o.cls : ''}" role="progressbar" aria-label="${o.label || 'Working'}"${base('progress', { variant: 'spinner', state: o.state || 'running' })}></span>`;
    const ind = o.value == null;
    return html`<span class="np-progress${ind ? ' is-ind' : ''}${o.cls ? ' ' + o.cls : ''}" role="progressbar"${base('progress', { variant: ind ? 'indeterminate' : 'determinate', state: o.state || 'running' }, { 'aria-valuenow': ind ? null : o.value, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': o.label, 'aria-valuetext': ind ? null : o.value + ' percent' })}><span class="np-progress__fill" style="width:${ind ? 40 : Math.max(0, Math.min(100, o.value))}%"></span></span>`;
  };

  /** level-meter: 10 segments; level 0..10; clipping */
  const levelMeter = (o) => {
    o = o || {};
    const lvl = o.level || 0;
    const state = o.clipping ? 'clipping' : lvl > 0 ? 'signal' : 'silent';
    return html`<span class="np-meter"${base('level-meter', { variant: 'horizontal', state })} role="meter" aria-label="${o.label || 'Level'}" aria-valuenow="${lvl * 10}" aria-valuemin="0" aria-valuemax="100">${Array.from({ length: 10 }, (_, i) => html`<span class="np-meter__seg${i < lvl ? ' is-on' : ''}${o.clipping && i === 9 ? ' is-clip' : ''}"></span>`)}</span>`;
  };

  /** badge: kind count | kind | status ; tone neutral | info | warning | error | success | accent */
  const badge = (text, o) => {
    o = o || {};
    const kind = o.kind || 'status';
    const tone = o.tone || 'neutral';
    return html`<span class="np-badge np-badge--${kind} np-badge--${tone}${o.cls ? ' ' + o.cls : ''}"${base('badge', Object.assign({ variant: kind + (kind === 'status' ? '-' + tone : '') }, o), { title: o.help })}>${o.icon ? icon(o.icon, { size: 11 }) : ''}${text}</span>`;
  };

  /** disclosure triangle. variant section | row */
  const disclosure = (label, open, o) => {
    o = o || {};
    return html`<button type="button" class="np-disc np-disc--${o.variant || 'section'}${open ? ' is-open' : ''}${o.cls ? ' ' + o.cls : ''}" aria-expanded="${String(!!open)}"${base('disclosure', Object.assign({ variant: o.variant || 'section' }, o, { state: open ? 'expanded' : 'collapsed' }))}${actAttrs(o.action)}>${icon('chevronRight', { size: 11, cls: 'np-disc__tri' })}<span>${label}</span>${o.trailing || ''}</button>`;
  };

  /** link. variant inline | external */
  const link = (label, o) => {
    o = o || {};
    const ext = !!o.external;
    return html`<a href="${o.href || '#'}" class="np-link${o.cls ? ' ' + o.cls : ''}"${base('link', Object.assign({ variant: ext ? 'external' : 'inline' }, o), { 'aria-label': o.ariaLabel, lang: o.lang })}${actAttrs(o.action)}>${o.icon ? icon(o.icon, { size: 12 }) : ''}${label}${ext ? html`<span class="np-link__ext" aria-hidden="true">↗</span>` : ''}</a>`;
  };

  /** tooltip / help tag — we rely on title=, this marks a help-tag target explicitly */
  const helpTag = (text) => attrs({ title: text, 'data-help-tag': text });

  /** table wrapper. Usage: table({variant:'sortable', label}, html`<thead>…</thead><tbody>…</tbody>`) */
  const table = (o, inner) => {
    o = o || {};
    return html`<div class="np-table-wrap${o.wrapCls ? ' ' + o.wrapCls : ''}" ${raw(o.scrollKey ? `data-proto-scroll="${esc(o.scrollKey)}"` : '')}><table class="np-table${o.cls ? ' ' + o.cls : ''}"${base('table', Object.assign({ variant: o.variant || 'sortable' }, o, { id: null }), { 'aria-label': o.label })}>${inner}</table></div>`;
  };
  /** sortable header cell */
  const th = (label, o) => {
    o = o || {};
    return html`<th scope="col"${attrs({ class: o.cls, 'aria-sort': o.sort ? (o.sort === 'asc' ? 'ascending' : 'descending') : null, style: o.width ? 'width:' + o.width : null })}${actAttrs(o.action)}>${label}${o.sort ? icon(o.sort === 'asc' ? 'chevronUp' : 'chevronDown', { size: 10, cls: 'np-th__sort' }) : ''}</th>`;
  };

  /** split-divider (decorative in the prototype) */
  const splitDivider = () => html`<div class="np-split" role="separator" aria-orientation="vertical"${base('split-divider', { variant: 'vertical' })}></div>`;

  /** toolbar group helper */
  const toolbarSpacer = () => raw('<span class="np-tb__spacer"></span>');

  Object.assign(NP.P, { kbd, button, iconButton, segmented, popup, pulldown, menu, checkbox, toggle, radioGroup, textField, searchField, slider, progress, levelMeter, badge, disclosure, link, helpTag, table, th, splitDivider, toolbarSpacer, PRIM });

  /* prototype actions used by primitives */
  NP.on('proto.menu', (a) => {
    const s = NP.state;
    if (s.menu && s.menu.anchor === a.anchor) { s.menu = null; return; }
    s.menu = { anchor: a.anchor, items: NP._menus[a.anchor] || [] };
    s.popover = null;
  });
  NP.on('proto.noop', () => false);
  NP.on('proto.flash', (a) => { NP.flash(a.key, a.text || 'Done', a.ms); });
})();
