/* Free AI Hub v2 — точка входа: собирает UI из модулей. Без сборки, без зависимостей. */
import { esc, sleep, debounce, estimateTokens, fmtAgo, fmtBytes, abortError } from './util.js';
import { store } from './store.js';
import { PROVIDERS, pById, FALLBACK_ORDER, SYSTEM_PRESETS, SUGGESTIONS, supportsVision } from './providers.js';
import { state, saveSettings, saveSettingsNow, saveKeys, getKey, slotPid, slotProvider, slotModel, setSlotModel, slotMsgs, isBusy, modelInfo, modelLabel } from './state.js';
import { explainError, isFallbackWorthy, setProxy, baseOf } from './api.js';
import { generate, prepareMessages } from './generate.js';
import { getModels, staticModels, favs, healthStore, checkProvider, healthLabel, providerSummary, HEALTH_STALE } from './models.js';
import { ChatStore, newChat, chatTitleFrom, exportMarkdown, exportName } from './chats.js';
import { $, toast, announce, showBanner, confirmDialog, promptDialog, openPopover, closePopover, popoverOpen, isMobile } from './ui.js';
import { createMsgNode, paintMsg, paintActions, setStatus, emptyStateNode } from './messages.js';
import { localSupported, webgpuAvailable } from './local.js';

const chats = new ChatStore(store);
const S = state.settings;
const nodes = { A: [], B: [] };          // refs отрисованных сообщений по слотам
const boxes = { A: $('msgsA'), B: $('msgsB') };
const el = {
  input: $('input'), send: $('sendBtn'), stop: $('stopBtn'), est: $('est'), sidebar: $('sidebar'), scrim: $('scrim'),
  chatList: $('chatList'), chatSearch: $('chatSearch')
};
const SLOTS = () => (S.compare ? ['A', 'B'] : ['A']);
const dotClass = h => (h ? h.s : 'unk');

/* ============================== тема ============================== */
const THEME_ICON = {
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/></svg>'
};
const mqLight = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const pref = S.theme || 'auto', cyber = S.cyber === true;
  // кибер-панк всегда работает поверх тёмной темы; при выключении возвращается выбранная тема (авто/тёмная/светлая)
  const eff = cyber ? 'dark' : pref === 'auto' ? (mqLight.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = eff; document.documentElement.dataset.themePref = pref;
  document.documentElement.classList.toggle('cyber', cyber);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = cyber ? '#07040f' : eff === 'light' ? '#f5f6fa' : '#0a0d14';
  $('themeBtn').innerHTML = THEME_ICON[pref]; $('themeBtn').title = 'Тема: ' + ({ auto: 'как в системе', dark: 'тёмная', light: 'светлая' }[pref]);
  $('themeSel').value = pref;
  $('cyberBtn').setAttribute('aria-pressed', String(cyber));
}
function toggleCyber() {
  S.cyber = !(S.cyber === true); saveSettingsNow();
  const root = document.documentElement;
  if (S.cyber) { root.classList.add('cy-boot'); setTimeout(() => root.classList.remove('cy-boot'), 700); }
  applyTheme();
  toast(S.cyber ? '⚡ Кибер-панк включён' : 'Кибер-панк выключен — вернулась тема «' + ({ auto: 'как в системе', dark: 'тёмная', light: 'светлая' }[S.theme || 'auto']) + '»');
}
mqLight.addEventListener('change', () => { if ((S.theme || 'auto') === 'auto') applyTheme(); });

/* ============================== вкладки ============================== */
function setTab(t, focus) {
  S.tab = t; saveSettings();
  for (const b of document.querySelectorAll('.tabs [role=tab]')) {
    const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    $('pane-' + b.dataset.tab).hidden = !on; if (on && focus) b.focus();
  }
  if (t === 'chats') renderChatList();
}

