/* Страница просмотра общего диалога (/s/<id>). Весь текст: пользователь — textContent, модель — безопасный renderMarkdown (экранирует всё). */
import { renderMarkdown, splitThink } from './markdown.js?v=3.9';
import { paintImage } from './messages.js?v=3.9';
import { safeImageUrl } from './imggen.js?v=3.9';
import { ChatStore, chatFromShared } from './chats.js?v=3.9';
import { store } from './store.js?v=3.9';

const $ = id => document.getElementById(id);
const ID_RE = /^[A-Za-z0-9_-]{16}$/;
function toast(text, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; $('toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('in')); setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, 3000);
}
function hueOf(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function msgNode(m) {
  const isUser = m.role === 'user';
  const wrap = document.createElement('article'); wrap.className = 'msg ' + (isUser ? 'user' : 'assistant');
  const av = document.createElement('div'); av.className = 'avatar'; av.setAttribute('aria-hidden', 'true'); av.textContent = isUser ? '🙂' : '✦';
  if (!isUser) av.style.setProperty('--h', hueOf((m.model || 'x').split(' · ')[0]));
  const main = document.createElement('div'); main.className = 'msg-main';
  const who = document.createElement('div'); who.className = 'who';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = isUser ? 'Пользователь' : (m.model || 'Модель'); who.appendChild(name);
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (isUser) bubble.textContent = m.content;
  else {
    const sp = splitThink(m.content);
    if (sp.thinking.trim()) {
      const d = document.createElement('details'); d.className = 'think';
      const sum = document.createElement('summary'); sum.textContent = 'Размышления'; d.appendChild(sum);
      const b = document.createElement('div'); b.className = 'think-body'; b.innerHTML = renderMarkdown(sp.thinking); d.appendChild(b);
      main.append(who, d);
    } else main.append(who);
    if (safeImageUrl(m.image)) paintImage(bubble, m.image, typeof m.prompt === 'string' ? m.prompt : '');
    else bubble.innerHTML = renderMarkdown(sp.answer);
  }
  if (isUser) main.append(who);
  main.appendChild(bubble); wrap.append(av, main);
  return wrap;
}
function fail(text) {
  $('shareTitle').textContent = 'Диалог не найден'; $('shareSub').textContent = '';
  const e = $('shareError'); e.textContent = text; e.hidden = false;
}
async function main() {
  const m = /^\/s\/([A-Za-z0-9_-]{16})\/?$/.exec(location.pathname);
  const id = m ? m[1] : new URLSearchParams(location.search).get('id') || '';
  if (!ID_RE.test(id)) { fail('Ссылка неверна или устарела.'); return; }
  let data;
  try {
    const r = await fetch('/api/share/' + id, { credentials: 'omit', cache: 'no-store' });
    if (r.status === 404) { fail('Такого диалога нет: возможно, он был удалён.'); return; }
    if (!r.ok) throw new Error();
    data = await r.json();
  } catch { fail('Не удалось загрузить диалог — сервер недоступен. Попробуйте позже.'); return; }
  const msgs = Array.isArray(data.messages) ? data.messages.filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string') : [];
  const title = typeof data.title === 'string' && data.title ? data.title : 'Диалог';
  $('shareTitle').textContent = title; document.title = title + ' — Free AI Hub';
  const models = [...new Set(msgs.filter(x => x.role === 'assistant' && x.model).map(x => x.model))];
  const when = data.created ? new Date(data.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  $('shareSub').textContent = [models.length ? 'Модел' + (models.length > 1 ? 'и' : 'ь') + ': ' + models.join(', ') : '', when].filter(Boolean).join(' · ');
  const box = $('shareMsgs'); for (const x of msgs) box.appendChild(msgNode(x));
  const btn = $('continueBtn'); btn.hidden = !msgs.length;
  btn.onclick = () => {
    try {
      const chat = chatFromShared({ title, messages: msgs }); const cs = new ChatStore(store);
      if (!cs.save(chat)) throw new Error(cs.lastError || 'Не удалось сохранить');
      const st = store.get('settings', {}); st.lastChat = chat.id; st.compare = false; store.set('settings', st);
      location.href = '/';
    } catch (e) { toast(e.message || 'Не удалось импортировать', 'err'); }
  };
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copy-code]'); if (!b) return;
  const code = b.closest('pre')?.querySelector('code')?.textContent || '';
  try { await navigator.clipboard.writeText(code); b.textContent = 'скопировано ✓'; setTimeout(() => { b.textContent = 'копировать'; }, 1200); } catch { /* */ }
});
main();
