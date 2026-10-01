/* Free AI Hub — админ-панель. Без зависимостей. Весь пользовательский текст выводится ТОЛЬКО через textContent / createTextNode. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { csrf: '', page: 0, size: 30, total: 0, sel: '', filters: {}, tab: 'sessions', facets: { providers: [], models: [] } };

  /* ---------- DOM-помощники ---------- */
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  function toast(text, kind = '') { const t = h('div', { class: 'toast ' + kind, text }); $('toasts').append(t); setTimeout(() => t.remove(), 3500); }

  const fmtDT = ms => ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtTime = ms => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtBytes = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' ГБ' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1e3)) + ' КБ';
  const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return (m > 10 && m < 15) ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };

  /* безопасная подсветка совпадений: режем строку на текстовые узлы и <mark> */
  function highlight(text, q) {
    const out = document.createDocumentFragment();
    if (!q) { out.append(document.createTextNode(text)); return out; }
    const low = text.toLowerCase(), ql = q.toLowerCase(); let i = 0, at;
    while ((at = low.indexOf(ql, i)) >= 0 && ql) {
      if (at > i) out.append(document.createTextNode(text.slice(i, at)));
      out.append(h('mark', { text: text.slice(at, at + ql.length) })); i = at + ql.length;
    }
    out.append(document.createTextNode(text.slice(i)));
    return out;
  }

  /* ---------- API ---------- */
  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (method !== 'GET') { headers['X-CSRF-Token'] = state.csrf; if (body !== undefined) headers['Content-Type'] = 'application/json'; }
    const r = await fetch('/api/admin' + path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { showLogin(); throw new Error('Требуется вход'); }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error((data && (data.error || data.detail)) || 'Ошибка ' + r.status);
    return data;
  }
  function download(path) { // GET с кукой: браузер сам скачает файл
    const a = h('a', { href: '/api/admin' + path, download: '' }); document.body.append(a); a.click(); a.remove();
  }

  /* ---------- диалог подтверждения ---------- */
  function confirmDlg({ title, text, ok = 'Удалить', typed = '' }) {
    return new Promise(res => {
      const d = $('dlg'); $('dlgTitle').textContent = title; $('dlgText').textContent = text;
      const wrap = $('dlgInputWrap'), inp = $('dlgInput'), okb = $('dlgOk');
      okb.textContent = ok; wrap.hidden = !typed; inp.value = ''; inp.placeholder = typed ? 'Введите: ' + typed : '';
      okb.disabled = !!typed; inp.oninput = () => { okb.disabled = inp.value.trim() !== typed; };
      d.onclose = () => res(d.returnValue === 'ok'); d.returnValue = 'cancel';
      d.showModal(); (typed ? inp : okb).focus();
    });
  }

  /* ---------- вход / выход ---------- */
  // Форма входа — отдельная публичная страница /admin/ (login.html). Эта панель доступна только с действующей сессией.
  function showLogin() { location.replace('/admin/'); }
  async function showMain() {
    $('mainView').hidden = false;
    await loadFacets(); await loadSessions(); applyPaused();
  }
  $('logoutBtn').addEventListener('click', async () => { try { await api('/logout', { method: 'POST' }); } catch { /* */ } state.csrf = ''; showLogin(); });

  /* ---------- вкладки ---------- */
  function setTab(t) {
    state.tab = t;
    for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const n of ['sessions', 'stats', 'settings']) $('view-' + n).hidden = n !== t;
    if (t === 'stats') loadStats(); if (t === 'settings') loadSettings();
  }
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ---------- тема ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t; $('themeBtn').textContent = 'Тема: ' + (t === 'cyber' ? 'кибер' : 'тёмная');
    try { localStorage.setItem('fah.admin.theme', t); } catch { /* */ }
  }
  $('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'cyber' ? 'dark' : 'cyber'));

  /* ---------- сессии ---------- */
  function readFilters() {
    const f = {}; const q = $('fQ').value.trim(); if (q) f.q = q;
    if ($('fProv').value) f.provider = $('fProv').value; if ($('fModel').value) f.model = $('fModel').value;
    if ($('fFrom').value) f.since = new Date($('fFrom').value + 'T00:00:00').getTime();
    if ($('fTo').value) f.until = new Date($('fTo').value + 'T00:00:00').getTime() + 86400000;
    return f;
  }
  const qs = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

  async function loadFacets() {
    try {
      const f = await api('/facets'); state.facets = f;
      const pv = $('fProv').value; const sel = $('fProv'); clear(sel).append(h('option', { value: '', text: 'Все провайдеры' }), ...f.providers.map(p => h('option', { value: p, text: p }))); sel.value = pv;
      fillModels();
    } catch (e) { toast(e.message, 'err'); }
  }
  function fillModels() {
    const p = $('fProv').value, cur = $('fModel').value; const sel = $('fModel');
    const ms = state.facets.models.filter(m => !p || m.provider === p);
    clear(sel).append(h('option', { value: '', text: 'Все модели' }), ...ms.map(m => h('option', { value: m.model, text: m.model })));
    sel.value = ms.some(m => m.model === cur) ? cur : '';
  }
  $('fProv').addEventListener('change', fillModels);

  async function loadSessions() {
    state.filters = readFilters();
    try {
      const d = await api('/sessions' + qs({ ...state.filters, limit: state.size, offset: state.page * state.size }));
      state.total = d.total; renderList(d.items);
    } catch (e) { toast(e.message, 'err'); }
  }
  function renderList(items) {
    const ul = clear($('sessionList'));
    $('listInfo').textContent = state.total + ' ' + plural(state.total, 'сессия', 'сессии', 'сессий');
    const pages = Math.max(1, Math.ceil(state.total / state.size));
    $('pageInfo').textContent = (state.page + 1) + ' / ' + pages;
    $('prevPage').disabled = state.page === 0; $('nextPage').disabled = state.page + 1 >= pages;
    if (!items.length) ul.append(h('li', { class: 'empty' }, h('p', { text: 'Ничего не найдено.' })));
    for (const s of items) {
      const li = h('li', { class: s.session_id === state.sel ? 'sel' : '' },
        h('button', { type: 'button', 'data-sid': s.session_id, onclick: () => openSession(s.session_id) },
          h('div', { class: 's-top' }, h('span', { text: fmtDT(s.last_seen) }), h('span', { text: s.country || '—' })),
          h('div', { class: 's-prev', text: s.preview || '(нет текста)' }),
          h('div', { class: 's-meta' },
            h('span', { class: 'pill', text: s.msg_count + ' сообщ.' }),
            h('span', { text: [s.last_provider, s.last_model].filter(Boolean).join(' · ') || '—' }))));
      ul.append(li);
    }
  }
  $('filters').addEventListener('submit', e => { e.preventDefault(); state.page = 0; loadSessions(); });
  $('fReset').addEventListener('click', () => { $('filters').reset(); fillModels(); state.page = 0; loadSessions(); });
  $('prevPage').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); loadSessions(); });
  $('nextPage').addEventListener('click', () => { state.page++; loadSessions(); });

  async function openSession(sid) {
    state.sel = sid;
    document.querySelectorAll('.slist li').forEach(li => li.classList.toggle('sel', li.firstChild && li.firstChild.dataset && li.firstChild.dataset.sid === sid));
    try {
      const d = await api('/sessions/' + encodeURIComponent(sid)); const s = d.session;
      $('convEmpty').hidden = true; $('convBody').hidden = false;
      $('convTitle').textContent = 'Сессия ' + s.session_id;
      clear($('convMeta')).append(
        h('span', {}, 'Первое: ', h('b', { text: fmtDT(s.first_seen) })), h('span', {}, 'Последнее: ', h('b', { text: fmtDT(s.last_seen) })),
        h('span', {}, 'Страна: ', h('b', { text: s.country || '—' })), h('span', {}, 'Язык: ', h('b', { text: s.lang || '—' })),
        h('span', {}, 'Сайт: ', h('b', { text: s.origin || '—' })), h('span', {}, 'Сообщений: ', h('b', { text: d.messages.length })));
      const box = clear($('msgs')); const q = state.filters.q || ''; let lastChat = null;
      for (const m of d.messages) {
        if (m.chat_id !== lastChat) { box.append(h('div', { class: 'chat-sep', text: 'чат ' + m.chat_id }));  lastChat = m.chat_id; }
        const who = m.role === 'user' ? 'Пользователь' : [m.provider, m.model].filter(Boolean).join(' · ') || 'Ассистент';
        box.append(h('div', { class: 'msg ' + m.role }, h('div', { class: 'who' }, h('b', { text: who }), h('span', { text: fmtTime(m.ts) + ' · ' + fmtDT(m.ts).split(',')[0] })), h('div', { class: 'body' }, highlight(m.text, q))));
      }
      const first = box.querySelector('mark'); if (first) first.scrollIntoView({ block: 'center' });
    } catch (e) { toast(e.message, 'err'); }
  }
  $('convDel').addEventListener('click', async () => {
    if (!state.sel) return;
    if (!await confirmDlg({ title: 'Удалить сессию?', text: 'Все сообщения этой сессии будут удалены безвозвратно.' })) return;
    try { const r = await api('/sessions/' + encodeURIComponent(state.sel), { method: 'DELETE' }); toast('Удалено сообщений: ' + r.deleted, 'ok');
      state.sel = ''; $('convBody').hidden = true; $('convEmpty').hidden = false; await loadFacets(); await loadSessions(); } catch (e) { toast(e.message, 'err'); }
  });
  $('convJson').addEventListener('click', () => download('/export' + qs({ format: 'json', session_id: state.sel })));
  $('convCsv').addEventListener('click', () => download('/export' + qs({ format: 'csv', session_id: state.sel })));
  $('expJson').addEventListener('click', () => download('/export' + qs({ format: 'json', ...state.filters })));
  $('expCsv').addEventListener('click', () => download('/export' + qs({ format: 'csv', ...state.filters })));
  $('expAllJson').addEventListener('click', () => download('/export?format=json'));
  $('expAllCsv').addEventListener('click', () => download('/export?format=csv'));

  /* ---------- статистика ---------- */
  function hbars(el, rows, label) {
    clear(el); const max = Math.max(1, ...rows.map(r => r.n));
    if (!rows.length) { el.append(h('p', { class: 'muted small', text: 'Нет данных за период.' })); return; }
    for (const r of rows) {
      const fill = h('i', { class: 'fill' }); fill.style.display = 'block'; fill.style.width = Math.max(2, Math.round(r.n / max * 100)) + '%';
      el.append(h('div', { class: 'hb' }, h('span', { class: 'name', title: label(r), text: label(r) }), h('div', { class: 'track' }, fill), h('span', { class: 'n', text: r.n })));
    }
  }
  async function loadStats() {
    try {
      const d = await api('/stats' + qs({ days: $('statDays').value, tz: -new Date().getTimezoneOffset() }));
      clear($('kpis')).append(
        ...[['Сессий всего', d.total_sessions], ['Сообщений всего', d.total_messages], ['Активных сессий за период', d.period_sessions], ['Сообщений за период', d.period_messages], ['Размер базы', fmtBytes(d.db_bytes)]]
          .map(([l, v]) => h('div', { class: 'card kpi' }, h('b', { text: v }), h('span', { text: l }))));
      const box = clear($('chartDays')); const max = Math.max(1, ...d.per_day.map(x => x.user_msgs + x.assistant_msgs));
      for (const x of d.per_day) {
        const bar = h('div', { class: 'bar', title: `${x.day}: вопросов ${x.user_msgs}, ответов ${x.assistant_msgs}, сессий ${x.sessions}` });
        const a = h('i', { class: 'a' }), u = h('i', { class: 'u' });
        a.style.height = (x.assistant_msgs / max * 100) + '%'; u.style.height = (x.user_msgs / max * 100) + '%';
        bar.append(u, a); box.append(bar);
      }
      if (!d.per_day.length) box.append(h('p', { class: 'muted small', text: 'Нет данных за период.' }));
      const old = document.getElementById('axis'); if (old) old.remove();
      if (d.per_day.length) $('chartDays').after(h('div', { id: 'axis', class: 'axis' }, h('span', { text: d.per_day[0].day }), h('span', { text: 'макс. за день: ' + max }), h('span', { text: d.per_day[d.per_day.length - 1].day })));
      hbars($('topProv'), d.providers, r => r.name); hbars($('topModels'), d.models, r => r.name + ' (' + r.provider + ')'); hbars($('topCountries'), d.countries, r => r.name);
    } catch (e) { toast(e.message, 'err'); }
  }
  $('statDays').addEventListener('change', loadStats);

  /* ---------- настройки ---------- */
  function applyPaused() { $('pausedBadge').hidden = !state.paused; }
  async function loadSettings() {
    try {
      const s = await api('/settings'); state.paused = s.logging_paused; $('pauseToggle').checked = s.logging_paused; applyPaused();
      $('setInfo').textContent = `Лимит текста: ${s.max_text_chars} симв.; лимит запросов: ${s.rate_limit_per_min}/мин на IP; размер базы: ${fmtBytes(s.db_bytes)}.`;
      $('retInfo').textContent = s.retention_days ? `Сообщения старше ${s.retention_days} дн. удаляются автоматически (RETENTION_DAYS).` : 'Автоудаление выключено (RETENTION_DAYS=0).';
    } catch (e) { toast(e.message, 'err'); }
  }
  $('pauseToggle').addEventListener('change', async () => {
    const v = $('pauseToggle').checked;
    try { await api('/settings', { method: 'PUT', body: { logging_paused: v } }); state.paused = v; applyPaused(); toast(v ? 'Запись приостановлена' : 'Запись возобновлена', 'ok'); }
    catch (e) { $('pauseToggle').checked = !v; toast(e.message, 'err'); }
  });
  $('cleanupBtn').addEventListener('click', async () => { try { const r = await api('/cleanup', { method: 'POST', body: {} }); toast(`Удалено сообщений: ${r.messages}, сессий: ${r.sessions}`, 'ok'); loadSessions(); } catch (e) { toast(e.message, 'err'); } });
  $('purgeBtn').addEventListener('click', async () => {
    if (!await confirmDlg({ title: 'Удалить ВСЕ данные?', text: 'Будут безвозвратно удалены все сессии и сообщения. Сначала сделайте экспорт, если нужна копия.', ok: 'Удалить всё', typed: 'УДАЛИТЬ' })) return;
    try { const r = await api('/purge', { method: 'POST', body: { confirm: 'DELETE ALL' } }); toast('Удалено сообщений: ' + r.deleted, 'ok'); state.sel = ''; $('convBody').hidden = true; $('convEmpty').hidden = false; await loadFacets(); await loadSessions(); }
    catch (e) { toast(e.message, 'err'); }
  });

  /* ---------- запуск ---------- */
  async function boot() {
    try { applyTheme(localStorage.getItem('fah.admin.theme') === 'dark' ? 'dark' : 'cyber'); } catch { applyTheme('cyber'); }
    let me;
    try { me = await (await fetch('/api/admin/me', { credentials: 'same-origin' })).json(); } catch { toast('Нет связи с сервером', 'err'); return; }
    if (!me.authenticated) { showLogin(); return; }
    state.csrf = me.csrf; state.paused = me.logging_paused; await showMain();
  }
  boot();
})();