/* ============================== боковая панель ============================== */
function openSidebar(v) {
  if (isMobile()) { el.sidebar.classList.toggle('open', v); el.scrim.classList.toggle('show', v); document.body.classList.toggle('no-scroll', v); $('main').inert = !!v; if (v) { el.sidebar.setAttribute('role', 'dialog'); el.sidebar.setAttribute('aria-modal', 'true'); } else { el.sidebar.removeAttribute('role'); el.sidebar.removeAttribute('aria-modal'); } if (v) $('closeSidebar').focus(); else $('openSidebar').focus(); }
  else { document.getElementById('app').classList.toggle('collapsed', !v); S.collapsed = !v; saveSettings(); }
}
// ловушка фокуса в мобильном drawer: Tab/Shift+Tab не уходят за пределы панели
el.sidebar.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !isMobile() || !el.sidebar.classList.contains('open')) return;
  const f = [...el.sidebar.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || !el.sidebar.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
const sidebarIsOpen = () => (isMobile() ? el.sidebar.classList.contains('open') : !document.getElementById('app').classList.contains('collapsed'));

/* ============================== модели ============================== */
const listLoading = {};
async function loadList(pid, { force = false } = {}) {
  const p = pById(pid);
  if (listLoading[pid] && !force) return listLoading[pid];
  const job = (async () => {
    const r = await getModels(p, {
      key: getKey(pid), customUrl: S.customUrl, force, store,
      onUpdate: nr => { state.lists[pid] = Object.assign({}, nr); afterListChange(pid); }
    });
    state.lists[pid] = r;
    return r;
  })();
  listLoading[pid] = job;
  try { return await job; } finally { delete listLoading[pid]; }
}
function afterListChange(pid) {
  for (const slot of ['A', 'B']) if (slotPid(slot) === pid) { ensureModel(slot); renderSlotCard(slot); }
  updateCur();
}
function bestModel(p) {
  const l = (state.lists[p.id] && state.lists[p.id].list) || staticModels(p);
  const okOne = l.find(m => { const h = healthStore.get(p.id, m.id, store); return h && (h.s === 'ok') && !m.flaky; });
  if (p.defaultModel && l.some(m => m.id === p.defaultModel)) { const h = healthStore.get(p.id, p.defaultModel, store); if (!h || h.s !== 'fail') return p.defaultModel; }
  return (okOne || l.find(m => !m.flaky) || l[0] || {}).id || '';
}
function ensureModel(slot) {
  const p = slotProvider(slot); const cur = slotModel(slot);
  const l = (state.lists[p.id] && state.lists[p.id].list) || [];
  if (p.custom && !l.length) return;
  if (cur && l.some(m => m.id === cur)) return;
  if (!l.length) return;
  setSlotModel(slot, bestModel(p));
}

async function selectProvider(slot, pid, { silent } = {}) {
  if (slot === 'A') { S.provider = pid; } else { S.providerB = pid; S.modelB = ''; }
  saveSettings();
  renderSlotCard(slot); updateCur();
  const r = await loadList(pid);
  if (slotPid(slot) !== pid) return;
  ensureModel(slot);
  renderSlotCard(slot); updateCur();
  if (slot === 'A') {
    if (r.error && !silent) showBanner(r.error);
    else if (!silent) showBanner('');
    if (pById(pid).keyMode === 'required' && !getKey(pid)) $('keyBoxA').open = true;
  }
}

/* --------- карточки слотов в боковой панели --------- */
function badgeHtml(t) {
  const cls = /без ключа/.test(t) ? 'ok' : /нужен ключ|прокси/.test(t) ? 'key' : /лимит|строгие|нестабил|медленно|волонт|загрузка/.test(t) ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(t)}</span>`;
}
function providerLogo(p) { return `<span class="plogo g-${p.group}" style="--h:${[...p.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)}" aria-hidden="true">${esc(p.short.slice(0, 1).toUpperCase())}</span>`; }

function renderSlotCard(slot) {
  const p = slotProvider(slot); const mid = slotModel(slot); const sfx = slot;
  $('provBtn' + sfx).innerHTML = `${providerLogo(p)}<span class="pi-text"><b>${esc(p.name)}</b><small>${esc(p.group === 'keyless' ? 'без ключа' : p.group === 'local' ? 'на вашем устройстве' : p.keyMode === 'required' ? 'нужен ключ' : 'свой сервер')}</small></span><span class="chev" aria-hidden="true"></span>`;
  $('provBtn' + sfx).setAttribute('aria-label', 'Провайдер: ' + p.name + '. Нажмите, чтобы изменить');
  const info = modelInfo(p.id, mid); const h = mid ? healthStore.get(p.id, mid, store) : null;
  const loading = !state.lists[p.id];
  $('modelBtn' + sfx).innerHTML = `<span class="dot ${dotClass(h)}" aria-hidden="true"></span><span class="pi-text"><b>${esc(loading ? 'Загрузка списка…' : (info && info.label) || mid || 'Выберите модель')}</b><small>${esc(info && info.meta || (mid && mid !== (info && info.label) ? mid : ''))}</small></span><span class="chev" aria-hidden="true"></span>`;
  $('modelBtn' + sfx).setAttribute('aria-label', 'Модель: ' + ((info && info.label) || mid || 'не выбрана') + '. Нажмите, чтобы изменить');
  $('provInfo' + sfx).innerHTML = `<div class="badges">${(p.tags || []).map(badgeHtml).join('')}</div><p class="hint">${esc(p.hint || '')}</p>`;
  if (slot === 'A') {
    const l = state.lists[p.id];
    const sum = l ? providerSummary(p, l.list, store) : null;
    const canCheck = p.type !== 'local' && !(p.keyMode === 'required' && !getKey(p.id)) && !(p.custom && !S.customUrl) && !(p.needsProxy && !baseOf(p)) && l && l.list.length;
    $('checkBtnA').disabled = !canCheck || checking;
    $('healthSumA').textContent = !sum ? '' : sum.checked ? `${sum.ok} из ${sum.checked} работают · ${fmtAgo(sum.ts)}` : (canCheck ? 'не проверялось' : '');
    $('healthSumA').classList.toggle('stale', !!(sum && sum.stale));
    const isCustom = !!p.custom;
    $('customFields').classList.toggle('show', isCustom);
    $('keyBoxA').hidden = p.keyMode === 'none' || p.type === 'local';
    $('keyInput').value = state.keys[p.id] || '';
    $('keyLink').href = p.keyUrl || '#'; $('keyLink').hidden = !p.keyUrl;
    $('keyLink').textContent = p.custom ? 'Список публичных API ↗' : (p.keyMode === 'required' ? 'Где взять бесплатный ключ ↗' : 'Получить ключ (необязательно) ↗');
  } else {
    $('keyNoteB').hidden = !(p.keyMode === 'required' && !getKey(p.id));
  }
}

/* ============================== всплывающие списки ============================== */
function openProviderPicker(slot) {
  const anchor = $('provBtn' + slot);
  openPopover(anchor, (pop, close) => {
    const groups = [['keyless', 'Без ключа'], ['local', 'В браузере (без сервера)'], ['proxy', 'Без ключа, но нужен свой CORS-прокси'], ['key', 'С ключом / свой сервер']];
    let html = '<div class="pop-title">Провайдер</div><div class="pop-scroll" role="listbox" aria-label="Провайдеры">';
    for (const [g, title] of groups) {
      html += `<div class="pop-group">${esc(title)}</div>`;
      for (const p of PROVIDERS.filter(x => x.group === g)) {
        const l = state.lists[p.id]; const sum = l ? providerSummary(p, l.list, store) : null;
        const sel = p.id === slotPid(slot);
        html += `<button type="button" role="option" aria-selected="${sel}" class="prov-item${sel ? ' sel' : ''}" data-pid="${p.id}">${providerLogo(p)}<span class="pi-text"><b>${esc(p.name)}</b><small>${esc((p.tags || []).join(' · '))}${sum && sum.checked ? ` · ✓ ${sum.ok}/${sum.checked}` : ''}</small></span>${sel ? '<span class="check" aria-hidden="true">✓</span>' : ''}</button>`;
      }
    }
    pop.innerHTML = html + '</div>';
    pop.querySelectorAll('.prov-item').forEach(b => { b.onclick = () => { close(); selectProvider(slot, b.dataset.pid); }; });
    listKeynav(pop, '.prov-item', pop.querySelector('.prov-item.sel'));
  }, { label: 'Выбор провайдера' });
}

function listKeynav(pop, sel, focusEl, { autofocus = true } = {}) {
  const items = () => [...pop.querySelectorAll(sel)];
  pop.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const it = items(); if (!it.length) return;
    const i = it.indexOf(document.activeElement); let n;
    if (e.key === 'ArrowDown') n = i < 0 ? 0 : Math.min(it.length - 1, i + 1);
    else if (e.key === 'ArrowUp') { if (i <= 0 && pop.querySelector('input')) { pop.querySelector('input').focus(); e.preventDefault(); return; } n = Math.max(0, i - 1); }
    else if (e.key === 'Home') n = 0; else n = it.length - 1;
    e.preventDefault(); it[n].focus(); it[n].scrollIntoView({ block: 'nearest' });
  });
  if (autofocus) setTimeout(() => { const t = focusEl || items()[0]; if (t) { t.focus({ preventScroll: true }); t.scrollIntoView({ block: 'center' }); } }, 30);
}

async function openModelPicker(slot) {
  const p = slotProvider(slot); const anchor = $('modelBtn' + slot);
  if (!state.lists[p.id]) await loadList(p.id);
  const cap = 400;
  let filter = 'all', q = '';
  const build = (pop, close) => {
    pop.innerHTML = `<div class="pop-title">${esc(p.name)} <button type="button" class="btn small ghost pop-refresh" title="Обновить список моделей">⟳</button></div>
      <input type="search" class="field pop-search" placeholder="Поиск модели…" aria-label="Поиск модели" autocomplete="off">
      <div class="chips" role="group" aria-label="Фильтр"><button type="button" class="chip on" data-f="all">Все</button><button type="button" class="chip" data-f="fav">★ Избранные</button><button type="button" class="chip" data-f="ok">✓ Работают</button></div>
      <div class="pop-scroll" role="listbox" aria-label="Модели"></div><div class="pop-foot muted small"></div>`;
    const box = pop.querySelector('.pop-scroll'), foot = pop.querySelector('.pop-foot'), search = pop.querySelector('.pop-search');
    const paintList = () => {
      const l = (state.lists[p.id] && state.lists[p.id].list) || [];
      const fset = favs.get(store); const ql = q.trim().toLowerCase(); const cur = slotModel(slot);
      let arr = l.filter(m => (!ql || (m.id + ' ' + m.label + ' ' + (m.meta || '')).toLowerCase().includes(ql)));
      if (filter === 'fav') arr = arr.filter(m => fset.has(p.id + '|' + m.id));
      if (filter === 'ok') arr = arr.filter(m => { const h = healthStore.get(p.id, m.id, store); return h && (h.s === 'ok' || h.s === 'limited'); });
      arr = arr.slice().sort((a, b) => (fset.has(p.id + '|' + b.id) - fset.has(p.id + '|' + a.id)));
      const shown = arr.slice(0, cap);
      box.innerHTML = shown.map(m => {
        const h = healthStore.get(p.id, m.id, store); const isF = fset.has(p.id + '|' + m.id);
        const note = m.flaky ? `⚠ ${m.flaky}` : h && h.note ? h.note : '';
        const title = h ? `${healthLabel(h.s)} · проверено ${fmtAgo(h.ts)}${h.note ? ' · ' + h.note : ''}` : 'не проверялось';
        return `<div class="model-row${m.id === cur ? ' sel' : ''}" data-mid="${esc(m.id)}"><button type="button" role="option" aria-selected="${m.id === cur}" class="model-item" data-mid="${esc(m.id)}"><span class="dot ${dotClass(h)}" title="${esc(title)}"></span><span class="pi-text"><b>${esc(m.label)}${supportsVision(p, m.id) && !p.custom ? ' <span class="vis" title="Понимает изображения">👁</span>' : ''}</b><small>${esc([m.label !== m.id ? m.id : '', m.meta].filter(Boolean).join(' · '))}</small>${note ? `<small class="warn-note">${esc(note)}</small>` : ''}</span><span class="sr-only">${esc(title)}</span></button><button type="button" class="star${isF ? ' on' : ''}" data-star="${esc(m.id)}" aria-pressed="${isF}" aria-label="${isF ? 'Убрать из избранного' : 'В избранное'}: ${esc(m.label)}">${isF ? '★' : '☆'}</button></div>`;
      }).join('') || `<div class="pop-empty">${l.length ? 'Ничего не найдено' : (state.lists[p.id] && state.lists[p.id].error) || 'Список пуст'}</div>`;
      foot.textContent = `Показано ${shown.length} из ${l.length}${arr.length > cap ? ' (уточните поиск)' : ''}` + (state.lists[p.id] && state.lists[p.id].ts ? ` · список от ${fmtAgo(state.lists[p.id].ts)}` : '');
      if (p.custom) foot.textContent += ' · можно ввести ID модели вручную в блоке «Свой ключ»';
    };
    paintList();
    search.oninput = () => { q = search.value; paintList(); };
    search.onkeydown = e => { if (e.key === 'Enter') { const f = box.querySelector('.model-item'); if (f) { e.preventDefault(); f.click(); } } };
    pop.querySelectorAll('.chip').forEach(c => { c.onclick = () => { filter = c.dataset.f; pop.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); paintList(); }; });
    box.onclick = e => {
      const st = e.target.closest('[data-star]');
      if (st) { favs.toggle(p.id, st.dataset.star, store); paintList(); const n = box.querySelector(`[data-star="${CSS.escape(st.dataset.star)}"]`); if (n) n.focus(); return; }
      const it = e.target.closest('.model-item'); if (it) { close(); selectModel(slot, it.dataset.mid); }
    };
    pop.querySelector('.pop-refresh').onclick = async e => {
      const b = e.currentTarget; b.disabled = true; await loadList(p.id, { force: true }); b.disabled = false; paintList(); afterListChange(p.id);
      const r = state.lists[p.id]; toast(r.error ? 'Не удалось обновить список' : `Список обновлён: ${r.list.length}`, { kind: r.error ? 'err' : '' });
    };
    listKeynav(pop, '.model-item, .star', null, { autofocus: false });
    setTimeout(() => { if (!isMobile()) search.focus(); else { const s = box.querySelector('.model-row.sel .model-item'); if (s) s.scrollIntoView({ block: 'center' }); } }, 20);
    const sel0 = box.querySelector('.model-row.sel'); if (sel0) setTimeout(() => sel0.scrollIntoView({ block: 'center' }), 30);
  };
  openPopover(anchor, build, { wide: true, label: 'Выбор модели' });
}

async function selectModel(slot, mid) {
  const p = slotProvider(slot);
  if (p.type === 'local' && !S.localOk[mid]) {
    const m = modelInfo(p.id, mid) || staticModels(p).find(x => x.id === mid) || {};
    const gpu = await webgpuAvailable();
    const ok = await confirmDialog({
      title: 'Скачать модель в браузер?',
      html: `<p><b>${esc(m.label || mid)}</b> — файл ≈ <b>${esc(fmtBytes(m.size || 0))}</b>. Он скачивается один раз с Hugging Face и кэшируется браузером; затем модель работает <b>на вашем устройстве</b>, без сервера и без ключа.</p><p class="muted">${gpu ? 'Найден WebGPU — генерация будет быстрее.' : 'WebGPU не найден — будет использован WASM (медленнее, но работает).'} Библиотека transformers.js загрузится с jsDelivr. Мобильный трафик и память расходуются заметно; слабые устройства могут не потянуть.</p>`,
      ok: 'Скачать и использовать'
    });
    if (!ok) return;
    S.localOk[mid] = true;
  }
  setSlotModel(slot, mid); renderSlotCard(slot); updateCur();
}

/* ============================== заголовок ============================== */
function updateCur() {
  const a = slotProvider('A'), ma = slotModel('A');
  const nm = (p, mid) => `<b>${esc(p.short)}</b><small> · ${esc(modelLabel(p.id, mid) || 'модель не выбрана')}</small>`;
  const h = ma ? healthStore.get(a.id, ma, store) : null;
  $('curLabel').innerHTML = `<span class="dot ${dotClass(h)}" aria-hidden="true"></span><span class="cur-text">${nm(a, ma)}${S.compare ? ` <em>vs</em> ${nm(slotProvider('B'), slotModel('B'))}` : ''}</span><span class="chev" aria-hidden="true"></span>`;
  $('curLabel').setAttribute('aria-label', 'Текущая модель: ' + a.short + ' ' + modelLabel(a.id, ma) + '. Открыть выбор');
  $('headA').hidden = !S.compare; $('panelB').hidden = !S.compare;
  paintAttach();
  if (S.compare) {
    for (const s of ['A', 'B']) $('head' + s).innerHTML = `<span class="slot-tag${s === 'B' ? ' b' : ''}">${s === 'A' ? 'А' : 'Б'}</span><span class="plabel"><b>${esc(slotProvider(s).name)}</b> · ${esc(modelLabel(slotPid(s), slotModel(s)) || 'модель не выбрана')}</span>`;
  }
}

/* ============================== сообщения ============================== */
function atBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 90; }
function scrollDown(slot, force) { const b = boxes[slot]; if (force || b._stick !== false) b.scrollTop = b.scrollHeight; }
function initScroll(slot) {
  const b = boxes[slot]; const panel = b.parentElement;
  const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'jump'; jump.hidden = true; jump.setAttribute('aria-label', 'К последнему сообщению');
  jump.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
  panel.appendChild(jump);
  b._stick = true; b._jump = jump;
  b.addEventListener('scroll', () => { const nb = atBottom(b); b._stick = nb; jump.hidden = nb; }, { passive: true });
  jump.onclick = () => { b._stick = true; b.scrollTo({ top: b.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
}

function flagsFor(slot, i, msgs) {
  const m = msgs[i]; const last = i === msgs.length - 1;
  const lastUserNoReply = m.role === 'user' && last;
  return {
    isLast: last,
    canRegen: (m.role === 'assistant' && last) || lastUserNoReply,
    canEdit: slot === 'A' && m.role === 'user' && (last || (i === msgs.length - 2 && msgs[i + 1].role === 'assistant'))
  };
}
function refreshActions(slot) {
  const msgs = slotMsgs(slot);
  nodes[slot].forEach((r, i) => { if (!msgs[i]) return; Object.assign(r, flagsFor(slot, i, msgs), { m: msgs[i], index: i }); r.wrap.dataset.i = i; paintActions(r, isBusy()); });
}
function appendMsg(slot, i) {
  const msgs = slotMsgs(slot);
  const { wrap, refs } = createMsgNode(msgs[i], Object.assign({ slot, index: i }, flagsFor(slot, i, msgs)));
  const box = boxes[slot]; const empty = box.querySelector('.empty'); if (empty) empty.remove();
  box.appendChild(wrap); nodes[slot][i] = refs; return refs;
}
function pickPrompt(text) { el.input.value = text; autosize(); el.input.focus(); }
function renderSlot(slot) {
  const box = boxes[slot]; box.innerHTML = ''; nodes[slot] = [];
  const msgs = slotMsgs(slot);
  if (!msgs.length) {
    if (slot === 'A') box.appendChild(emptyStateNode(SUGGESTIONS, t => { pickPrompt(t); }, emptyCtx()));
    else box.appendChild(emptyStateNode([], () => {}, { title: 'Модель Б', sub: 'Здесь появится ответ второй модели на тот же запрос.' }));
    return;
  }
  msgs.forEach((_, i) => appendMsg(slot, i));
  scrollDown(slot, true);
}
function emptyCtx() {
  const p = slotProvider('A');
  if (p.group === 'key' && p.keyMode === 'required' && !getKey(p.id)) return { title: 'Нужен ключ для «' + p.name + '»', sub: 'Добавьте бесплатный ключ в блоке «Свой ключ» слева — или выберите провайдера без ключа (OVHcloud, ch.at, LLM7).' };
  if (p.type === 'local') return { title: 'Чем помочь?', sub: 'Модель работает прямо в вашем браузере: при первом запуске скачивается один раз, дальше — офлайн, текст никуда не отправляется.' };
  return { title: 'Чем помочь?', sub: 'Выберите модель в боковой панели и задайте вопрос. Запросы уходят напрямую к бесплатным AI API — без регистрации и ключей.' };
}
function renderAll() { paintAttach(); renderSlot('A'); if (S.compare) renderSlot('B'); else { boxes.B.innerHTML = ''; nodes.B = []; } }

/* ============================== генерация ============================== */
function busyUI() {
  const b = isBusy(); el.send.hidden = b; el.stop.hidden = !b;
  document.body.classList.toggle('busy', b);
  for (const s of ['A', 'B']) refreshActions(s);
}
function autosize() { el.input.style.height = 'auto'; el.input.style.height = Math.min(el.input.scrollHeight, Math.round(innerHeight * (isMobile() ? 0.3 : 0.4))) + 'px'; updateEst(); }
function ctxTokens() { return slotMsgs('A').reduce((n, m) => n + (m.error ? 0 : estimateTokens(m.content)), 0); }
function updateEst() {
  const t = estimateTokens(el.input.value);
  const ctx = ctxTokens();
  el.est.textContent = (el.input.value || ctx) ? `≈${t} ток. · контекст ≈${ctx}` : '';
}

/* ============================== озвучка ответа (Web Speech API, локально в браузере) ============================== */
function speak(m, btn) {
  const synth = window.speechSynthesis; if (!synth) return;
  if (synth.speaking) { synth.cancel(); document.querySelectorAll('[data-act=tts].on').forEach(b => b.classList.remove('on')); if (btn.dataset.playing === '1') { btn.dataset.playing = ''; return; } }
  const txt = m.content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/```[\s\S]*?```/g, ' (блок кода) ').replace(/[*_`#>|~]/g, '').replace(/\s+/g, ' ').trim();
  if (!txt) return;
  const u = new SpeechSynthesisUtterance(txt.slice(0, 6000));
  u.lang = /[а-яё]/i.test(txt) ? 'ru-RU' : 'en-US';
  const done = () => { btn.classList.remove('on'); btn.dataset.playing = ''; };
  u.onend = done; u.onerror = done;
  btn.classList.add('on'); btn.dataset.playing = '1';
  synth.speak(u);
}

