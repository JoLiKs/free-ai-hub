/* Отрисовка сообщений: аватары, пузыри, блок «Размышления», статус, действия. */
import { esc, fmtTime, estimateTokens } from './util.js?v=3.15';
import { renderMarkdown, splitThink } from './markdown.js?v=3.15';
import { safeImageUrl, parseImageUrl, imageUrl, PAID_IMG_RE } from './imggen.js?v=3.15';

const ICON = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  regen: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  cont: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
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
      if (!m.error && m.image) h += actionBtn('dl', 'Скачать');
      if (!m.error && !m.image) h += actionBtn('copy', 'Копировать', ' data-what="msg"');
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
  const answer = sp.answer.replace(/\[\[\s*IMAGE\b[\s\S]*?(?:\]\]|$)/i, '');   // маркер для генерации картинки не показываем
  if (reasoning) {
    think.hidden = false;
    refs.thinkBody.innerHTML = renderMarkdown(reasoning);
    const thinkingNow = streaming && !answer.trim();
    refs.thinkTitle.textContent = thinkingNow ? 'Размышляет…' : 'Размышления';
    think.classList.toggle('live', thinkingNow);
    if (!refs.userToggled) { refs._programmatic = true; think.open = thinkingNow; setTimeout(() => { refs._programmatic = false; }, 0); }
  } else think.hidden = true;
  const imgUrl = m.image && safeImageUrl(m.image.url);
  if (imgUrl) { paintImage(bubble, imgUrl, m.image.prompt || '', { onUrl: u => { m.image.url = u; bubble.dataset.img = u; if (refs.onImageUrl) refs.onImageUrl(u); } }); bubble.classList.remove('cursor', 'empty'); if (!streaming) { paintActions(refs, false); paintMeta(refs); } return; }
  if (answer.trim()) bubble.innerHTML = renderMarkdown(answer);
  else bubble.innerHTML = streaming ? '<span class="typing" aria-label="Модель печатает"><i></i><i></i><i></i></span>' : (reasoning ? '<span class="muted">Модель пока не дала ответ.</span>' : '');
  bubble.classList.toggle('cursor', !!streaming && !!answer.trim());
  bubble.classList.toggle('empty', !answer.trim() && !streaming);
  if (!streaming) { paintActions(refs, false); paintMeta(refs); }
}

/** Картинка в пузыре: заглушка «рисуем…», загрузка напрямую с Pollinations (crossOrigin → проверка пикселей),
 * распознавание «жёлтой заглушки» Pollinations, до 3 попыток с новым seed (паузы 5/12 с, общий лимит 90 с), затем понятная ошибка
 * с кнопкой повтора. onUrl(url) — когда удачной оказалась ссылка с другим seed (сохраняем её в историю). Используется и на /s/<id>. */
