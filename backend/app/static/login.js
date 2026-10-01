/* Free AI Hub — страница входа в админ-панель. Содержит только форму пароля; панель и данные отдаёт бэкенд после входа. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PANEL = '/admin/panel/';
  const form = $('loginForm'), err = $('loginErr');
  function show(msg) { err.hidden = !msg; err.textContent = msg || ''; $('pw').focus(); }

  // уже вошли (действующая кука) — сразу в панель
  fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(me => {
      if (me && me.authenticated) location.replace(PANEL);
      else if (me && me.admin_enabled === false) show('Админ-панель отключена: на сервере не задан пароль.');
    })
    .catch(() => { /* форма остаётся доступной */ });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true; show('');
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ password: $('pw').value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        let m = d.error || 'Ошибка входа';
        if (r.status === 429) m += ' (повторите через ' + (r.headers.get('retry-after') || '?') + ' с)';
        $('pw').value = ''; show(m); return;
      }
      $('pw').value = '';
      location.assign(PANEL);
    } catch { show('Нет связи с сервером'); } finally { btn.disabled = false; }
  });
})();