/* ============================== вложения-картинки ============================== */
const MAX_IMAGES = 3;
let attachments = [];   // data-URL (JPEG/PNG, уменьшены до 1024 px)
const anyVision = () => SLOTS().some(s => supportsVision(slotProvider(s), slotModel(s)));
function paintAttach() {
  const on = anyVision();
  $('attachBtn').hidden = !on;
  const strip = $('attachStrip');
  strip.hidden = !attachments.length;
  strip.innerHTML = '';
  attachments.forEach((u, i) => {
    const d = document.createElement('div'); d.className = 'att';
    const im = document.createElement('img'); im.src = u; im.alt = 'Вложение ' + (i + 1);
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.setAttribute('aria-label', 'Убрать вложение ' + (i + 1)); b.dataset.rm = i;
    d.append(im, b); strip.appendChild(d);
  });
}
function downscale(file, maxSide = 1024) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Не удалось прочитать изображение')); };
    img.src = url;
  });
}
async function addFiles(files) {
  const imgs = [...files].filter(f => /^image\/(png|jpe?g|webp|gif)$/.test(f.type));
  if (!imgs.length) return;
  if (!anyVision()) { toast('Выбранная модель не понимает изображения. Выберите модель с 👁 (например, Qwen2.5-VL у OVHcloud).', { kind: 'err', ms: 4500 }); return; }
  for (const f of imgs) {
    if (attachments.length >= MAX_IMAGES) { toast(`Не больше ${MAX_IMAGES} изображений`, { kind: 'err' }); break; }
    if (f.size > 15e6) { toast('Файл больше 15 МБ — пропущен', { kind: 'err' }); continue; }
    try { attachments.push(await downscale(f)); } catch (e) { toast(e.message, { kind: 'err' }); }
  }
  paintAttach();
}

