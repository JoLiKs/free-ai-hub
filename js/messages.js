/* Отрисовка сообщений: аватары, пузыри, блок «Размышления», статус, действия. */
import { esc, fmtTime, estimateTokens } from './util.js';
import { renderMarkdown, splitThink } from './markdown.js';

const ICON = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  regen: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  cont: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  tts: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>'
};
const AVATAR_USER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
const AVATAR_BOT = '<svg viewBox="0 0 64 64" width="18" height="18"><path d="M32 10l5.2 14L51 29.2 37.2 34.4 32 48.4l-5.2-14L13 29.2 26.8 24z" fill="currentColor"/></svg>';

function hueOf(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

export function actionBtn(kind, label, extra = '') {
  return `<button type="button" class="act" data-act="${kind}" title="${esc(label)}" aria-label="${esc(label)}"${extra}>${ICON[kind] || ''}<span>${esc(label)}</span></button>`;
}

/** Создаёт DOM-узел сообщения. Возвращает { wrap, refs } */
export function createMsgNode(m, { slot, index, canEdit, canRegen }) {
  const wrap = document.createElement('article');
  const isUser = m.role === 'user';
  wrap.className = 'msg ' + (isUser ? 'user' : 'assistant') + (m.error ? ' error' : '');
  wrap.dataset.slot = slot; wrap.dataset.i = index;
  const av = document.createElement('div'); av.className = 'avatar'; av.setAttribute('aria-hidden', 'true');
  av.innerHTML = isUser ? AVATAR_USER : AVATAR_BOT;
  if (!isUser) av.style.setProperty('--h', hueOf((m.label || 'x').split(' · ')[0]));
  const main = document.createElement('div'); main.className = 'msg-main';
  const who = document.createElement('div'); who.className = 'who';
  who.innerHTML = `<span class="name">${isUser ? 'Вы' : esc(m.label || 'Модель')}</span>${m.ts ? `<time class="time">${fmtTime(m.ts)}</time>` : ''}`;
  const think = document.createElement('details'); think.className = 'think'; think.hidden = true;
  think.innerHTML = '<summary><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="think-title">Размышления</span></summary><div class="think-body"></div>';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const status = document.createElement('div'); status.className = 'status'; status.hidden = true; status.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'msg-actions';
  const meta = document.createElement('div'); meta.className = 'meta';
  main.append(who, think, bubble, status, actions, meta);
  wrap.append(av, main);
  const refs = { wrap, bubble, think, thinkBody: think.querySelector('.think-body'), thinkTitle: think.querySelector('.think-title'), status, actions, meta, m, slot, index, canEdit, canRegen, userToggled: false };
  think.addEventListener('toggle', () => { if (!refs._programmatic) refs.userToggled = true; });
  paintMsg(refs, false);
  return { wrap, refs };
}

export function paintActions(refs, busy) {
  const { m, actions, canEdit, canRegen } = refs;
  let h = '';
  if (m.role === 'user') {
    h = actionBtn('copy', 'Копировать', ' data-what="msg"');
    if (canEdit && !busy) h += actionBtn('edit', 'Изменить');
  } else {
    if (!(m._streaming)) {
      if (!m.error) h += actionBtn('copy', 'Копировать', ' data-what="msg"');
      if (!m.error && typeof speechSynthesis !== 'undefined') h += actionBtn('tts', 'Озвучить');
      if (canRegen && !busy) h += actionBtn('regen', m.error ? 'Повторить' : 'Заново');
      if (canRegen && !busy && !m.error && m.finish === 'length') h += actionBtn('cont', 'Продолжить');
    }
  }
  actions.innerHTML = h;
}

export function paintMeta(refs) {
  const { m, meta } = refs;
  if (m.role !== 'assistant' || m.error || m._streaming) { meta.textContent = ''; return; }
  const bits = [];
  const tk = (m.usage && m.usage.completion_tokens) || estimateTokens(m.content);
  bits.push((m.usage && m.usage.completion_tokens ? '' : '≈') + tk + ' ток.');
  if (m.ms) bits.push((m.ms / 1000).toFixed(m.ms < 10000 ? 1 : 0) + ' с');
  if (m.finish === 'length') bits.push('⚠ обрезан по лимиту токенов');
  if (m.fallbackFrom) bits.push('⤳ переключено с ' + m.fallbackFrom);
  meta.textContent = bits.join(' · ');
}

/** Перерисовывает содержимое (streaming=true — во время потока: курсор, «Размышления» открыты пока нет ответа) */
export function paintMsg(refs, streaming) {
  const { m, bubble, think } = refs;
  if (m.role === 'user') {
    bubble.textContent = m.content;
    const n = Array.isArray(m._images) ? m._images.length : (m.imgN || 0);
    if (n) {
      const box = document.createElement('div'); box.className = 'msg-imgs';
      if (Array.isArray(m._images)) m._images.forEach(u => { const i = document.createElement('img'); i.src = u; i.alt = 'Прикреплённое изображение'; i.loading = 'lazy'; box.appendChild(i); });
      else box.innerHTML = `<span class="lost">🖼 изображений: ${n} (не сохраняются в истории)</span>`;
      bubble.prepend(box);
    }
    paintActions(refs, false); return;
  }
  if (m.error) {
    bubble.classList.add('err'); bubble.innerHTML = `<span class="err-ico" aria-hidden="true">⚠</span><span>${esc(m.content)}</span>`;
    paintActions(refs, false); paintMeta(refs); return;
  }
  const sp = splitThink(m.content);
  const reasoning = ((m.reasoning || '') + (sp.thinking ? (m.reasoning ? '\n\n' : '') + sp.thinking : '')).trim();
  const answer = sp.answer;
  if (reasoning) {
    think.hidden = false;
    refs.thinkBody.innerHTML = renderMarkdown(reasoning);
    const thinkingNow = streaming && !answer.trim();
    refs.thinkTitle.textContent = thinkingNow ? 'Размышляет…' : 'Размышления';
    think.classList.toggle('live', thinkingNow);
    if (!refs.userToggled) { refs._programmatic = true; think.open = thinkingNow; setTimeout(() => { refs._programmatic = false; }, 0); }
  } else think.hidden = true;
  if (answer.trim()) bubble.innerHTML = renderMarkdown(answer);
  else bubble.innerHTML = streaming ? '<span class="typing" aria-label="Модель печатает"><i></i><i></i><i></i></span>' : (reasoning ? '<span class="muted">Модель пока не дала ответ.</span>' : '');
  bubble.classList.toggle('cursor', !!streaming && !!answer.trim());
  bubble.classList.toggle('empty', !answer.trim() && !streaming);
  if (!streaming) { paintActions(refs, false); paintMeta(refs); }
}

export function setStatus(refs, s) {
  const st = refs.status;
  if (!s || s.type === 'clear') { st.hidden = true; st.innerHTML = ''; st.className = 'status'; return; }
  st.hidden = false; st.className = 'status ' + (s.type || '');
  let inner = '';
  if (s.type === 'progress') {
    const pct = s.total ? Math.min(100, Math.round(s.loaded / s.total * 100)) : 0;
    inner = `<span>Загрузка модели в браузер… ${s.total ? pct + '% (' + Math.round(s.loaded / 1e6) + ' из ' + Math.round(s.total / 1e6) + ' МБ)' : ''}</span><span class="pbar"><i style="width:${pct}%"></i></span>`;
  } else {
    const spin = (s.type === 'wait' || s.type === 'retry' || s.type === 'slow' || s.type === 'thinking') ? '<span class="spin" aria-hidden="true"></span>' : '';
    inner = spin + `<span>${esc(s.text || '')}</span>`;
  }
  st.innerHTML = inner;
}

export function emptyStateNode(suggestions, onPick, ctx = {}) {
  const d = document.createElement('div'); d.className = 'empty';
  d.innerHTML = `<div class="hero-logo" aria-hidden="true"><svg viewBox="0 0 64 64" width="34" height="34"><path d="M32 10l5.2 14L51 29.2 37.2 34.4 32 48.4l-5.2-14L13 29.2 26.8 24z" fill="currentColor"/><path d="M50 8l1.8 4.6L56.4 14l-4.6 1.8L50 20.4l-1.8-4.6L43.6 14l4.6-1.4z" fill="currentColor" opacity=".7"/></svg></div>
    <h2 data-text="${esc(ctx.title || 'Чем помочь?')}">${esc(ctx.title || 'Чем помочь?')}</h2>
    <p>${esc(ctx.sub || 'Выберите модель в боковой панели и задайте вопрос. Всё работает без регистрации и ключей — запросы уходят напрямую к бесплатным AI API.')}</p>
    <div class="cards"></div>`;
  const cards = d.querySelector('.cards');
  for (const s of suggestions) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'card-btn';
    b.innerHTML = `<span class="ci" aria-hidden="true">${s.icon}</span><span class="ct"><b>${esc(s.title)}</b><span>${esc(s.text)}</span></span>`;
    b.onclick = () => onPick(s.text); cards.appendChild(b);
  }
  return d;
}