export function paintImage(bubble, url, prompt, { onUrl } = {}) {
  if (bubble.dataset.img === url) return;
  bubble.dataset.img = url; bubble.classList.add('has-img');
  const fig = document.createElement('figure'); fig.className = 'gen-img loading';
  const ph = document.createElement('div'); ph.className = 'gen-ph';
  const img = new Image(); img.alt = prompt ? 'Сгенерированная картинка: ' + prompt : 'Сгенерированная картинка'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.crossOrigin = 'anonymous';   // Pollinations отдаёт CORS * → можно проверить пиксели на «заглушку»
  img.width = 1024; img.height = 1024;
  const cap = document.createElement('figcaption'); cap.textContent = prompt;
  const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.appendChild(img);
  fig.append(ph, link, cap);
  bubble.textContent = ''; bubble.appendChild(fig);
  let cur = url, attempt = 0, t0 = 0, wd = 0, done = false;
  const setPh = (html) => { ph.innerHTML = html; };
  const loadingPh = n => setPh('<span class="spin" aria-hidden="true"></span><span>' + (n ? 'Сервис генерации занят — пробуем ещё раз (' + (n + 1) + '/3)…' : 'Рисуем картинку… обычно 5–30 секунд') + '</span>');
  const finish = () => { done = true; clearTimeout(wd); fig.classList.remove('loading', 'err'); ph.remove(); link.href = shown; if (shown !== url && onUrl) onUrl(shown); };
  const giveUp = () => {
    done = true; clearTimeout(wd); fig.classList.remove('loading'); fig.classList.add('err');
    setPh('<span aria-hidden="true">⚠</span><span>Сервис генерации картинок сейчас перегружен — попробуйте через минуту.</span><button type="button" class="gen-retry">Попробовать ещё раз</button>');
    if (!ph.isConnected) fig.prepend(ph);
    ph.querySelector('.gen-retry').onclick = () => { fig.classList.remove('err'); fig.classList.add('loading'); start(true); };
  };
  const freeOf = u => (PAID_IMG_RE.test(u) && prompt ? imageUrl(prompt) : u);
  const retry = () => {
    if (done) return; clearTimeout(wd);
    attempt++;
    const left = 90000 - (Date.now() - t0);
    if (attempt >= 3 || left < 8000) return giveUp();
    // картинка с нашего сервера не догрузилась/битая — сначала тот же файл ещё раз (без новой платной генерации)
    if (PAID_IMG_RE.test(shown) && attempt < 3) {
      loadingPh(attempt);
      setTimeout(() => { if (done) return; clearTimeout(wd); wd = setTimeout(retry, 30000); img.src = shown + '?r=' + attempt; }, 1500);
      return;
    }
    loadingPh(attempt);
    setTimeout(() => { if (!done) { cur = withSeed(freeOf(url), Math.floor(Math.random() * 1e9)); go(); } }, attempt === 1 ? 5000 : 12000);
  };
  let shown = url, tok = 0;
  const go = async () => {
    clearTimeout(wd); const my = ++tok;
    // платный режим (ключ задан в админке): наш сервер генерирует и кэширует /api/img/<id>; при любой ошибке — бесплатная прямая ссылка
    let src = cur;
    if (!PAID_IMG_RE.test(cur) && await paidOn()) { const p = await paidUrl(cur); if (my !== tok || done) return; if (p) src = p; }
    if (my !== tok || done) return;
    wd = setTimeout(retry, Math.min(40000, Math.max(5000, 90000 - (Date.now() - t0))));
    shown = src; img.src = src;
  };
  img.onload = () => { if (done) return; if (img.naturalWidth < 64 || img.naturalHeight < 64 || isPlaceholder(img)) return retry(); finish(); };
  img.onerror = () => { if (!done) retry(); };
  const start = (fresh) => { done = false; attempt = 0; t0 = Date.now(); if (fresh) cur = withSeed(freeOf(url), Math.floor(Math.random() * 1e9)); loadingPh(0); if (!ph.isConnected) fig.prepend(ph); go(); };
  start(false);
}
function withSeed(u, seed) {
  if (PAID_IMG_RE.test(u)) return u;   // кэш сервера: seed не меняется (повтор → бесплатная ссылка через freeOf)
 return /[?&]seed=\d+/.test(u) ? u.replace(/([?&]seed=)\d+/, '$1' + seed) : u + (u.includes('?') ? '&' : '?') + 'seed=' + seed; }