function fallbackCandidates(slot, tried) {
  const cur = slotProvider(slot);
  if (cur.type === 'local' || !S.autoFallback) return [];
  const otherSlot = slot === 'A' ? 'B' : 'A';
  const otherKey = S.compare ? slotPid(otherSlot) + '|' + slotModel(otherSlot) : '';
  const seen = new Set(tried); if (otherKey) seen.add(otherKey);
  const out = [];
  const needVision = (() => { const ms = slotMsgs(slot); const lu = [...ms].reverse().find(m => m.role === 'user'); return !!(lu && Array.isArray(lu._images) && lu._images.length); })();
  const usable = (p, mid) => { const k = p.id + '|' + mid; if (seen.has(k)) return false; if (needVision && !supportsVision(p, mid)) return false; const h = healthStore.get(p.id, mid, store); if (h && h.s === 'fail' && Date.now() - h.ts < HEALTH_STALE) return false; return true; };
  const add = (p, mid) => { if (mid && usable(p, mid)) { seen.add(p.id + '|' + mid); out.push({ p, model: mid }); } };
  const listOf = p => (state.lists[p.id] && state.lists[p.id].list) || staticModels(p);
  // 1) другие модели того же провайдера (429 у OVHcloud — лимит на модель)
  const same = listOf(cur).filter(m => !m.flaky).sort((a, b) => { const ha = healthStore.get(cur.id, a.id, store), hb = healthStore.get(cur.id, b.id, store); return ((hb && hb.s === 'ok') - (ha && ha.s === 'ok')); });
  if (cur.id !== 'horde') same.slice(0, 2).forEach(m => add(cur, m.id));
  // 2) другие провайдеры без ключа (AI Horde — только если он и выбран: волонтёры видят промпты)
  for (const pid of FALLBACK_ORDER) {
    const p = pById(pid); if (p.id === cur.id || p.id === 'horde') continue;
    const best = bestModel(p); add(p, best);
    if (p.id === 'ovh') listOf(p).filter(m => m.id !== best && !m.flaky).slice(0, 1).forEach(m => add(p, m.id));
  }
  return out.slice(0, 4);
}

