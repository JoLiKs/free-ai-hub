/* «Поделиться диалогом»: подготовка сообщений, импорт, безопасный вывод. node tests/share.test.mjs */
import assert from 'node:assert/strict';
import { shareMessages, chatFromShared, newChat } from '../js/chats.js?v=3.9';
import { renderMarkdown } from '../js/markdown.js?v=3.9';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

t('shareMessages: only text, no errors/streaming/empty/images, model label kept', () => {
  const c = newChat({ msgs: [
    { role: 'user', content: 'Привет', _images: ['data:x'], imgN: 1, ts: 1 },
    { role: 'assistant', content: 'Ответ', label: 'OVH · Mistral', reasoning: 'r', usage: {} },
    { role: 'assistant', content: 'boom', error: true }, { role: 'assistant', content: '', label: 'x' },
    { role: 'assistant', content: 'stream', _streaming: true }, { role: 'system', content: 'sys' },
  ] });
  assert.deepEqual(shareMessages(c), [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Ответ', model: 'OVH · Mistral' }]);
  assert.equal(shareMessages(newChat({ msgs: Array.from({ length: 150 }, (_, i) => ({ role: 'user', content: 'm' + i })) })).length, 100);
  assert.deepEqual(shareMessages(null), []);
});
t('chatFromShared: new local chat, filtered fields', () => {
  const c = chatFromShared({ title: ' T ', messages: [{ role: 'user', content: 'a', evil: 1 }, { role: 'assistant', content: 'b', model: 'M' }, { role: 'system', content: 'x' }, { role: 'user', content: 5 }] });
  assert.equal(c.title, 'T'); assert.ok(c.id);
  assert.deepEqual(c.msgs, [{ role: 'user', content: 'a', ts: 0 }, { role: 'assistant', content: 'b', label: 'M', ts: 0 }]);
  assert.notEqual(chatFromShared({ messages: [] }).id, c.id);
});
t('shared content renders without executable HTML', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1)) **b**');
  assert.ok(!/<img|<script|href="javascript/i.test(html)); assert.ok(html.includes('&lt;script&gt;') && html.includes('<strong>b</strong>'));
});
console.log(`share tests: ${n} passed`);
