/* DOM-помощники: toast, баннер, диалог подтверждения, всплывающее окно (popover / bottom-sheet). */
import { esc } from './util.js';

export const $ = id => document.getElementById(id);
export const isMobile = () => matchMedia('(max-width: 820px)').matches;

/* ---------- toast + aria-live ---------- */
export function toast(text, { kind = '', ms = 2600 } = {}) {
  const box = $('toasts'); const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text; box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, ms);
}
export function announce(text) { const l = $('live'); l.textContent = ''; setTimeout(() => { l.textContent = text; }, 30); }

/* ---------- баннер ---------- */
let bannerTimer;
export function showBanner(text, { kind = 'warn', sticky = false, actions = [] } = {}) {
  const b = $('banner'); clearTimeout(bannerTimer);
  if (!text) { b.hidden = true; return; }
  b.className = 'banner ' + kind; b.innerHTML = '';
  const s = document.createElement('span'); s.textContent = text; b.appendChild(s);
  for (const a of actions) { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = a.label; btn.onclick = () => { b.hidden = true; a.run(); }; b.appendChild(btn); }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'banner-x'; x.setAttribute('aria-label', 'Закрыть'); x.textContent = '✕'; x.onclick = () => { b.hidden = true; }; b.appendChild(x);
  b.hidden = false;
  if (!sticky) bannerTimer = setTimeout(() => { b.hidden = true; }, 20000);
}

/* ---------- диалог подтверждения ---------- */
export function confirmDialog({ title, html, ok = 'Продолжить', cancel = 'Отмена', danger = false }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.className = 'dialog';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><div class="dialog-body">${html}</div><div class="dialog-actions"><button class="btn" value="cancel">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" value="ok" autofocus>${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok'; d.remove(); resolve(v); });
    d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); });
    if (typeof d.showModal === 'function') d.showModal(); else { d.setAttribute('open', ''); }
  });
}

/* ---------- popover ---------- */
let current = null;
export function closePopover(restoreFocus = true) {
  if (!current) return;
  const c = current; current = null;
  const pop = $('popover'); pop.hidden = true; pop.innerHTML = ''; pop.className = 'popover';
  document.removeEventListener('pointerdown', c.onDown, true); document.removeEventListener('keydown', c.onKey, true); window.removeEventListener('resize', c.onResize);
  $('scrim').classList.remove('sheet');
  if (c.anchor) { c.anchor.setAttribute('aria-expanded', 'false'); if (restoreFocus) c.anchor.focus({ preventScroll: true }); }
  if (c.onClose) c.onClose();
}
export const popoverOpen = () => !!current;

/** anchor — кнопка; build(container, close) наполняет содержимое. wide — расширенный (список моделей). */
export function openPopover(anchor, build, { wide = false, label = '' } = {}) {
  closePopover(false);
  const pop = $('popover'); pop.innerHTML = ''; pop.className = 'popover' + (wide ? ' wide' : '');
  pop.setAttribute('aria-label', label); pop.hidden = false;
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  const close = (rf = true) => closePopover(rf);
  build(pop, close);
  const place = () => {
    if (isMobile()) { pop.classList.add('sheet'); pop.style.cssText = ''; $('scrim').classList.add('sheet'); return; }
    pop.classList.remove('sheet'); $('scrim').classList.remove('sheet');
    const r = anchor.getBoundingClientRect(); const vw = innerWidth, vh = innerHeight;
    const w = Math.min(wide ? 460 : 380, vw - 24);
    let left = Math.max(12, Math.min(r.left, vw - w - 12));
    pop.style.width = w + 'px'; pop.style.left = left + 'px';
    const below = vh - r.bottom - 12, above = r.top - 12;
    if (below >= 300 || below >= above) { pop.style.top = (r.bottom + 6) + 'px'; pop.style.bottom = 'auto'; pop.style.maxHeight = Math.max(240, below - 6) + 'px'; }
    else { pop.style.bottom = (vh - r.top + 6) + 'px'; pop.style.top = 'auto'; pop.style.maxHeight = Math.max(240, above - 6) + 'px'; }
  };
  place();
  const onDown = e => { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) closePopover(false); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePopover(true); } };
  const onResize = () => place();
  current = { anchor, onDown, onKey, onResize, onClose: null };
  document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);
  $('scrim').classList.toggle('sheet', isMobile());
  return close;
}
export function onPopoverClose(fn) { if (current) current.onClose = fn; }

/* ---------- диалог ввода текста ---------- */
export function promptDialog({ title, value = '', ok = 'Сохранить', placeholder = '' }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.className = 'dialog';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><div class="dialog-body"><input class="field" name="v" maxlength="120" placeholder="${esc(placeholder)}" aria-label="${esc(title)}"></div><div class="dialog-actions"><button class="btn" value="cancel">Отмена</button><button class="btn primary" value="ok">${esc(ok)}</button></div></form>`;
    const input = d.querySelector('input'); input.value = value;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? input.value : null; d.remove(); resolve(v); });
    d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.close('ok'); } });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    input.focus(); input.select();
  });
}