async function runSlot(slot, userText, { regenerate = false, images = null } = {}) {
  const s = state.slots[slot]; const msgs = slotMsgs(slot);
  let p = slotProvider(slot); let model = slotModel(slot);
  if (userText != null) { const um = { role: 'user', content: userText, ts: Date.now() }; if (images && images.length) { um._images = images.slice(); um.imgN = images.length; } msgs.push(um); appendMsg(slot, msgs.length - 1); }
  const mk = (pp, mm) => `${pp.short} · ${modelLabel(pp.id, mm) || mm || '?'}`;
  const reply = { role: 'assistant', content: '', reasoning: '', label: mk(p, model), ts: Date.now(), _streaming: true, prov: p.id, model };
  msgs.push(reply);
  const refs = appendMsg(slot, msgs.length - 1);
  refs.m = reply; paintMsg(refs, true);
  refreshActions(slot);
  scrollDown(slot, true); if (boxes[slot]._jump) boxes[slot]._jump.hidden = true;
  s.busy = true; busyUI();
  const ac = new AbortController(); s.abort = ac;
  let raf = 0, lastPaint = 0;
  const paint = () => { raf = 0; lastPaint = performance.now(); paintMsg(refs, true); scrollDown(slot); };
  const schedule = () => { if (raf) return; const wait = Math.max(0, 70 - (performance.now() - lastPaint)); raf = setTimeout(() => requestAnimationFrame(paint), wait); };
  const t0 = performance.now();
  const hist = msgs.slice(0, -1);
  { const lu = [...hist].reverse().find(m => m.role === 'user'); if (lu && lu.imgN && !(lu._images && lu._images.length) && (regenerate || userText == null)) toast('Изображения из прошлой сессии не сохраняются — модель увидит только текст. Прикрепите их заново.', { kind: 'err', ms: 4500 }); }
  const tried = []; let candidates = null; let lastErr = null; let ok = false;
  const attemptWith = async (pp, mm, { maxWaitMs } = {}) => {
    const { messages, trimmed } = prepareMessages(hist, pp.ctxBudget || 12000);
    if (!supportsVision(pp, mm)) {
      if (messages.length && messages[messages.length - 1].images) throw new Error('Эта модель не понимает изображения. Выберите модель с поддержкой картинок (например, Qwen2.5-VL у OVHcloud) или уберите вложение.');
      for (const x of messages) delete x.images;
    }
    if (trimmed) toast(`Старые сообщения (${trimmed}) не вошли в контекст модели`, { ms: 3500 });
    if (pp.keyMode === 'required' && !getKey(pp.id)) { const { HttpError } = await import('./api.js'); throw new HttpError(401, ''); }
    if (pp.custom && !S.customUrl.trim()) throw new Error('Укажите Base URL эндпоинта в блоке «Свой ключ».');
    if (pp.needsProxy && !baseOf(pp)) throw new Error('Для «' + pp.name + '» нужен свой CORS-прокси: разверните proxy/worker.js и укажите адрес в «Настройки → CORS-прокси».');
    if (!mm) throw new Error('Не выбрана модель.');
    reply.content = ''; reply.reasoning = '';
    const r = await generate(pp, {
      model: mm, messages, system: (document.getElementById('systemPrompt').value || '').trim(), temp: S.temp, maxTokens: S.maxTokens || 0, key: getKey(pp.id), customUrl: S.customUrl
    }, {
      signal: ac.signal, maxWaitMs,
      onDelta: t => { reply.content += t; schedule(); },
      onReasoning: t => { reply.reasoning += t; schedule(); },
      onStatus: st => setStatus(refs, st)
    });
    reply.usage = r.usage || null; reply.finish = r.finish || '';
    return r;
  };
  try {
    try {
      tried.push(p.id + '|' + model);
      await attemptWith(p, model, { maxWaitMs: S.autoFallback && p.type !== 'local' && S.compare === false ? 25000 : (S.autoFallback && p.type !== 'local' ? 40000 : undefined) });
      ok = true;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      if (reply.content || !isFallbackWorthy(e)) throw e;
      candidates = fallbackCandidates(slot, tried);
      for (const c of candidates) {
        if (ac.signal.aborted) throw abortError();
        setStatus(refs, { type: 'retry', text: `${e.name === 'QueueWaitError' ? 'Провайдер занят' : 'Сбой'} — пробую «${modelLabel(c.p.id, c.model) || c.model}» (${c.p.short})…` });
        try {
          tried.push(c.p.id + '|' + c.model);
          await attemptWith(c.p, c.model, { maxWaitMs: 8000 });
          reply.fallbackFrom = mk(p, model).slice(0, 60); reply.label = mk(c.p, c.model); reply.prov = c.p.id; reply.model = c.model; p = c.p; model = c.model;
          const nm = refs.wrap.querySelector('.name'); if (nm) nm.textContent = reply.label;
          ok = true; break;
        } catch (e2) { if (e2.name === 'AbortError') throw e2; if (reply.content) throw e2; lastErr = e2.name === 'QueueWaitError' ? lastErr : e2; }
      }
      if (!ok) {
        if (e.name === 'QueueWaitError' && !ac.signal.aborted) { setStatus(refs, { type: 'clear' }); await attemptWith(slotProvider(slot), slotModel(slot)); ok = true; }
        else throw lastErr || e;
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      if (!reply.content && !reply.reasoning) { const i = msgs.indexOf(reply); if (i >= 0) msgs.splice(i, 1); reply._gone = true; }
      else reply.stopped = true;
    } else if (!reply.content) { reply.error = true; reply.content = 'Ошибка: ' + explainError(e, p); }
    else { reply.content += '\n\n_⚠ Поток прерван: ' + explainError(e, p) + '_'; reply.partial = true; }
    lastErr = e;
  } finally {
    clearTimeout(raf); raf = 0;
    s.busy = false; s.abort = null;
    reply._streaming = false; reply.ms = Math.round(performance.now() - t0);
    setStatus(refs, { type: 'clear' });
    if (reply._gone) { refs.wrap.remove(); nodes[slot].pop(); }
    else {
      refs.wrap.classList.toggle('error', !!reply.error);
      const i = msgs.indexOf(reply); refs.index = i; refs.wrap.dataset.i = i;
      paintMsg(refs, false);
    }
    busyUI(); persist();
    if (ok || reply.content) announce(slot === 'A' ? 'Ответ получен' : 'Ответ второй модели получен');
    if (reply.error && slot === 'A') showBanner('');
  }
  return ok;
}

let sending = false;
async function send(text, { regen = false } = {}) {
  text = (text || '').trim();
  if (isBusy() || sending) return;
  if (!regen && !text) { if (attachments.length) { toast('Добавьте вопрос к изображению', { kind: 'err' }); el.input.focus(); } return; }
  // первый запрос в чате: фиксируем заголовок
  const c = state.chat;
  if (!regen) { if (!c.msgs.length && !c.title) c.title = chatTitleFrom(text); el.input.value = ''; store.del('draft'); autosize(); }
  const imgs = regen ? null : attachments.slice();
  c.provider = S.provider; c.model = slotModel('A'); c.compare = S.compare; c.providerB = S.providerB; c.modelB = slotModel('B');
  showBanner('');
  // локальная модель: подтверждение размера — если ещё не давали
  for (const s of SLOTS()) { const pp = slotProvider(s), mm = slotModel(s); if (pp.type === 'local' && mm && !S.localOk[mm]) { await selectModel(s, mm); if (!S.localOk[mm]) { if (!regen) el.input.value = text; return; } } }
  if (imgs && imgs.length) { attachments = []; paintAttach(); }
  sending = true;
  try {
    const slots = SLOTS();
    persistSoon();
    const jobs = slots.map((s, idx) => (async () => { if (idx > 0) await sleep(700).catch(() => {}); return runSlot(s, regen ? null : text, { regenerate: regen, images: imgs }); })());
    await Promise.all(jobs);
  } finally { sending = false; }
  renderChatListIfVisible();
}
function stopAll() { for (const k of ['A', 'B']) if (state.slots[k].abort) state.slots[k].abort.abort(); }

async function regenerate(slot) {
  if (isBusy()) return;
  const msgs = slotMsgs(slot);
  const last = msgs[msgs.length - 1]; if (!last) return;
  if (last.role === 'assistant') { msgs.pop(); const n = nodes[slot].pop(); if (n) n.wrap.remove(); }
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return;
  refreshActions(slot);
  sending = true; try { await runSlot(slot, null, { regenerate: true }); } finally { sending = false; }
}
function editLast() {
  if (isBusy()) return;
  const msgs = state.chat.msgs; if (!msgs.length) return;
  let i = msgs.length - 1; if (msgs[i].role === 'assistant') i--; if (i < 0 || msgs[i].role !== 'user') return;
  const text = msgs[i].content;
  if (Array.isArray(msgs[i]._images) && msgs[i]._images.length) { attachments = msgs[i]._images.slice(0, MAX_IMAGES); }
  for (const slot of ['A', 'B']) {
    const arr = slotMsgs(slot);
    while (arr.length && arr[arr.length - 1].role === 'assistant') { arr.pop(); }
    if (arr.length && arr[arr.length - 1].role === 'user') arr.pop();
  }
  renderAll(); persist(); pickPrompt(text); el.input.setSelectionRange(text.length, text.length);
  toast('Сообщение возвращено в поле ввода — измените и отправьте', { ms: 2500 });
}

/* ============================== чаты ============================== */
const persist = () => { if (!state.chat.msgs.length && !state.chat.msgsB.length) return; S.lastChat = state.chat.id; saveSettings(); if (!chats.save(state.chat)) showBanner(chats.lastError, { kind: 'err', sticky: true }); renderChatListIfVisible(); };
const persistSoon = debounce(() => { if (state.chat.msgs.length) persist(); }, 200);
const renderChatListIfVisible = () => { if (S.tab === 'chats') renderChatList(); };

function renderChatList() {
  const q = el.chatSearch.value.trim().toLowerCase();
  // поиск по названию и, если не нашли, по тексту сообщений (данные локальные, чатов немного)
  const inBody = r => { const c = chats.get(r.id); return !!c && [...c.msgs, ...(c.msgsB || [])].some(m => (m.content || '').toLowerCase().includes(q)); };
  const idx = chats.index().filter(r => !q || (r.title || '').toLowerCase().includes(q) || inBody(r));
  $('chatListEmpty').hidden = idx.length > 0; $('chatListEmpty').textContent = q ? 'Ничего не найдено.' : 'Чатов пока нет. История хранится только в вашем браузере.';
  el.chatList.innerHTML = idx.map(r => `<li class="chat-item${r.id === state.chat.id ? ' cur' : ''}${r.pinned ? ' pinned' : ''}" data-id="${esc(r.id)}"><button type="button" class="chat-open" data-id="${esc(r.id)}"${r.id === state.chat.id ? ' aria-current="true"' : ''}><span class="ct-title">${r.pinned ? '📌 ' : ''}${esc(r.title || 'Без названия')}</span><small>${esc(pById(r.provider).short)} · ${r.n || 0} сообщ. · ${fmtAgo(r.updated)}</small></button><span class="chat-tools"><button type="button" data-a="pin" aria-label="${r.pinned ? 'Открепить' : 'Закрепить'}: ${esc(r.title)}" title="${r.pinned ? 'Открепить' : 'Закрепить'}">📌</button><button type="button" data-a="rename" aria-label="Переименовать: ${esc(r.title)}" title="Переименовать">✎</button><button type="button" data-a="del" aria-label="Удалить: ${esc(r.title)}" title="Удалить">🗑</button></span></li>`).join('');
}
async function openChat(id) {
  if (isBusy()) { toast('Дождитесь окончания ответа или нажмите «Стоп»', { kind: 'err' }); return; }
  attachments = []; if (window.speechSynthesis) window.speechSynthesis.cancel();
  const c = chats.get(id); if (!c) return;
  state.chat = c;
  if (c.provider && PROVIDERS.some(p => p.id === c.provider)) { S.provider = c.provider; if (c.model) S.models[c.provider] = c.model; }
  if (c.compare && c.providerB && PROVIDERS.some(p => p.id === c.providerB)) { S.providerB = c.providerB; S.modelB = c.modelB || ''; }
  S.compare = !!c.compare; $('compareToggle').checked = S.compare; saveSettings();
  await afterProviderChange();
  renderAll(); renderChatList(); updateEst();
  if (isMobile()) openSidebar(false);
}
async function afterProviderChange() {
  renderSlotCard('A'); updateCur();
  await loadList(S.provider); ensureModel('A');
  if (S.compare) { await loadList(S.providerB); ensureModel('B'); }
  renderSlotCard('A'); renderSlotCard('B'); updateCur();
}
function newChatAction() {
  if (isBusy()) stopAll();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  attachments = [];
  if (state.chat.msgs.length) persist();
  state.chat = newChat(); S.lastChat = ''; saveSettings(); renderAll(); renderChatList(); updateEst(); el.input.value = ''; autosize(); el.input.focus();
  if (isMobile()) openSidebar(false);
}
async function clearChat() {
  if (!state.chat.msgs.length && !state.chat.msgsB.length) return;
  const ok = await confirmDialog({ title: 'Очистить чат?', html: '<p>Все сообщения этого чата будут удалены из истории браузера.</p>', ok: 'Очистить', danger: true }); if (!ok) return;
  stopAll(); const id = state.chat.id;
  chats.remove(id); state.chat = newChat(); renderAll(); renderChatList(); updateEst();
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
async function copyText(t, btn) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* */ } ta.remove(); }
  if (btn) { const o = btn.innerHTML; btn.classList.add('done'); const sp = btn.querySelector('span'); if (sp) { const ot = sp.textContent; sp.textContent = 'Скопировано'; setTimeout(() => { sp.textContent = ot; btn.classList.remove('done'); }, 1200); } else { btn.textContent = 'скопировано ✓'; setTimeout(() => { btn.innerHTML = o; btn.classList.remove('done'); }, 1200); } }
}

