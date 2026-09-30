/* Безопасный markdown → HTML. Весь пользовательский/модельный текст экранируется;
 * ссылки — только http(s)/mailto, с rel="noopener noreferrer nofollow". Поддержка: заголовки, списки (вложенные, задачи),
 * таблицы, цитаты, hr, ``` блоки с подсветкой и кнопкой копирования, inline-код, **жирный**, *курсив*, ~~зачёркнутый~~, автоссылки. */
import { esc } from './util.js';
import { highlight } from './highlight.js';

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"'`]+$/i;

export function renderInline(text) {
  const codes = [];
  let t = String(text).replace(/[\u0000-\u0003]/g, '');
  t = t.replace(/(^|[^`\\])(`{1,3})(?!`)([^`]|[^`][\s\S]*?[^`])\2(?!`)/g, (_, pre, __, c) => { codes.push(c.trim() ? c.replace(/^ | $/g, '') : c); return pre + '\u0000' + (codes.length - 1) + '\u0000'; });
  // экранирование обратным слэшем: \* \_ \` \[ \# … — символ выводится как есть и не участвует в разметке
  const escs = [];
  t = t.replace(/\\([\\`*_[\]~|#])/g, (_, ch) => { escs.push(ch); return '\u0003' + (escs.length - 1) + '\u0003'; });
  t = esc(t);
  const links = [];
  const keep = html => { links.push(html); return '\u0001' + (links.length - 1) + '\u0001'; };
  // [текст](url "title")
  t = t.replace(/\[([^\]\n]+)\]\(\s*([^\s)]+)(?:\s+&quot;[^)]*?&quot;)?\s*\)/g, (m, txt, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(raw) ? keep(`<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer nofollow">${txt}</a>`) : m;
  });
  // автоссылки
  t = t.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>&]+(?:&amp;[^\s<>&]+)*)/g, (m, pre, url) => {
    let u = url, tail = '';
    while (/[.,;:!?)\]]$/.test(u)) { tail = u.slice(-1) + tail; u = u.slice(0, -1); }
    const raw = u.replace(/&amp;/g, '&');
    return SAFE_URL.test(raw) ? pre + keep(`<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`) + tail : m;
  });
  t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])__(?=\S)([^_\n]*?\S)__(?![\w])/g, '$1<strong>$2</strong>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g, '$1<em>$2</em>');
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i]);
  t = t.replace(/\u0003(\d+)\u0003/g, (_, i) => esc(escs[+i]));
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
}

const isTableSep = l => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes('|');
const splitRow = l => { let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1); return s.replace(/\\\|/g, '\u0002').split('|').map(c => c.trim().replace(/\u0002/g, '|')); };

function renderTable(head, aligns, rows) {
  const al = i => aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
  let h = '<div class="table-wrap"><table><thead><tr>' + head.map((c, i) => `<th${al(i)}>${renderInline(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) h += '<tr>' + head.map((_, i) => `<td${al(i)}>${renderInline(r[i] || '')}</td>`).join('') + '</tr>';
  return h + '</tbody></table></div>';
}

const LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function renderList(lines) {
  // lines: [{indent, ordered, text, start}] — строим вложенность по отступам
  let html = ''; const stack = [];
  const closeTo = n => { while (stack.length > n) { const top = stack.pop(); html += '</li></' + top.tag + '>'; } };
  for (const it of lines) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) closeTo(stack.length - 1);
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const start = it.ordered && it.start !== 1 ? ` start="${it.start}"` : '';
      html += `<${tag}${start}><li>`; stack.push({ tag, indent: it.indent });
    } else if (top.tag !== tag) {
      closeTo(stack.length - 1); const start = it.ordered && it.start !== 1 ? ` start="${it.start}"` : '';
      html += `<${tag}${start}><li>`; stack.push({ tag, indent: it.indent });
    } else html += '</li><li>';
    let txt = it.text; const task = txt.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) html += `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ` + renderInline(task[2]);
    else html += renderInline(txt);
  }
  closeTo(0);
  return html;
}

export function renderBlocks(text, depth = 0) {
  const lines = text.split('\n'); const out = [];
  let para = [];
  const flushP = () => { if (para.length) { out.push('<p>' + para.map(renderInline).join('<br>') + '</p>'); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (!line.trim()) { flushP(); continue; }
    if ((m = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { flushP(); const n = Math.min(m[1].length + 1, 6); out.push(`<h${n}>${renderInline(m[2])}</h${n}>`); continue; }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushP(); out.push('<hr>'); continue; }
    // таблица
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line); const seps = splitRow(lines[i + 1]);
      if (head.length === seps.length || seps.length >= 1) {
        flushP();
        const aligns = seps.map(s => (s.startsWith(':') && s.endsWith(':')) ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : '');
        const rows = []; i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
        i--; out.push(renderTable(head, aligns, rows)); continue;
      }
    }
    if (/^\s*>/.test(line)) {
      flushP(); const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--; out.push('<blockquote>' + (depth >= 6 ? '<p>' + q.map(renderInline).join('<br>') + '</p>' : renderBlocks(q.join('\n'), depth + 1)) + '</blockquote>'); continue;
    }
    if ((m = line.match(LI))) {
      flushP(); const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(LI);
        if (mm) {
          const indent = mm[1].replace(/\t/g, '    ').length;
          items.push({ indent, ordered: /\d/.test(mm[2]), start: parseInt(mm[2], 10) || 1, text: mm[3] }); i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length && !/^\s*[-*+]\s/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim(); i++;   // продолжение пункта
        } else if (!lines[i].trim() && i + 1 < lines.length && LI.test(lines[i + 1])) { i++; }  // «рыхлый» список
        else break;
      }
      i--;
      // нормализуем отступы: самые малые — уровень 0
      out.push(renderList(items)); continue;
    }
    para.push(line);
  }
  flushP();
  return out.join('');
}

/** Основная точка входа. Незакрытый ``` (стриминг) рендерится как открытый блок кода. */
export function renderMarkdown(src) {
  src = String(src || '').replace(/\r\n?/g, '\n');
  const re = /^ {0,3}(```+|~~~+)[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
  let html = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    html += renderBlocks(src.slice(last, m.index));
    const lang = m[2] || '';
    const code = m[3].replace(/\n$/, '');
    html += `<pre class="codeblock"><div class="code-head"><span class="lang">${esc(lang || 'code')}</span><button type="button" class="code-copy" data-copy-code>копировать</button></div><code>${highlight(code, lang)}</code></pre>`;
    last = re.lastIndex;
  }
  // незавершённая открывающая строка ``` без перевода строки
  const rest = src.slice(last).replace(/^ {0,3}(```+|~~~+)[ \t]*[\w+#.-]*$/m, '');
  return html + renderBlocks(rest);
}

/** Разбор «размышлений» в тексте: <think>…</think> (DeepSeek/Qwen-стиль) → {thinking, answer, open} */
export function splitThink(text) {
  const s = String(text || '');
  const open = s.indexOf('<think>');
  if (open === -1) return { thinking: '', answer: s, open: false };
  const before = s.slice(0, open);
  const close = s.indexOf('</think>', open);
  if (close === -1) return { thinking: s.slice(open + 7), answer: before, open: true };
  return { thinking: s.slice(open + 7, close), answer: before + s.slice(close + 8).replace(/^\s+/, ''), open: false };
}
