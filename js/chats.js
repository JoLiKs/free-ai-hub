/* История чатов в localStorage: индекс + отдельная запись на чат. Экспорт Markdown/JSON, импорт. */
import { store as defaultStore } from './store.js';
import { uid, slug } from './util.js';

const MAX_CHATS = 200;

export function newChat(o = {}) {
  const t = Date.now();
  return Object.assign({ id: uid(), title: '', created: t, updated: t, pinned: false, provider: '', model: '', providerB: '', modelB: '', compare: false, msgs: [], msgsB: [], v: 2 }, o);
}
export const chatTitleFrom = text => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return s.length > 48 ? s.slice(0, 46).trimEnd() + '…' : s || 'Новый чат'; };

export class ChatStore {
  constructor(store = defaultStore) { this.store = store; this.lastError = ''; }
  index() {
    const idx = this.store.get('chats.index', []);
    return idx.slice().sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  }
  _writeIndex(idx) { return this.store.set('chats.index', idx); }
  get(id) { const c = this.store.get('chat.' + id, null); return c ? Object.assign(newChat(), c) : null; }
  save(chat) {
    chat.updated = Date.now();
    // не сохраняем незавершённые/служебные поля
    const clean = JSON.parse(JSON.stringify(chat, (k, v) => (k.startsWith('_') ? undefined : v)));
    let ok = this.store.set('chat.' + chat.id, clean);
    if (!ok) { this.prune(chat.id); ok = this.store.set('chat.' + chat.id, clean); }
    this.lastError = ok ? '' : 'Не удалось сохранить чат: хранилище браузера переполнено. Экспортируйте и удалите старые чаты.';
    const idx = this.store.get('chats.index', []);
    const row = { id: chat.id, title: chat.title, updated: chat.updated, created: chat.created, pinned: !!chat.pinned, provider: chat.provider, model: chat.model, n: chat.msgs.length };
    const i = idx.findIndex(x => x.id === chat.id);
    if (i >= 0) idx[i] = row; else idx.push(row);
    this._writeIndex(idx);
    if (idx.length > MAX_CHATS) this.prune(chat.id);
    return ok;
  }
  /** удаляет самые старые (не закреплённые) чаты, пока не освободится место / не останется MAX_CHATS */
  prune(keepId) {
    let idx = this.store.get('chats.index', []).slice().sort((a, b) => a.updated - b.updated);
    let removed = 0;
    for (const r of idx) {
      if (r.id === keepId || r.pinned) continue;
      if (idx.length - removed <= MAX_CHATS && removed >= 3) break;
      this.store.del('chat.' + r.id); removed++;
      if (removed >= 3 && idx.length - removed <= MAX_CHATS) break;
    }
    const gone = new Set(idx.slice().filter(r => !this.store.get('chat.' + r.id, null)).map(r => r.id));
    this._writeIndex(idx.filter(r => !gone.has(r.id)));
    return removed;
  }
  remove(id) { this.store.del('chat.' + id); this._writeIndex(this.store.get('chats.index', []).filter(r => r.id !== id)); }
  rename(id, title) { const c = this.get(id); if (!c) return; c.title = title.trim() || c.title; this.save(c); }
  togglePin(id) { const c = this.get(id); if (!c) return; c.pinned = !c.pinned; this.save(c); return c.pinned; }
  clearAll() { for (const r of this.store.get('chats.index', [])) this.store.del('chat.' + r.id); this._writeIndex([]); }

  exportJSON(ids) {
    const all = (ids || this.index().map(r => r.id)).map(id => this.get(id)).filter(Boolean);
    return JSON.stringify({ app: 'free-ai-hub', version: 2, exported: new Date().toISOString(), chats: all }, null, 2);
  }
  importJSON(text) {
    let data; try { data = JSON.parse(text); } catch { throw new Error('Файл не является корректным JSON.'); }
    const chats = Array.isArray(data) ? data : (data && data.chats);
    if (!Array.isArray(chats)) throw new Error('В файле нет списка чатов.');
    let n = 0;
    for (const c of chats) {
      if (!c || !Array.isArray(c.msgs)) continue;
      const clean = Object.assign(newChat(), c, { id: uid() });
      clean.msgs = clean.msgs.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
      clean.msgsB = Array.isArray(clean.msgsB) ? clean.msgsB.filter(m => m && typeof m.content === 'string') : [];
      this.save(clean); n++;
    }
    return n;
  }
}

const fmtDate = ts => new Date(ts).toLocaleString('ru-RU');
export function exportMarkdown(chat) {
  const lines = [`# ${chat.title || 'Чат'}`, '', `_Free AI Hub · ${fmtDate(chat.created)}_`, ''];
  const dump = (msgs, title) => {
    if (title) lines.push(`## ${title}`, '');
    for (const m of msgs) {
      if (m.role === 'user') lines.push('### 🧑 Вы', '', ...(m.imgN ? ['_🖼 Прикреплено изображений: ' + m.imgN + '_', ''] : []), m.content, '');
      else {
        lines.push(`### 🤖 ${m.label || 'Модель'}${m.error ? ' (ошибка)' : ''}`, '');
        if (m.reasoning) lines.push('<details><summary>Размышления</summary>', '', m.reasoning, '', '</details>', '');
        lines.push(m.content, '');
      }
    }
  };
  if (chat.compare && chat.msgsB.length) { dump(chat.msgs, 'Модель А'); dump(chat.msgsB, 'Модель Б'); } else dump(chat.msgs);
  return lines.join('\n');
}
export const exportName = (chat, ext) => `free-ai-hub-${slug(chat.title || 'chat')}.${ext}`;