/* ============================== проверка доступности ============================== */
let checking = false; let checkAbort = null;
async function runCheck(pids, progId, label) {
  if (checking) { if (checkAbort) checkAbort.abort(); return; }
  checking = true; checkAbort = new AbortController();
  const btnA = $('checkBtnA'), btnAll = $('checkAllBtn');
  const oldA = btnA.textContent, oldAll = btnAll.textContent;
  (progId === 'A' ? btnA : btnAll).textContent = '■ Остановить проверку'; (progId === 'A' ? btnAll : btnA).disabled = true;
  const prog = $(progId === 'A' ? 'checkProgA' : 'checkProgAll'); prog.hidden = false; prog.querySelector('.bar').style.width = '0%';
  let total = 0, done = 0, okN = 0, all = 0;
  const plans = [];
  for (const pid of pids) { const p = pById(pid); const r = state.lists[pid] || await loadList(pid); plans.push({ p, list: r.list }); total += r.list.length; }
  try {
    for (const { p, list } of plans) {
      if (checkAbort.signal.aborted) break;
      $('checkAllInfo').textContent = progId === 'A' ? $('checkAllInfo').textContent : `Проверяем: ${p.name}…`;
      await checkProvider(p, list, {
        key: getKey(p.id), customUrl: S.customUrl, signal: checkAbort.signal, store,
        onProgress: (i, n, mid, rec) => { done++; all++; if (rec.s === 'ok' || rec.s === 'limited') okN++; prog.querySelector('.bar').style.width = Math.round(done / total * 100) + '%'; renderSlotCard('A'); renderSlotCard('B'); updateCur(); }
      });
    }
  } catch (e) { if (e.name !== 'AbortError') toast('Ошибка проверки: ' + explainError(e), { kind: 'err' }); }
  const aborted = checkAbort.signal.aborted;
  checking = false; checkAbort = null;
  btnA.textContent = oldA; btnAll.textContent = oldAll; btnAll.disabled = false;
  prog.hidden = true; renderSlotCard('A'); renderSlotCard('B'); updateCur();
  toast(aborted ? 'Проверка остановлена' : `Проверено: ${all}, работают: ${okN}`, { ms: 3500 });
  $('checkAllInfo').textContent = 'Отправляет каждой бесключевой модели крошечный запрос и запоминает результат на 6 часов. Учитываются лимиты сервисов.';
  if (S.autoFallback && !aborted) ensureModel('A');
}