// Прокси через свой Cloudflare-домен не используем: Pollinations отвечает 402 на запросы из дата-центров Cloudflare.
let paidDead = false;
async function paidOn() {
  if (paidDead || location.protocol !== 'https:') return false;
  try { const c = await Promise.race([window.FAH_SITE_CONFIG || Promise.resolve({}), new Promise(r => setTimeout(() => r({}), 1500))]); return !!(c && c.imggen_paid); } catch { return false; }
}
async function paidUrl(u) {
  const q = parseImageUrl(u); if (!q || !q.prompt) return '';
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch('/api/img', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q), credentials: 'omit', signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (r.ok && j && typeof j.url === 'string' && PAID_IMG_RE.test(j.url)) return j.url;
    if (j && (j.error === 'off' || j.error === 'auth' || j.error === 'quota' || j.error === 'paid off')) paidDead = true;   // ключ не работает — до перезагрузки только бесплатный режим
    return '';
  } catch { return ''; } finally { clearTimeout(t); }
}
/** «Жёлтая заглушка» Pollinations: почти однотонный жёлтый фон (+ чёрный логотип). Холст доступен только для своего домена. */
export function isPlaceholder(img) {
  try {
    const W = 24, c = document.createElement('canvas'); c.width = W; c.height = W;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, W);
    const d = x.getImageData(0, 0, W, W).data; let yellow = 0, dark = 0, n = W * W;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 200 && g > 165 && b < 140 && r - b > 90) yellow++; else if (r + g + b < 120) dark++; }
    return yellow / n > 0.6 && yellow / n + dark / n > 0.85;
  } catch { return false; }   // холст недоступен (нет CORS) — проверить нельзя
}

export function setStatus(refs, s) {
  const st = refs.status;
  if (!s || s.type === 'clear') { st.hidden = true; st.innerHTML = ''; st.className = 'status'; st.style.cssText = ''; if (refs.bubble) refs.bubble.style.display = ''; return; }
  if (s.type !== 'progress') { st.style.cssText = ''; if (refs.bubble) refs.bubble.style.display = ''; }
  st.hidden = false; st.className = 'status ' + (s.type === 'progress' ? 'loadprog' : (s.type || ''));
  let inner = '';
  if (s.type === 'progress') {
    const stage = s.stage || 'download';
    const dev = s.device === 'webgpu' ? 'WebGPU' : s.device === 'wasm' ? 'WASM/CPU' : '';
    const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',');
    const det = stage === 'download' && s.total > 0;
    // общий % по всем файлам; монотонный (новый файл может увеличить total — шкала назад не прыгает); <10% — с десятой
    let pct = det ? Math.min(100, s.loaded / s.total * 100) : 0;
    if (det) { refs._pct = Math.max(refs._pct || 0, pct); pct = refs._pct; }
    const pctTxt = pct < 10 ? pct.toFixed(1).replace('.', ',') : String(Math.floor(pct));
    const title = { lib: 'Загружаем библиотеку transformers.js…', download: 'Скачиваем модель в браузер', init: 'Инициализация модели' + (dev ? ' (' + dev + ')' : '') + '…', fallback: 'WebGPU не справился — переключаемся на WASM…', prefill: 'Модель обдумывает ответ' + (dev ? ' (' + dev + ')' : '') + '…' }[stage] || 'Загрузка модели…';
    const meta = det ? `<b>${pctTxt}%</b> · ${mb(s.loaded)} из ${mb(s.total)} МБ` : (stage === 'download' && s.loaded ? mb(s.loaded) + ' МБ' : '');
    st.className = 'status loadprog';
    // критичная раскладка — инлайном: блок корректен даже при устаревшем style.css в кэше браузера
    st.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:8px;height:auto;max-height:none;overflow:visible;width:min(100%,460px);padding:10px 14px;box-sizing:border-box';
    st.innerHTML = `<div class="lp-row" style="display:flex;align-items:center;gap:8px;min-width:0;line-height:1.45"><span class="spin" aria-hidden="true"></span><span class="lp-title" style="flex:1;min-width:0">${esc(title)}</span><span class="lp-meta" style="white-space:nowrap;font-variant-numeric:tabular-nums">${meta}</span></div><span class="pbar${det ? '' : ' indet'}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${det ? ` aria-valuenow="${Math.floor(pct)}"` : ''} style="display:block;flex:none;width:100%;min-width:0;height:6px"><i style="width:${det ? pct.toFixed(1) : 100}%"></i></span>`;
    // пустой пузырь с «точками» во время загрузки не показываем (JS, не только CSS :has)
    if (refs.bubble && refs.bubble.querySelector('.typing')) refs.bubble.style.display = 'none';
    return;
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
