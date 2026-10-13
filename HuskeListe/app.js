/* ════════════════════════════════════════════════════════════════
   HuskeListe v2 — tag board with rich items.
   Storage: localStorage (auto-migrates the v1 flat list).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const STORAGE_KEY = 'huskeliste.v2';
  const LEGACY_KEY = 'huskeliste.items.v1';

  const $ = function (id) { return document.getElementById(id); };

  const els = {
    board: $('board'),
    addForm: $('addForm'),
    quickAdd: document.querySelector('.quick-add'),
    newItem: $('newItem'),
    addTag: $('addTag'),
    detailAddBtn: $('detailAddBtn'),
    search: $('search'),
    sortBtn: $('sortBtn'),
    sortLabel: $('sortLabel'),
    manageBtn: $('manageBtn'),
    repeatBtn: $('repeatBtn'),
    repeatCount: $('repeatCount'),
    doneBtn: $('doneBtn'),
    doneCount: $('doneCount'),
    menu: $('menu'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    importFile: $('importFile'),
    toast: $('toast'),

    editorOverlay: $('editorOverlay'),
    editorTitle: $('editorTitle'),
    editorForm: $('editorForm'),
    editorClose: $('editorClose'),
    edText: $('edText'),
    edDesc: $('edDesc'),
    edTags: $('edTags'),
    edDeadline: $('edDeadline'),
    edAssignee: $('edAssignee'),
    edUrgent: $('edUrgent'),
    edRepeat: $('edRepeat'),
    edWeekday: $('edWeekday'),
    edWeekdayWrap: $('edWeekdayWrap'),
    edRepeatHint: $('edRepeatHint'),
    edComplete: $('edComplete'),
    edDelete: $('edDelete'),

    manageOverlay: $('manageOverlay'),
    manageClose: $('manageClose'),
    tagList: $('tagList'),
    newTag: $('newTag'),
    addTagBtn: $('addTagBtn'),
    peopleList: $('peopleList'),
    newPerson: $('newPerson'),
    addPersonBtn: $('addPersonBtn'),

    doneOverlay: $('doneOverlay'),
    doneClose: $('doneClose'),
    doneList: $('doneList'),

    repeatOverlay: $('repeatOverlay'),
    repeatClose: $('repeatClose'),
    repeatList: $('repeatList'),
    repeatShowDone: $('repeatShowDone')
  };

  let state = null;
  let searchTerm = '';
  let selectedTagId = null;
  let editingId = null;   // item id, or 'new'
  let orderSeq = 0;
  let toastTimer;

  /* ── helpers ──────────────────────────────────────────────────── */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function h(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else e.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null || kid === false) continue;
      e.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2600);
  }

  function maxOrder() { return state.items.reduce(function (m, i) { return Math.max(m, i.order || 0); }, 0); }
  function sortedTags() { return state.tags.slice().sort(function (a, b) { return a.order - b.order; }); }
  function tagHue(t) { return (t && typeof t.hue === 'number') ? t.hue : 45; }
  // Golden-angle spread so every tag gets a distinct, stable hue by default.
  function defaultHue(i) { return Math.round((210 + i * 137.508) % 360); }

  /* ── recurrence ───────────────────────────────────────────────── */

  const FREQS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
  const WEEKDAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const WEEKDAYS_SHORT = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];

  function parseISO(iso) { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isISODate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function weekdayOf(deadline) { return isISODate(deadline) ? parseISO(deadline).getDay() : new Date().getDay(); }

  function repeatLabel(r) {
    if (!r) return '';
    if (r.freq === 'daily') return 'Dagligt';
    if (r.freq === 'weekly') return 'Ugentligt' + (typeof r.weekday === 'number' ? ' (' + WEEKDAYS_SHORT[r.weekday] + ')' : '');
    if (r.freq === 'monthly') return 'Månedligt';
    if (r.freq === 'quarterly') return 'Hvert kvartal';
    if (r.freq === 'yearly') return 'Årligt';
    return '';
  }

  function normalizeRepeat(r, legacy, deadline) {
    if (r && typeof r === 'object' && FREQS.indexOf(r.freq) !== -1) {
      let wd = (typeof r.weekday === 'number' && r.weekday >= 0 && r.weekday <= 6) ? r.weekday : null;
      if (r.freq === 'weekly' && wd === null) wd = weekdayOf(deadline);
      return { freq: r.freq, weekday: r.freq === 'weekly' ? wd : null };
    }
    if (legacy) return { freq: 'weekly', weekday: weekdayOf(deadline) };
    return null;
  }

  function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d.getDate(), last));
    return x;
  }
  // Next occurrence strictly after max(frist, today) so overdue ones catch up.
  function nextOccurrence(deadline, repeat) {
    if (!repeat) return null;
    const today = parseISO(todayISO());
    let base = isISODate(deadline) ? parseISO(deadline) : today;
    if (base < today) base = today;
    if (repeat.freq === 'daily') return toISO(addDays(base, 1));
    if (repeat.freq === 'weekly') {
      const wd = typeof repeat.weekday === 'number' ? repeat.weekday : base.getDay();
      let d = addDays(base, 1);
      while (d.getDay() !== wd) d = addDays(d, 1);
      return toISO(d);
    }
    if (repeat.freq === 'monthly') return toISO(addMonths(base, 1));
    if (repeat.freq === 'quarterly') return toISO(addMonths(base, 3));
    if (repeat.freq === 'yearly') return toISO(addMonths(base, 12));
    return null;
  }

  /* ── persistence ──────────────────────────────────────────────── */

  function defaultState() {
    return {
      version: 2,
      tags: [{ id: uid(), name: 'General', order: 0, fixed: true, hue: defaultHue(0) }],
      people: ['Me'],
      items: [],
      settings: { sortMode: 'deadline' }
    };
  }

  function mkItem(text, tags, order) {
    return {
      id: uid(),
      text: text,
      description: '',
      tags: tags || [],
      done: false,
      deadline: null,
      assignee: null,
      urgent: false,
      repeat: null,
      createdAt: Date.now(),
      order: typeof order === 'number' ? order : 0,
      doneAt: null
    };
  }

  function normalize(raw) {
    const s = { version: 2, tags: [], people: [], items: [], settings: { sortMode: 'deadline' } };

    if (Array.isArray(raw.tags)) {
      s.tags = raw.tags
        .filter(function (t) { return t && t.id && typeof t.name === 'string'; })
        .map(function (t, i) {
          return {
            id: t.id, name: t.name,
            order: typeof t.order === 'number' ? t.order : i,
            fixed: !!t.fixed,
            hue: (typeof t.hue === 'number' && t.hue >= 0 && t.hue < 360) ? Math.round(t.hue) : defaultHue(i)
          };
        });
    }
    if (!s.tags.length) s.tags.push({ id: uid(), name: 'General', order: 0, fixed: true, hue: defaultHue(0) });

    if (Array.isArray(raw.people)) {
      s.people = raw.people.filter(function (p) { return typeof p === 'string' && p.trim(); }).map(function (p) { return p.trim(); });
    }
    if (!s.people.length) s.people = ['Me'];

    if (raw.settings && (raw.settings.sortMode === 'alpha' || raw.settings.sortMode === 'deadline')) {
      s.settings.sortMode = raw.settings.sortMode;
    }

    const tagIds = new Set(s.tags.map(function (t) { return t.id; }));
    const fallbackTag = s.tags.slice().sort(function (a, b) { return a.order - b.order; })[0].id;

    if (Array.isArray(raw.items)) {
      s.items = raw.items
        .filter(function (x) { return x && typeof x.text === 'string'; })
        .map(function (x, i) {
          let tags = Array.isArray(x.tags) ? x.tags.filter(function (t) { return tagIds.has(t); }) : [];
          if (!tags.length) tags = [fallbackTag];
          return {
            id: x.id || uid(),
            text: x.text,
            description: typeof x.description === 'string' ? x.description : '',
            tags: tags,
            done: !!x.done,
            deadline: typeof x.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.deadline) ? x.deadline : null,
            assignee: typeof x.assignee === 'string' && x.assignee.trim() ? x.assignee : null,
            urgent: !!x.urgent,
            repeat: normalizeRepeat(x.repeat, x.recurring, x.deadline),
            createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
            order: typeof x.order === 'number' ? x.order : i + 1,
            doneAt: typeof x.doneAt === 'number' ? x.doneAt : null
          };
        });
    }
    return s;
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 2) {
          state = normalize(parsed);
          orderSeq = maxOrder();
          return;
        }
      } catch (e) { /* fall through to migration */ }
    }

    // Migrate the legacy flat list into a General tag.
    const s = defaultState();
    let legacy = null;
    try { legacy = localStorage.getItem(LEGACY_KEY); } catch (e) { /* ignore */ }
    if (legacy) {
      try {
        const arr = JSON.parse(legacy);
        if (Array.isArray(arr)) {
          const gid = s.tags[0].id;
          arr.forEach(function (x, i) {
            const text = typeof x === 'string' ? x : (x && x.text);
            if (typeof text === 'string' && text.trim()) s.items.push(mkItem(text.trim(), [gid], i + 1));
          });
        }
      } catch (e) { /* ignore */ }
    }
    state = s;
    orderSeq = maxOrder();
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Kunne ikke gemme — lageret er måske fuldt.');
    }
  }

  /* ── filtering & sorting ──────────────────────────────────────── */

  function matches(item, q) {
    return (item.text + ' ' + (item.description || '') + ' ' + (item.assignee || ''))
      .toLowerCase().indexOf(q) !== -1;
  }

  function cmpItems(a, b) {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (state.settings.sortMode === 'alpha') {
      return a.text.localeCompare(b.text, 'da', { sensitivity: 'base' });
    }
    const ad = a.deadline, bd = b.deadline;
    if (ad && bd) { if (ad < bd) return -1; if (ad > bd) return 1; }
    else if (ad) return -1;
    else if (bd) return 1;
    return (a.order || 0) - (b.order || 0);
  }

  function itemsForTag(tagId) {
    const q = searchTerm.trim().toLowerCase();
    let list = state.items.filter(function (it) {
      return !it.done && it.tags.indexOf(tagId) !== -1;
    });
    if (q) list = list.filter(function (it) { return matches(it, q); });
    return list.sort(cmpItems);
  }

  function fmtDate(iso) {
    const p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  }

  /* ── rendering ────────────────────────────────────────────────── */

  function render() {
    const tags = sortedTags();
    if (!selectedTagId || !tags.some(function (t) { return t.id === selectedTagId; })) {
      selectedTagId = tags[0].id;
    }

    els.board.textContent = '';
    tags.forEach(function (t) { els.board.appendChild(renderColumn(t)); });

    syncAddTagSelect();
    els.sortLabel.textContent = state.settings.sortMode === 'alpha' ? 'A–Z' : 'Frist';
    els.doneCount.textContent = state.items.filter(function (i) { return i.done; }).length;
    els.repeatCount.textContent = state.items.filter(function (i) { return i.repeat; }).length;
  }

  function syncAddTagSelect() {
    els.addTag.textContent = '';
    sortedTags().forEach(function (t) {
      els.addTag.appendChild(h('option', { value: t.id, text: t.name }));
    });
    els.addTag.value = selectedTagId;
    const sel = state.tags.find(function (t) { return t.id === selectedTagId; });
    els.newItem.placeholder = 'Tilføj til ' + (sel ? sel.name : 'listen') + '…';
    if (els.quickAdd) els.quickAdd.style.setProperty('--hue', sel ? tagHue(sel) : 45);
    if (els.newItem) els.newItem.style.setProperty('--hue', sel ? tagHue(sel) : 45);
  }

  function highlightSelected() {
    els.board.querySelectorAll('.col').forEach(function (c) {
      c.querySelector('.col-head').classList.toggle('active', c.getAttribute('data-tag') === selectedTagId);
    });
  }

  function renderColumn(tag) {
    const col = h('section', { class: 'col', 'data-tag': tag.id, style: '--hue:' + tagHue(tag) });

    const head = h('header', { class: 'col-head' + (tag.id === selectedTagId ? ' active' : ''), 'data-select': tag.id });
    head.appendChild(h('button', {
      class: 'col-name', type: 'button', 'data-select': tag.id,
      title: 'Vælg som mål for "Tilføj"'
    }, tag.name));
    const total = state.items.filter(function (i) { return !i.done && i.tags.indexOf(tag.id) !== -1; }).length;
    head.appendChild(h('span', { class: 'col-count' }, String(total)));
    col.appendChild(head);

    const ul = h('ul', { class: 'col-items' });
    const items = itemsForTag(tag.id);
    if (!items.length) {
      const searching = searchTerm.trim() !== '';
      ul.appendChild(h('li', { class: 'col-empty' }, total === 0 ? 'Tom' : (searching ? 'Ingen match' : 'Tom')));
    } else {
      items.forEach(function (it) { ul.appendChild(renderCard(it)); });
    }
    col.appendChild(ul);
    return col;
  }

  function renderCard(item) {
    const li = h('li', { class: 'card' + (item.urgent ? ' urgent' : ''), 'data-id': item.id });
    li.appendChild(h('input', { type: 'checkbox', class: 'tick', 'aria-label': 'Markér færdig' }));

    const main = h('div', { class: 'card-main' });
    main.appendChild(h('div', { class: 'card-text' }, item.text));
    if (item.description) main.appendChild(h('div', { class: 'card-desc' }, item.description));

    const badges = h('div', { class: 'card-badges' });
    if (item.urgent) badges.appendChild(h('span', { class: 'badge urgent' }, '‼ Vigtig'));
    if (item.repeat) badges.appendChild(h('span', { class: 'badge recurring', title: 'Gentages: ' + repeatLabel(item.repeat) }, '🔁 ' + repeatLabel(item.repeat)));
    if (item.deadline) {
      const b = h('span', { class: 'badge deadline' + (item.deadline < todayISO() ? ' overdue' : '') }, '📅 ' + fmtDate(item.deadline));
      badges.appendChild(b);
    }
    if (item.assignee) badges.appendChild(h('span', { class: 'badge who' }, '👤 ' + item.assignee));
    if (badges.childNodes.length) main.appendChild(badges);

    li.appendChild(main);
    return li;
  }

  /* ── item actions ─────────────────────────────────────────────── */

  function addItem(text, tags) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return;
    const chosen = (tags && tags.length) ? tags : [selectedTagId];
    state.items.push(mkItem(t, chosen, ++orderSeq));
    save();
    render();
  }

  function completeItem(id) {
    const it = state.items.find(function (i) { return i.id === id; });
    if (!it) return;
    it.done = true;
    it.doneAt = Date.now();
    save();
    render();
    toast('Færdig.');
  }

  function reopenItem(id) {
    const it = state.items.find(function (i) { return i.id === id; });
    if (!it) return;
    it.done = false;
    it.doneAt = null;
    save();
    render();
    renderDone();
    toast('Genåbnet.');
  }

  function deleteItem(id) {
    state.items = state.items.filter(function (i) { return i.id !== id; });
    save();
    render();
  }

  /* ── editor sheet ─────────────────────────────────────────────── */

  function updateRepeatUI() {
    const freq = els.edRepeat.value;
    els.edWeekdayWrap.hidden = freq !== 'weekly';
    if (!freq) { els.edRepeatHint.hidden = true; els.edRepeatHint.textContent = ''; return; }
    const rep = { freq: freq, weekday: freq === 'weekly' ? Number(els.edWeekday.value) : null };
    const base = els.edDeadline.value || todayISO();
    const next = nextOccurrence(base, rep);
    els.edRepeatHint.hidden = false;
    els.edRepeatHint.textContent = 'Næste gang: ' + fmtDate(next);
  }

  function openEditor(id) {
    editingId = id;
    const isNew = id === 'new';
    const item = isNew ? null : state.items.find(function (i) { return i.id === id; });
    if (!isNew && !item) return;

    els.editorTitle.textContent = isNew ? 'Ny ting' : 'Redigér';
    els.edText.value = item ? item.text : '';
    els.edDesc.value = item ? (item.description || '') : '';
    els.edDeadline.value = item && item.deadline ? item.deadline : '';
    els.edUrgent.checked = item ? item.urgent : false;

    const rep = item && item.repeat ? item.repeat : null;
    els.edRepeat.value = rep ? rep.freq : '';
    els.edWeekday.textContent = '';
    WEEKDAYS.forEach(function (name, idx) {
      els.edWeekday.appendChild(h('option', { value: String(idx), text: name }));
    });
    els.edWeekday.value = String(
      (rep && rep.freq === 'weekly' && typeof rep.weekday === 'number') ? rep.weekday
        : (item && isISODate(item.deadline) ? parseISO(item.deadline).getDay() : new Date().getDay())
    );
    updateRepeatUI();

    els.edAssignee.textContent = '';
    els.edAssignee.appendChild(h('option', { value: '', text: '— ingen —' }));
    state.people.forEach(function (p) { els.edAssignee.appendChild(h('option', { value: p, text: p })); });
    if (item && item.assignee && state.people.indexOf(item.assignee) === -1) {
      els.edAssignee.appendChild(h('option', { value: item.assignee, text: item.assignee }));
    }
    els.edAssignee.value = item && item.assignee ? item.assignee : '';

    els.edTags.textContent = '';
    const itemTags = item ? item.tags.slice() : (selectedTagId ? [selectedTagId] : []);
    sortedTags().forEach(function (t) {
      const cb = h('input', { type: 'checkbox', value: t.id });
      cb.checked = itemTags.indexOf(t.id) !== -1;
      els.edTags.appendChild(h('label', { class: 'chip-check', style: '--hue:' + tagHue(t) }, cb, h('span', { class: 'chip-dot' }), h('span', {}, t.name)));
    });

    els.edComplete.style.display = isNew ? 'none' : '';
    els.edDelete.style.display = isNew ? 'none' : '';

    openOverlay(els.editorOverlay);
    setTimeout(function () { els.edText.focus(); }, 40);
  }

  els.editorForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const text = els.edText.value.trim();
    if (!text) { toast('Skriv en tekst.'); return; }

    let tags = Array.prototype.slice.call(els.edTags.querySelectorAll('input:checked')).map(function (c) { return c.value; });
    if (!tags.length) tags = [sortedTags()[0].id];

    const data = {
      text: text,
      description: els.edDesc.value.trim(),
      deadline: els.edDeadline.value || null,
      assignee: els.edAssignee.value || null,
      urgent: els.edUrgent.checked,
      repeat: els.edRepeat.value
        ? { freq: els.edRepeat.value, weekday: els.edRepeat.value === 'weekly' ? Number(els.edWeekday.value) : null }
        : null,
      tags: tags
    };

    if (editingId === 'new') {
      const it = mkItem(data.text, data.tags, ++orderSeq);
      Object.assign(it, data);
      state.items.push(it);
    } else {
      const it = state.items.find(function (i) { return i.id === editingId; });
      if (it) Object.assign(it, data);
    }
    save();
    render();
    closeOverlay(els.editorOverlay);
    toast('Gemt.');
  });

  els.edComplete.addEventListener('click', function () {
    if (editingId && editingId !== 'new') { completeItem(editingId); closeOverlay(els.editorOverlay); }
  });
  els.edDelete.addEventListener('click', function () {
    if (editingId && editingId !== 'new') { deleteItem(editingId); closeOverlay(els.editorOverlay); toast('Slettet.'); }
  });

  els.edRepeat.addEventListener('change', updateRepeatUI);
  els.edWeekday.addEventListener('change', updateRepeatUI);
  els.edDeadline.addEventListener('change', updateRepeatUI);
  els.edDeadline.addEventListener('input', updateRepeatUI);

  /* ── manage sheet ─────────────────────────────────────────────── */

  function renderManage() {
    els.tagList.textContent = '';
    sortedTags().forEach(function (t, i) {
      const block = h('div', { class: 'manage-tag', 'data-id': t.id });

      const row = h('div', { class: 'manage-row' });
      const dot = h('span', { class: 'hue-dot', style: '--hue:' + tagHue(t) });
      row.appendChild(dot);
      const inp = h('input', { class: 'manage-input', type: 'text', maxlength: '40' });
      inp.value = t.name;
      inp.addEventListener('change', function () {
        t.name = inp.value.trim() || 'Tag';
        inp.value = t.name;
        save(); render();
      });
      row.appendChild(inp);
      row.appendChild(h('button', { class: 'icon-btn', type: 'button', 'data-move': 'up', 'data-index': String(i), 'aria-label': 'Flyt venstre' }, '◀'));
      row.appendChild(h('button', { class: 'icon-btn', type: 'button', 'data-move': 'down', 'data-index': String(i), 'aria-label': 'Flyt højre' }, '▶'));
      const del = h('button', { class: 'icon-btn danger', type: 'button', 'data-del-tag': t.id, 'aria-label': 'Slet tag' }, '🗑');
      if (t.fixed) { del.disabled = true; del.title = 'Kan ikke slettes'; }
      row.appendChild(del);
      block.appendChild(row);

      const range = h('input', {
        class: 'hue-range', type: 'range', min: '0', max: '359',
        value: String(tagHue(t)), style: '--hue:' + tagHue(t), 'aria-label': 'Farve på ' + t.name
      });
      range.addEventListener('input', function () {
        t.hue = Number(range.value);
        dot.style.setProperty('--hue', t.hue);
        range.style.setProperty('--hue', t.hue);
        const colEl = els.board.querySelector('.col[data-tag="' + t.id + '"]');
        if (colEl) colEl.style.setProperty('--hue', t.hue);
        save();
      });
      block.appendChild(h('label', { class: 'hue-line', title: 'Vælg farve' }, range));

      els.tagList.appendChild(block);
    });

    els.peopleList.textContent = '';
    state.people.forEach(function (p) {
      const row = h('div', { class: 'manage-row' });
      const inp = h('input', { class: 'manage-input', type: 'text', maxlength: '40' });
      inp.value = p;
      inp.addEventListener('change', function () {
        const v = inp.value.trim();
        if (!v) { inp.value = p; return; }
        state.people = state.people.map(function (x) { return x === p ? v : x; });
        state.items.forEach(function (it) { if (it.assignee === p) it.assignee = v; });
        save(); render(); renderManage();
      });
      row.appendChild(inp);
      row.appendChild(h('button', { class: 'icon-btn danger', type: 'button', 'data-del-person': p, 'aria-label': 'Slet person' }, '🗑'));
      els.peopleList.appendChild(row);
    });
  }

  function moveTag(index, dir) {
    const tags = sortedTags();
    const j = dir === 'up' ? index - 1 : index + 1;
    if (j < 0 || j >= tags.length) return;
    const tmp = tags[index];
    tags[index] = tags[j];
    tags[j] = tmp;
    tags.forEach(function (t, i) { t.order = i; });
    save(); render(); renderManage();
  }

  function deleteTag(id) {
    const tag = state.tags.find(function (t) { return t.id === id; });
    if (!tag || tag.fixed || state.tags.length <= 1) return;
    state.tags = state.tags.filter(function (t) { return t.id !== id; });
    const fallback = sortedTags()[0].id;
    state.items.forEach(function (it) {
      it.tags = it.tags.filter(function (x) { return x !== id; });
      if (!it.tags.length) it.tags = [fallback];
    });
    if (selectedTagId === id) selectedTagId = fallback;
    save(); render(); renderManage();
  }

  els.tagList.addEventListener('click', function (e) {
    const move = e.target.closest('[data-move]');
    if (move) { moveTag(Number(move.getAttribute('data-index')), move.getAttribute('data-move')); return; }
    const del = e.target.closest('[data-del-tag]');
    if (del && !del.disabled) deleteTag(del.getAttribute('data-del-tag'));
  });

  els.peopleList.addEventListener('click', function (e) {
    const del = e.target.closest('[data-del-person]');
    if (!del) return;
    const p = del.getAttribute('data-del-person');
    state.people = state.people.filter(function (x) { return x !== p; });
    save(); renderManage();
    toast('Slettet.');
  });

  els.addTagBtn.addEventListener('click', function () {
    const name = els.newTag.value.trim();
    if (!name) return;
    const order = sortedTags().reduce(function (m, t) { return Math.max(m, t.order); }, -1) + 1;
    state.tags.push({ id: uid(), name: name, order: order, fixed: false, hue: defaultHue(state.tags.length) });
    els.newTag.value = '';
    save(); render(); renderManage();
  });

  els.addPersonBtn.addEventListener('click', function () {
    const name = els.newPerson.value.trim();
    if (!name || state.people.indexOf(name) !== -1) return;
    state.people.push(name);
    els.newPerson.value = '';
    save(); renderManage();
  });

  /* ── done sheet ───────────────────────────────────────────────── */

  function renderDone() {
    els.doneList.textContent = '';
    const done = state.items.filter(function (i) { return i.done; })
      .sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    if (!done.length) { els.doneList.appendChild(h('div', { class: 'done-empty' }, 'Ingen færdige ting.')); return; }
    done.forEach(function (it) {
      const row = h('div', { class: 'done-row' });
      const main = h('div', { class: 'done-main' });
      main.appendChild(h('div', { class: 'done-text' }, it.text));
      const meta = h('div', { class: 'done-meta' });
      it.tags.forEach(function (id) {
        const t = state.tags.find(function (x) { return x.id === id; });
        if (!t) return;
        if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(h('span', { class: 'done-tag', style: '--hue:' + tagHue(t) }, t.name));
      });
      if (it.doneAt) {
        if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(document.createTextNode(new Date(it.doneAt).toLocaleDateString('da-DK')));
      }
      if (meta.childNodes.length) main.appendChild(meta);
      row.appendChild(main);
      row.appendChild(h('button', { class: 'ghost', type: 'button', 'data-reopen': it.id }, 'Genåbn'));
      row.appendChild(h('button', { class: 'ghost danger', type: 'button', 'data-del-item': it.id }, 'Slet'));
      els.doneList.appendChild(row);
    });
  }

  els.doneList.addEventListener('click', function (e) {
    const re = e.target.closest('[data-reopen]');
    if (re) { reopenItem(re.getAttribute('data-reopen')); return; }
    const del = e.target.closest('[data-del-item]');
    if (del) { deleteItem(del.getAttribute('data-del-item')); renderDone(); }
  });

  /* ── recurring tracker ────────────────────────────────────────── */

  function renderRepeat() {
    els.repeatList.textContent = '';
    const anyRepeat = state.items.some(function (i) { return i.repeat; });
    let items = state.items.filter(function (i) { return i.repeat; });
    if (!els.repeatShowDone.checked) items = items.filter(function (i) { return !i.done; });
    items.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.deadline || '', bd = b.deadline || '';
      if (ad && bd) { if (ad < bd) return -1; if (ad > bd) return 1; }
      else if (ad) return -1; else if (bd) return 1;
      return (a.order || 0) - (b.order || 0);
    });

    if (!items.length) {
      els.repeatList.appendChild(h('div', { class: 'done-empty' },
        anyRepeat ? 'Ingen aktive — slå «Vis færdige» til.' : 'Ingen gentagelser endnu.'));
      return;
    }

    items.forEach(function (it) {
      const row = h('div', { class: 'rep-row' + (it.done ? ' done' : '') });
      const main = h('div', { class: 'rep-main' });
      main.appendChild(h('div', { class: 'rep-text' }, it.text));

      const meta = h('div', { class: 'rep-meta' });
      meta.appendChild(h('span', { class: 'rep-freq' }, '🔁 ' + repeatLabel(it.repeat)));
      const next = nextOccurrence(it.deadline, it.repeat);
      meta.appendChild(h('span', {
        class: 'rep-date' + (it.deadline && it.deadline < todayISO() ? ' overdue' : '')
      }, ' · ' + (it.deadline ? 'frist ' + fmtDate(it.deadline) : 'ingen frist') + ' · næste ' + fmtDate(next)));
      it.tags.forEach(function (id) {
        const t = state.tags.find(function (x) { return x.id === id; });
        if (!t) return;
        meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(h('span', { class: 'done-tag', style: '--hue:' + tagHue(t) }, t.name));
      });
      main.appendChild(meta);
      row.appendChild(main);

      if (it.done) {
        row.appendChild(h('button', { class: 'ghost', type: 'button', 'data-bump': it.id }, 'Genåbn til næste'));
        row.appendChild(h('button', { class: 'ghost danger', type: 'button', 'data-del-rep': it.id }, 'Slet'));
      } else {
        row.appendChild(h('button', { class: 'ghost', type: 'button', 'data-bump': it.id }, 'Fremryk'));
        row.appendChild(h('button', { class: 'ghost', type: 'button', 'data-done-rep': it.id }, '✔ Færdig'));
      }
      els.repeatList.appendChild(row);
    });
  }

  function bumpRepeat(id) {
    const it = state.items.find(function (i) { return i.id === id; });
    if (!it || !it.repeat) return;
    const next = nextOccurrence(it.deadline, it.repeat);
    it.deadline = next;
    const wasDone = it.done;
    if (wasDone) { it.done = false; it.doneAt = null; }
    save(); render(); renderDone(); renderRepeat();
    toast((wasDone ? 'Genåbnet — næste ' : 'Fremrykket til ') + fmtDate(next) + '.');
  }

  els.repeatList.addEventListener('click', function (e) {
    const del = e.target.closest('[data-del-rep]');
    if (del) { deleteItem(del.getAttribute('data-del-rep')); renderRepeat(); return; }
    const done = e.target.closest('[data-done-rep]');
    if (done) { completeItem(done.getAttribute('data-done-rep')); renderRepeat(); return; }
    const bump = e.target.closest('[data-bump]');
    if (bump) { bumpRepeat(bump.getAttribute('data-bump')); }
  });

  /* ── overlays ─────────────────────────────────────────────────── */

  function openOverlay(ov) { ov.classList.add('open'); }
  function closeOverlay(ov) { ov.classList.remove('open'); }

  [els.editorOverlay, els.manageOverlay, els.doneOverlay].forEach(function (ov) {
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeOverlay(ov); });
  });

  els.editorClose.addEventListener('click', function () { closeOverlay(els.editorOverlay); });
  els.manageBtn.addEventListener('click', function () { renderManage(); openOverlay(els.manageOverlay); });
  els.manageClose.addEventListener('click', function () { closeOverlay(els.manageOverlay); });
  els.doneBtn.addEventListener('click', function () { renderDone(); openOverlay(els.doneOverlay); });
  els.doneClose.addEventListener('click', function () { closeOverlay(els.doneOverlay); });
  els.repeatBtn.addEventListener('click', function () { renderRepeat(); openOverlay(els.repeatOverlay); });
  els.repeatClose.addEventListener('click', function () { closeOverlay(els.repeatOverlay); });
  els.repeatShowDone.addEventListener('change', renderRepeat);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeOverlay(els.editorOverlay);
      closeOverlay(els.manageOverlay);
      closeOverlay(els.doneOverlay);
      closeOverlay(els.repeatOverlay);
    }
  });

  /* ── board events ─────────────────────────────────────────────── */

  els.board.addEventListener('click', function (e) {
    const selectBtn = e.target.closest('[data-select]');
    if (selectBtn) {
      selectedTagId = selectBtn.getAttribute('data-select');
      syncAddTagSelect();
      highlightSelected();
      return;
    }
    if (e.target.closest('.tick')) return;
    const card = e.target.closest('.card');
    if (card) openEditor(card.getAttribute('data-id'));
  });

  els.board.addEventListener('change', function (e) {
    if (e.target.classList.contains('tick')) {
      const card = e.target.closest('.card');
      if (card) completeItem(card.getAttribute('data-id'));
    }
  });

  /* ── toolbar events ───────────────────────────────────────────── */

  els.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    addItem(els.newItem.value, [selectedTagId]);
    els.newItem.value = '';
    els.newItem.focus();
  });

  els.addTag.addEventListener('change', function () {
    selectedTagId = els.addTag.value;
    syncAddTagSelect();
    highlightSelected();
  });

  els.detailAddBtn.addEventListener('click', function () { openEditor('new'); });

  let searchTimer;
  els.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { searchTerm = els.search.value; render(); }, 120);
  });

  els.sortBtn.addEventListener('click', function () {
    state.settings.sortMode = state.settings.sortMode === 'alpha' ? 'deadline' : 'alpha';
    save(); render();
  });

  /* ── export / import ──────────────────────────────────────────── */

  els.exportBtn.addEventListener('click', function () {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'huskeliste-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    els.menu.open = false;
    toast('Eksporteret.');
  });

  els.importBtn.addEventListener('click', function () {
    els.menu.open = false;
    els.importFile.click();
  });

  els.importFile.addEventListener('change', function () {
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        if (data && data.version === 2 && Array.isArray(data.items)) {
          state = normalize(data);
        } else if (Array.isArray(data)) {
          const gid = sortedTags()[0].id;
          const add = data.map(function (x, i) {
            const text = typeof x === 'string' ? x : (x && x.text);
            return text ? mkItem(String(text).trim(), [gid], maxOrder() + i + 1) : null;
          }).filter(Boolean);
          state.items = state.items.concat(add);
        } else {
          throw new Error('format');
        }
        orderSeq = maxOrder();
        save(); render();
        toast('Importeret.');
      } catch (e) {
        toast('Kunne ikke læse filen.');
      } finally {
        els.importFile.value = '';
      }
    };
    reader.onerror = function () { toast('Kunne ikke læse filen.'); els.importFile.value = ''; };
    reader.readAsText(file);
  });

  /* ── init ─────────────────────────────────────────────────────── */

  load();
  render();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    });
  }
})();