/* ============================== события ============================== */
function bind() {
  // вкладки
  document.querySelectorAll('.tabs [role=tab]').forEach(b => {
    b.onclick = () => setTab(b.dataset.tab);
    b.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const t = ['chats', 'model', 'settings']; const i = t.indexOf(b.dataset.tab); setTab(t[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3], true); e.preventDefault(); } };
  });
  $('provBtnA').onclick = () => openProviderPicker('A'); $('provBtnB').onclick = () => openProviderPicker('B');
  $('modelBtnA').onclick = () => openModelPicker('A'); $('modelBtnB').onclick = () => openModelPicker('B');
  $('curLabel').onclick = () => { if (isMobile()) { openSidebar(true); setTab('model'); } else openModelPicker('A'); };
  $('checkBtnA').onclick = () => runCheck([S.provider], 'A');
  $('checkAllBtn').onclick = () => runCheck(PROVIDERS.filter(p => p.group === 'keyless').map(p => p.id), 'all');
  $('clearCacheBtn').onclick = () => { for (const k of store.keys()) if (k.startsWith('models.') || k === 'health') store.del(k); state.lists = {}; afterProviderChange(); toast('Кэш моделей и проверок сброшен'); };

  // ключ
  $('keyInput').oninput = () => { const pid = S.provider; const v = $('keyInput').value.trim(); if (v) state.keys[pid] = v; else delete state.keys[pid]; saveKeys(); };
  $('keyInput').onchange = async () => { delete state.lists[S.provider]; await selectProvider('A', S.provider, { silent: true }); renderAll(); };
  $('clearKey').onclick = async () => { delete state.keys[S.provider]; saveKeys(); $('keyInput').value = ''; delete state.lists[S.provider]; toast('Ключ удалён из localStorage'); await selectProvider('A', S.provider, { silent: true }); };
  $('customUrl').onchange = async () => { S.customUrl = $('customUrl').value.trim(); saveSettings(); state.lists.custom = undefined; if (S.provider === 'custom' || S.providerB === 'custom') await afterProviderChange(); };
  $('proxyUrl').onchange = async () => { S.proxy = $('proxyUrl').value.trim(); setProxy(S.proxy); saveSettings(); for (const p of PROVIDERS.filter(x => x.needsProxy)) { state.lists[p.id] = undefined; if (S.provider === p.id || (S.compare && S.providerB === p.id)) await loadList(p.id, { force: true }); } renderSlotCard('A'); renderSlotCard('B'); renderAll(); };
  $('customModel').oninput = () => { S.customModel = $('customModel').value; saveSettings(); updateCur(); };

  // настройки
  $('compareToggle').onchange = async () => { S.compare = $('compareToggle').checked; saveSettings(); $('slotB').hidden = !S.compare; $('tagA').hidden = !S.compare; document.getElementById('panels').classList.toggle('two', S.compare); if (S.compare) { await loadList(S.providerB); ensureModel('B'); if (slotPid('B') === slotPid('A') && slotModel('B') === slotModel('A')) { /* та же модель — допустимо */ } } renderSlotCard('B'); updateCur(); renderAll(); };
  $('autoFallback').onchange = () => { S.autoFallback = $('autoFallback').checked; saveSettings(); };
  const sys = $('systemPrompt');
  $('presetSel').innerHTML = SYSTEM_PRESETS.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') + '<option value="__custom">Свой текст…</option>';
  $('presetSel').onchange = () => { const v = $('presetSel').value; S.preset = v; if (v !== '__custom') { const pr = SYSTEM_PRESETS.find(x => x.id === v); sys.value = pr ? pr.text : ''; S.system = sys.value; } saveSettings(); };
  sys.oninput = () => { S.system = sys.value; const m = SYSTEM_PRESETS.find(x => x.text === sys.value); S.preset = m ? m.id : (sys.value ? '__custom' : ''); $('presetSel').value = S.preset; saveSettings(); };
  $('temp').oninput = () => { S.temp = parseFloat($('temp').value); $('tempOut').textContent = S.temp.toFixed(1); saveSettings(); };
  $('maxTokens').onchange = () => { S.maxTokens = parseInt($('maxTokens').value, 10) || 0; saveSettings(); };
  $('themeSel').onchange = () => { S.theme = $('themeSel').value; saveSettings(); applyTheme(); };
  $('cyberBtn').onclick = toggleCyber;
  $('themeBtn').onclick = () => { const order = ['auto', 'dark', 'light']; S.theme = order[(order.indexOf(S.theme || 'auto') + 1) % 3]; saveSettings(); applyTheme(); toast('Тема: ' + $('themeBtn').title.replace('Тема: ', '')); };

  // чаты
  $('newChatBtn').onclick = newChatAction;
  $('clearBtn').onclick = clearChat;
  el.chatSearch.oninput = debounce(renderChatList, 120);
  el.chatList.onclick = async e => {
    const li = e.target.closest('.chat-item'); if (!li) return; const id = li.dataset.id;
    const a = e.target.closest('[data-a]');
    if (a) {
      if (a.dataset.a === 'pin') { chats.togglePin(id); renderChatList(); }
      else if (a.dataset.a === 'rename') { const c = chats.get(id); const t = await promptDialog({ title: 'Название чата', value: c.title }); if (t != null && t.trim()) { chats.rename(id, t); if (state.chat.id === id) state.chat.title = t.trim(); renderChatList(); } }
      else if (a.dataset.a === 'del') { const c = chats.get(id); const ok = await confirmDialog({ title: 'Удалить чат?', html: `<p>«${esc(c.title)}» будет удалён безвозвратно.</p>`, ok: 'Удалить', danger: true }); if (ok) { chats.remove(id); if (state.chat.id === id) { state.chat = newChat(); renderAll(); } renderChatList(); } }
      return;
    }
    openChat(id);
  };
  $('exportAllBtn').onclick = () => { download('free-ai-hub-chats.json', chats.exportJSON(), 'application/json'); };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const n = chats.importJSON(await f.text()); toast(`Импортировано чатов: ${n}`); renderChatList(); } catch (err) { toast(err.message, { kind: 'err', ms: 4000 }); } e.target.value = ''; };
  $('deleteAllBtn').onclick = async () => { const ok = await confirmDialog({ title: 'Удалить все чаты?', html: '<p>Вся история в этом браузере будет удалена. Рекомендуем сначала сделать экспорт.</p>', ok: 'Удалить всё', danger: true }); if (ok) { chats.clearAll(); state.chat = newChat(); renderAll(); renderChatList(); } };
  // экспорт текущего
  const menu = $('exportMenu');
  const closeMenu = () => { menu.hidden = true; $('exportBtn').setAttribute('aria-expanded', 'false'); };
  $('exportBtn').onclick = e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; $('exportBtn').setAttribute('aria-expanded', open); if (open) menu.querySelector('button').focus(); };
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  menu.onkeydown = e => { if (e.key === 'Escape') { closeMenu(); $('exportBtn').focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const b = [...menu.querySelectorAll('button')]; const i = b.indexOf(document.activeElement); b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus(); e.preventDefault(); } };
  menu.onclick = e => {
    const b = e.target.closest('[data-export]'); if (!b) return; closeMenu();
    const c = state.chat; if (!c.msgs.length) { toast('Чат пуст', { kind: 'err' }); return; }
    if (!c.title) c.title = chatTitleFrom(c.msgs[0].content);
    if (b.dataset.export === 'md') download(exportName(c, 'md'), exportMarkdown(c), 'text/markdown');
    else if (b.dataset.export === 'json') download(exportName(c, 'json'), JSON.stringify(c, null, 2), 'application/json');
    else copyText(exportMarkdown(c)).then(() => toast('Markdown скопирован'));
  };

  // композер
  $('composer').onsubmit = e => { e.preventDefault(); send(el.input.value); };
  el.input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !(isMobile() && matchMedia('(pointer: coarse)').matches)) { e.preventDefault(); send(el.input.value); }
    else if (e.key === 'ArrowUp' && !el.input.value && !e.shiftKey) { e.preventDefault(); editLast(); }
  };
  // черновик: не теряем недописанное сообщение при перезагрузке/закрытии вкладки
  const saveDraft = debounce(() => { if (el.input.value.trim()) store.set('draft', el.input.value); else store.del('draft'); }, 300);
  el.input.oninput = () => { autosize(); saveDraft(); };
  { const d = store.get('draft', ''); if (typeof d === 'string' && d && !el.input.value) { el.input.value = d; autosize(); } }
  el.stop.onclick = stopAll;
  // картинки: кнопка, вставка из буфера, перетаскивание
  $('attachBtn').onclick = () => $('attachFile').click();
  $('attachFile').onchange = async e => { await addFiles(e.target.files); e.target.value = ''; };
  $('attachStrip').onclick = e => { const b = e.target.closest('[data-rm]'); if (!b) return; attachments.splice(+b.dataset.rm, 1); paintAttach(); el.input.focus(); };
  el.input.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addFiles(fs); } });
  const card = document.querySelector('.composer-card');
  ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); card.classList.add('drag'); } }));
  ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, () => card.classList.remove('drag')));
  card.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  // сообщения: делегирование
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-copy-code]');
    if (c) { copyText(c.closest('pre').querySelector('code').textContent, c).then(() => { c.textContent = 'скопировано ✓'; setTimeout(() => { c.textContent = 'копировать'; }, 1200); }); return; }
    const act = e.target.closest('.msg [data-act]'); if (!act) return;
    const msgEl = act.closest('.msg'); const slot = msgEl.dataset.slot; const i = +msgEl.dataset.i; const m = slotMsgs(slot)[i]; if (!m) return;
    if (act.dataset.act === 'copy') { const txt = m.role === 'assistant' ? m.content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim() : m.content; copyText(txt, act); }
    else if (act.dataset.act === 'regen') regenerate(slot);
    else if (act.dataset.act === 'edit') editLast();
    else if (act.dataset.act === 'tts') speak(m, act);
    else if (act.dataset.act === 'cont') send('Продолжи ответ с того места, где остановился. Не повторяй уже написанное.');
  });

  // мобильное меню + боковая панель
  $('openSidebar').onclick = () => openSidebar(!sidebarIsOpen()); $('closeSidebar').onclick = () => openSidebar(false); el.scrim.onclick = () => { if (popoverOpen()) closePopover(false); else openSidebar(false); };

  // горячие клавиши
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      if (popoverOpen()) return;
      if (isBusy()) { e.preventDefault(); stopAll(); return; }
      if (isMobile() && el.sidebar.classList.contains('open')) { openSidebar(false); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openModelPicker('A'); return; }
    if (e.altKey && e.code === 'KeyN') { e.preventDefault(); newChatAction(); return; }
    if (e.altKey && e.code === 'KeyB') { e.preventDefault(); openSidebar(!sidebarIsOpen()); return; }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); el.input.focus(); }
  });
  window.addEventListener('storage', e => { if (e.key === 'fah.chats.index' && S.tab === 'chats') renderChatList(); });
  window.addEventListener('beforeunload', () => { saveSettingsNow(); });
  // другая вкладка изменила историю/здоровье моделей — обновляем список
  window.addEventListener('storage', debounce(e => { if (e.key && (e.key.startsWith('fah.chat') || e.key === 'fah.health')) { renderChatListIfVisible(); updateCur(); } }, 200));
  window.addEventListener('resize', debounce(() => { if (!isMobile()) { el.sidebar.classList.remove('open'); el.scrim.classList.remove('show'); document.body.classList.remove('no-scroll'); $('main').inert = false; el.sidebar.removeAttribute('role'); el.sidebar.removeAttribute('aria-modal'); } autosize(); }, 120));
  // «активная вкладка данных»: подсказка про iOS-клавиатуру
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { document.documentElement.style.setProperty('--vvh', visualViewport.height + 'px'); });
}

