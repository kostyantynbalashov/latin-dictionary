(() => {
  'use strict';
  const D = window.DICT;
  const E = D.entries;
  const $ = (s) => document.querySelector(s);
  const MAX_ROWS = 150;

  /* ---------- нормалізація: регістр, довгі голосні, j/i, апостроф ---------- */
  const stripMarks = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  const tidy = (s) => s.replace(/[^\p{L}\p{N}’ -]/gu, '').replace(/\s+/g, ' ').trim();
  const nLat = (s) => tidy(stripMarks(s.toLowerCase().replace(/æ/g, 'ae').replace(/œ/g, 'oe')).replace(/j/g, 'i'));
  const nUk = (s) => tidy(s.toLowerCase().normalize('NFC').replace(/\u00ad/g, '').replace(/['ʼ`´]/g, '’'));
  const nEn = (s) => tidy(stripMarks(s.toLowerCase()).replace(/'/g, ''));
  const collEn = new Intl.Collator('en');
  const collUk = new Intl.Collator('uk');
  const plain = (s) => s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); // без дужок

  /* ---------- напрями ---------- */
  const MODES = {
    lu: { label: 'Лат → Укр', kind: 'lat', field: 'u', rev: 'ul', ph: 'Початок слова, напр. abd' },
    ul: { label: 'Укр → Лат', kind: 'rev', field: 'u', norm: nUk, coll: collUk, entry: 'lu', ph: 'Початок слова, напр. жов' },
    le: { label: 'Лат → Англ', kind: 'lat', field: 'e', rev: 'el', ph: 'Початок слова, напр. abd' },
    el: { label: 'Англ → Лат', kind: 'rev', field: 'e', norm: nEn, coll: collEn, entry: 'le', ph: 'Початок слова, напр. yel' },
  };
  const ORDER = ['lu', 'ul', 'le', 'el'];

  /* ---------- латинський індекс ---------- */
  function expandOpt(s) { // aqu(a)eductus -> aquaeductus, aqueductus
    const m = /[(\[]([^)\]]{1,3})[)\]]/.exec(s);
    if (!m || m.index === 0 || s[m.index - 1] === ' ') return [s];
    const a = s.slice(0, m.index), b = s.slice(m.index + m[0].length);
    return expandOpt(a + m[1] + b).concat(expandOpt(a + b));
  }
  function latKeys(e) {
    const out = [];
    const push = (t) => { const k = nLat(t); if (k && !out.includes(k)) out.push(k); };
    for (const part of e.l.split(/[;\/]/)) {
      const cp = part.split(',');
      const bases = cp.length > 1 && cp.every((p) => p.trim().endsWith('-')) ? cp : [cp[0]]; // префікси: ante-, prae-
      for (const base of bases) for (const v of expandOpt(base.trim())) push(v.replace(/\s*\([^)]*\)/g, ''));
    }
    // пошук і за синонімами
    for (const sy of (e.sy || [])) for (const v of expandOpt(sy.l.split(',')[0].trim())) push(v.replace(/\s*\([^)]*\)/g, ''));
    // однина / варіант у дужках: aspersiones (aspersio, onis, f.) -> aspersio
    for (const m of e.g.matchAll(/\(([^)]*)\)/g)) {
      const first = m[1].split(',')[0].trim();
      if (/^[a-zāēīōūȳë][a-zāēīōūȳë ]+$/i.test(first) && !/^[IVX]+$/.test(first)) push(first);
    }
    return out;
  }
  const LAT = E.map((e) => { const keys = latKeys(e); return { e, keys, sk: keys[0] || '' }; })
    .sort((a, b) => collEn.compare(a.sk, b.sk) || collEn.compare(a.e.g, b.e.g));

  /* ---------- зворотні індекси ---------- */
  // у зворотному напрямі переклад синоніма вважається й перекладом гасла (лише синоніми, не антоніми)
  const BY_SLUG0 = new Map(LAT.map((x) => [x.e.s, x]));
  function buildRev(field, norm, coll) {
    const m = new Map();
    for (const x of LAT) {
      const group = [x, ...(x.e.sy || []).map((s) => BY_SLUG0.get(s.s)).filter(Boolean)];
      for (const g of group) for (const t of g.e[field]) {
        const main = plain(t), k = norm(main);
        if (!k) continue;
        let r = m.get(k);
        if (!r) { r = { k, label: main, ents: [] }; m.set(k, r); }
        if (!r.ents.includes(x)) r.ents.push(x);
      }
    }
    return [...m.values()].sort((a, b) => coll.compare(a.k, b.k));
  }
  const REV = { ul: buildRev('u', nUk, collUk), el: buildRev('e', nEn, collEn) };
  const HAS = { u: E.some((e) => e.u.length), e: E.some((e) => e.e.length) };
  const BY_SLUG = new Map(E.map((e) => [e.s, e]));

  /* ---------- пошук ---------- */
  const partition = (items, keysOf, q) => {
    const g1 = [], g2 = [];
    for (const it of items) {
      const ks = keysOf(it);
      if (ks.some((k) => k.startsWith(q))) g1.push(it);
      else if (ks.some((k) => k.includes(' ' + q))) g2.push(it);
    }
    const exactFirst = (arr) => [...arr.filter((it) => keysOf(it).includes(q)), ...arr.filter((it) => !keysOf(it).includes(q))];
    return [exactFirst(g1), g2];
  };
  function search(mode, qRaw) {
    const cfg = MODES[mode];
    if (cfg.kind === 'lat') {
      const q = nLat(qRaw);
      const pool = LAT.filter((x) => x.e[cfg.field].length);
      return partition(pool, (x) => x.keys, q);
    }
    const q = cfg.norm(qRaw);
    return partition(REV[mode], (r) => [r.k], q);
  }

  /* ---------- DOM ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(c)); }
    return el;
  }
  const hash = (mode, q, t, slug) => {
    if (slug) return `#/${mode}/${encodeURIComponent(slug)}`;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (t) p.set('t', t);
    const s = p.toString();
    return `#/${mode}${s ? '?' + s : ''}`;
  };
  function parse() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    const [m, slug = ''] = path.split('/');
    const p = new URLSearchParams(qs);
    return { mode: MODES[m] ? m : 'lu', slug: decodeURIComponent(slug), q: p.get('q') || '', t: p.get('t') || '' };
  }
  const fmt = (n) => n.toLocaleString('uk-UA');
  const lemmaEl = (e, cls = 'lem') => h('span', { class: cls, lang: 'la', text: e.l });

  const input = $('#q'), view = $('#view'), status = $('#status'), filters = $('#filters');
  let last = { mode: 'lu', q: '', t: '' }; // останній пошук — для кнопки «назад»

  /* ---------- екрани ---------- */
  function drawModes(mode) {
    $('#modes').replaceChildren(...ORDER.map((m) =>
      h('a', { href: `#/${m}`, 'aria-current': m === mode ? 'page' : null, text: MODES[m].label })));
  }

  function emptyNoEnglish() {
    return h('div', { class: 'empty' },
      h('p', null, h('strong', { text: 'Англійських перекладів у словнику ще немає.' })),
      h('p', { text: 'Додайте їх у колонку «Англійська» файлу dictionary.xlsx — і цей напрям запрацює.' }));
  }

  function viewHome(mode) {
    const cfg = MODES[mode];
    if (!HAS[cfg.field]) { status.textContent = ''; return emptyNoEnglish(); }
    const n = cfg.kind === 'lat' ? LAT.filter((x) => x.e[cfg.field].length).length : REV[mode].length;
    const firsts = new Set((cfg.kind === 'lat'
      ? LAT.filter((x) => x.e[cfg.field].length).map((x) => x.sk)
      : REV[mode].map((r) => r.k)).map((k) => k.charAt(0)));
    const alphabet = mode === 'ul' ? 'абвгґдеєжзиіїйклмнопрстуфхцчшщюя'
      : mode === 'el' ? 'abcdefghijklmnopqrstuvwxyz' : 'abcdefghiklmnopqrstuvxyz';
    const letters = [...alphabet].filter((c) => firsts.has(c));
    status.textContent = '';
    return h('div', null,
      h('p', { class: 'hint', text: cfg.kind === 'lat'
        ? 'Введіть початок слова. Регістр і довгі голосні (ā, ē, ī) не мають значення. Клацніть на слово, щоб побачити його сторінку.'
        : 'Введіть початок слова або виберіть літеру. Результат покаже латинські слова, для яких воно є перекладом.' }),
      h('ul', { class: 'abc', 'aria-label': 'Літери' },
        letters.map((c) => h('li', null, h('a', { href: hash(mode, c), text: c })))),
      h('p', { class: 'hint', text: `У цьому напрямі ${fmt(n)} ${cfg.kind === 'lat' ? 'гасел' : 'слів'}.` }));
  }

  function chips(mode, q, t, counts) {
    const types = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    filters.replaceChildren();
    if (types.length < 2) return;
    const total = types.reduce((s, [, n]) => s + n, 0);
    const mk = (label, val) => h('button', {
      type: 'button', 'aria-pressed': String(t === val),
      onclick: () => { history.replaceState(null, '', hash(mode, q, val)); last.t = val; render(); },
      text: label });
    filters.append(mk(`усі (${total})`, ''), ...types.map(([ty, n]) => mk(`${ty} (${n})`, ty)));
  }

  function latRow(x, mode) {
    const e = x.e, field = MODES[mode].field;
    return h('li', null, h('a', { class: 'row', href: hash(mode, '', '', e.s) },
      h('span', null, lemmaEl(e), e.g ? h('span', { class: 'gram', lang: 'la', text: e.g }) : null),
      h('span', { class: 'tr', lang: field === 'e' ? 'en' : 'uk', text: e[field].join('; ') }),
      h('span', { class: 'ty', text: e.t })));
  }
  function revRow(r, mode) {
    const entryMode = MODES[mode].entry;
    return h('li', { class: 'rrow' },
      h('span', { class: 'key', lang: mode === 'el' ? 'en' : 'uk', text: r.label }),
      h('span', { class: 'lats' }, r.ents.map((x) =>
        h('a', { href: hash(entryMode, '', '', x.e.s) }, lemmaEl(x.e), x.e.g ? h('span', { class: 'gram', lang: 'la', text: x.e.g }) : null))));
  }

  function viewResults(mode, q, t) {
    const cfg = MODES[mode];
    if (!HAS[cfg.field]) { status.textContent = ''; filters.replaceChildren(); return emptyNoEnglish(); }
    let [g1, g2] = search(mode, q);
    if (cfg.kind === 'lat') {
      const counts = new Map();
      for (const x of [...g1, ...g2]) counts.set(x.e.t, (counts.get(x.e.t) || 0) + 1);
      chips(mode, q, t, counts);
      if (t) { g1 = g1.filter((x) => x.e.t === t); g2 = g2.filter((x) => x.e.t === t); }
    } else filters.replaceChildren();

    const total = g1.length + g2.length;
    if (!total) {
      status.textContent = 'Нічого не знайдено';
      return h('div', { class: 'empty' },
        h('p', null, h('strong', { text: `Нічого не знайдено за «${q}».` })),
        h('p', { text: 'Спробуйте коротший початок слова або інший напрям.' }));
    }
    status.textContent = `Знайдено: ${fmt(total)}` + (total > MAX_ROWS ? `. Показано перші ${MAX_ROWS}, уточніть запит.` : '');
    const row = cfg.kind === 'lat' ? (x) => latRow(x, mode) : (r) => revRow(r, mode);
    const cut = g1.slice(0, MAX_ROWS), rest = g2.slice(0, Math.max(0, MAX_ROWS - cut.length));
    return h('div', null,
      h('ul', { class: 'list' }, cut.map(row)),
      rest.length ? h('div', null,
        h('p', { class: 'subhead', text: 'Збіги всередині виразів' }),
        h('ul', { class: 'list' }, rest.map(row))) : null);
  }

  function linkBlock(title, list, mode) {
    if (!list || !list.length) return null;
    return h('section', null, h('h2', { text: title }),
      h('ul', { class: 'trs' }, list.map((x) => h('li', null,
        x.s ? h('a', { lang: 'la', href: hash(mode, '', '', x.s) }, x.l, x.g ? h('span', { class: 'gram', lang: 'la', text: x.g }) : null)
            : h('span', { lang: 'la', text: x.l })))));
  }

  function viewEntry(mode, slug) {
    const e = BY_SLUG.get(slug), cfg = MODES[mode];
    if (!e || cfg.kind !== 'lat') return h('div', { class: 'empty' }, h('p', { text: 'Такого слова немає.' }));
    document.title = `${e.l} — Латинський словник`;
    status.textContent = ''; filters.replaceChildren();
    const backTo = last.q ? hash(last.mode, last.q, last.t) : hash(mode);
    const items = e[cfg.field];
    const lang = cfg.field === 'e' ? 'en' : 'uk';
    const isUk = cfg.field === 'u';
    return h('article', { class: 'entry' },
      h('a', { class: 'back', href: backTo, text: last.q ? `← Результати «${last.q}»` : '← До пошуку' }),
      h('h1', { lang: 'la', text: e.l }),
      e.g ? h('p', { class: 'egram', lang: 'la', text: e.g }) : null,
      h('p', { class: 'etype', text: e.t }),
      h('section', null,
        h('h2', { text: isUk ? 'Українською' : 'Англійською' }),
        items.length
          ? h('ul', { class: 'trs' }, items.map((t) =>
              h('li', null, h('a', { lang, href: hash(cfg.rev, plain(t)), text: t }))))
          : h('p', { class: 'note', text: 'Перекладу ще немає.' })),
      linkBlock('Синоніми', e.sy, mode),
      linkBlock('Антоніми', e.an, mode),
      isUk && e.n ? h('section', null, h('h2', { text: 'Примітка' }), h('p', { class: 'note', text: e.n })) : null,
      isUk && e.x.length ? h('section', null, h('h2', { text: 'Приклади' }),
        h('ul', { class: 'exs' }, e.x.map((x) =>
          h('li', null, h('span', { class: 't', lang: 'la', text: x.t }), x.s ? h('span', { class: 's', text: x.s }) : null)))) : null);
  }

  /* ---------- маршрутизація ---------- */
  function render() {
    const r = parse();
    document.title = 'Латинський словник';
    drawModes(r.mode);
    input.placeholder = MODES[r.mode].ph;
    const shown = r.slug ? last.q : r.q;
    if (document.activeElement !== input || input.value !== shown) input.value = shown;
    let node;
    if (r.slug) node = viewEntry(r.mode, r.slug);
    else {
      last = { mode: r.mode, q: r.q, t: r.t };
      node = r.q.trim() ? viewResults(r.mode, r.q, r.t) : (filters.replaceChildren(), viewHome(r.mode));
    }
    view.replaceChildren(node);
  }

  input.addEventListener('input', () => {
    const r = parse();
    history.replaceState(null, '', hash(r.mode, input.value.trim() ? input.value : '', ''));
    render();
  });
  $('#searchform').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const first = view.querySelector('.row, .lats a');
    if (first) first.click();
  });
  window.addEventListener('hashchange', () => { render(); if (parse().slug) window.scrollTo(0, 0); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { ev.preventDefault(); input.focus(); input.select(); }
  });

  $('#foot').textContent = `Гасел: ${fmt(E.length)}. Дані оновлено ${D.built.split('-').reverse().join('.')}.`;
  render();
  if (matchMedia('(pointer:fine)').matches && !parse().slug) input.focus();
})();
