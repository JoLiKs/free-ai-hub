/* Лёгкая подсветка синтаксиса без зависимостей. Возвращает БЕЗОПАСНЫЙ html (всё экранируется). */
import { esc } from './util.js';

const KW = {
  js: 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield null true false undefined interface type enum implements public private protected readonly namespace declare abstract',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self match case',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual new delete using bool true false nullptr fn let mut pub impl trait use mod match loop as ref move where async await dyn crate self Self func go defer chan select range package interface map var string byte rune error nil',
  sh: 'if then else elif fi for while do done case esac function in return export local echo cd ls cat grep sed awk sudo apt npm pip git curl wget mkdir rm cp mv chmod source exit set unset alias',
  sql: 'select from where and or not insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset as distinct union all null is in like between exists primary key foreign references index view case when then else end count sum avg min max',
  css: 'important',
  json: 'true false null',
  html: ''
};
const ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js',
  python: 'py', py: 'py', python3: 'py',
  c: 'c', cpp: 'c', 'c++': 'c', h: 'c', java: 'c', cs: 'c', csharp: 'c', 'c#': 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', kotlin: 'c', kt: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh',
  sql: 'sql', postgresql: 'sql', mysql: 'sql',
  css: 'css', scss: 'css', less: 'css',
  json: 'json', jsonc: 'json', yaml: 'json', yml: 'json', toml: 'json',
  html: 'html', xml: 'html', svg: 'html', vue: 'html'
};

const kwSet = {};
for (const k of Object.keys(KW)) kwSet[k] = new Set(KW[k].split(/\s+/).filter(Boolean));

export function normLang(l) { return ALIAS[String(l || '').toLowerCase()] || ''; }

function build(lang) {
  // порядок важен: комментарии, строки, числа, слова
  const parts = [];
  if (lang === 'py' || lang === 'sh') parts.push('(?<c>#[^\\n]*)');
  else if (lang === 'sql') parts.push('(?<c>--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))');
  else if (lang === 'html') parts.push('(?<c><!--[\\s\\S]*?(?:-->|$))');
  else if (lang === 'json') parts.push('(?<c>#[^\\n]*)');
  else parts.push('(?<c>//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))');
  parts.push('(?<s>"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)');
  if (lang === 'html') parts.push('(?<t></?[A-Za-z][\\w:-]*|/?>)');
  parts.push('(?<n>\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)');
  parts.push('(?<w>[A-Za-z_$][\\w$]*)');
  return new RegExp(parts.join('|'), 'g');
}
const RX = {};

export function highlight(code, langRaw) {
  const lang = normLang(langRaw);
  if (!lang || code.length > 20000) return esc(code);
  const rx = RX[lang] || (RX[lang] = build(lang));
  rx.lastIndex = 0;
  const set = kwSet[lang]; const ci = lang === 'sql';
  let out = '', last = 0, m;
  while ((m = rx.exec(code)) !== null) {
    if (m[0] === '') { rx.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups; const t = m[0];
    if (g.c) out += `<span class="tk-c">${esc(t)}</span>`;
    else if (g.s) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (g.t) out += `<span class="tk-k">${esc(t)}</span>`;
    else if (g.n) out += `<span class="tk-n">${esc(t)}</span>`;
    else if (g.w) {
      const w = ci ? t.toLowerCase() : t;
      if (set && set.has(w)) out += `<span class="tk-k">${esc(t)}</span>`;
      else if (lang !== 'json' && lang !== 'html' && /^[A-Z][A-Za-z0-9_]*$/.test(t) && t.length > 1) out += `<span class="tk-t">${esc(t)}</span>`;
      else if (lang !== 'json' && lang !== 'html' && code[last] === '(') out += `<span class="tk-f">${esc(t)}</span>`;
      else out += esc(t);
    } else out += esc(t);
  }
  return out + esc(code.slice(last));
}