/* ============================== запуск ============================== */
async function init() {
  applyTheme();
  $('autoFallback').checked = !!S.autoFallback; $('compareToggle').checked = !!S.compare;
  $('slotB').hidden = !S.compare; $('tagA').hidden = !S.compare; document.getElementById('panels').classList.toggle('two', !!S.compare);
  if (S.collapsed && !isMobile()) document.getElementById('app').classList.add('collapsed');
  $('systemPrompt').value = S.system || ''; $('presetSel').value = ''; // заполняется в bind()
  $('temp').value = S.temp; $('tempOut').textContent = (+S.temp).toFixed(1); $('maxTokens').value = String(S.maxTokens || 0);
  $('customUrl').value = S.customUrl; $('customModel').value = S.customModel; $('proxyUrl').value = S.proxy || ''; setProxy(S.proxy);
  bind();
  $('presetSel').value = SYSTEM_PRESETS.some(x => x.id === S.preset) || S.preset === '__custom' ? S.preset : '';
  initScroll('A'); initScroll('B');
  setTab(['chats', 'model', 'settings'].includes(S.tab) ? S.tab : 'model');
  // восстановление последнего чата
  if (S.lastChat) { const lc = chats.get(S.lastChat); if (lc && lc.msgs.length) { state.chat = lc; if (lc.provider && PROVIDERS.some(p => p.id === lc.provider)) { S.provider = lc.provider; if (lc.model) S.models[lc.provider] = lc.model; } if (lc.compare && lc.providerB && PROVIDERS.some(p => p.id === lc.providerB)) { S.providerB = lc.providerB; S.modelB = lc.modelB || ''; S.compare = true; $('compareToggle').checked = true; $('slotB').hidden = false; $('tagA').hidden = false; document.getElementById('panels').classList.add('two'); } } }
  renderSlotCard('A'); renderSlotCard('B'); updateCur(); renderAll(); autosize();
  const local = localSupported();
  if (!local) { const p = pById('local'); p.hint += ' (Ваш браузер не поддерживает Web Workers/WASM.)'; }
  await afterProviderChange();
  if (S.provider === 'custom' && !S.customUrl) showBanner('Укажите Base URL своего эндпоинта в блоке «Свой ключ».');
  else if (state.lists[S.provider] && state.lists[S.provider].error) showBanner(state.lists[S.provider].error);
  renderAll();
  // фоновая прогрев-загрузка списков остальных бесключевых провайдеров (только GET списков, без чат-запросов)
  setTimeout(() => { for (const p of PROVIDERS.filter(x => x.group === 'keyless' && !x.noModelsEndpoint)) if (!state.lists[p.id]) loadList(p.id).then(() => renderSlotCard('A')); }, 1500);
  window.__fah = { state, chats, PROVIDERS, send, loadList, runCheck, renderAll, selectProvider, ensureModel };    // для отладки и тестов
  document.documentElement.dataset.ready = '1';
}
init();
