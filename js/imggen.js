/* Бесплатная генерация картинок в чате через Pollinations (без ключа).
 * detectImageIntent(text) → 'yes' | 'maybe' | 'no' — дешёвые правила RU/EN;
 * для 'maybe', продолжений и перевода промпта на английский — короткий запрос к text.pollinations.ai (15 с);
 * при сбое классификатора запросы со словом-«картинкой» всё равно рисуются по исходному тексту. */
export const IMG_HOST = 'https://image.pollinations.ai/prompt/';
const TEXT_API = 'https://text.pollinations.ai/openai';

const B0 = '(?<![\\p{L}\\d])', B1 = '(?![\\p{L}\\d])';
const W = x => x.replace(/\\w/g, '\\p{L}');
const RX = s => new RegExp(s, 'iu');
// существительные-«картинки» (все падежи, частые опечатки: кртинка, картика, изоброжение, фотка, пикча…)
const NOUN_RU = W('(?:к[ао]?р?т[иі]н[кч]?\\w*|картин\\w*|кар?т[иі]к\\w*|изо[бп]р[ао]ж\\w*|изобра\\w*|фот[оа]\\w*|фотк\\w*|фоточк\\w*|рисун\\w*|рисова?нк\\w*|арт|арты|арта|артом|обо[ией]\\w*|аватар\\w*|авк\\w*|ав[аы]|лого(?:тип\\w*)?|постер\\w*|плакат\\w*|баннер\\w*|иллюстр\\w*|пикч\\w*|эмблем\\w*|иконк\\w*|скетч\\w*|комикс\\w*|стикер\\w*|обложк\\w*|рендер\\w*|мем(?:ы|а|ов|у|ом|чик\\w*)?|открытк\\w*)');
const NOUN_EN = '(?:image|img|picture|pic|pics|photo|photos|photograph|illustration|drawing|painting|artwork|art|logo|icon|avatar|wallpaper|poster|banner|sketch|portrait|render|meme|sticker)';
// глаголы «сделать картинку» (вкл. разговорные сгенерь/генерни/нарисуйка)
const DRAW_RU = W('(?:нарисуй\\w*|нарисова\\w*|нарисуешь|нарисуете|дорисуй\\w*|перерисуй\\w*|изобрази\\w*|изобразить|отрисуй\\w*|набросай\\w*|намалюй\\w*|визуализируй\\w*)');
// «генерировать» само по себе — не обязательно картинка (видео, текст, идеи) → только с существительным или через классификатор
const GEN_RU = W('(?:[сз]?ге[нм][еи]р\\w*|[сз]?г[еи]н[еи]р\\w*|генерн\\w*|сгенерь\\w*)');
const MAKE_RU = W('(?:сделай\\w*|сделать|сделаешь|создай\\w*|создать|создашь|покажи\\w*|показать|дай|дайте|давай|скинь\\w*|пришли\\w*|хочу|хочется|нужн[аоы]?|можешь|можно|могу|сотвори\\w*|придумай\\w*|запили\\w*|замути\\w*|сваргань\\w*)');
const DRAW_EN = '(?:draw|paint|sketch|illustrate|render|visuali[sz]e|imagine)';
const MAKE_EN = '(?:generate|create|make|design|produce|show|give|send|want|need|can\\s+you|could\\s+you)';
const NOUN = RX('(?:' + B0 + NOUN_RU + B1 + '|\\b' + NOUN_EN + 's?\\b)');
const DRAW = RX('(?:' + B0 + DRAW_RU + B1 + '|\\b' + DRAW_EN + '(?:s|ing)?\\b)');
const GEN = RX('(?:' + B0 + GEN_RU + B1 + '|\\bgenerat\\w*)');
// видео/анимация — не поддерживается: честно отвечаем текстом, картинку не рисуем
const VIDEO = RX('(?:' + B0 + W('(?:видео\\w*|видос\\w*|видяшк\\w*|ролик\\w*|клип\\w*|анимац\\w*|анимир\\w*|мульт\\w*|фильм\\w*|кино|гифк\\w*|gif)') + B1 + '|\\b(?:videos?|clips?|movies?|animations?|animated|animate|gifs?|films?)\\b)');
// вопросы о возможностях («а ты умеешь/можешь генерировать…?», «can you generate images?») — ответ текстом
const CAPQ = RX(B0 + W('(?:уме\\w*|способ\\w*|можешь\\s+ли|можете\\s+ли|ли\\s+ты|ли\\s+вы|вообще|в\\s+состоянии|поддерживае\\w*|получится\\s+ли|есть\\s+ли)') + B1 + '|\\b(?:are\\s+you\\s+able|do\\s+you\\s+support|is\\s+it\\s+possible|can\\s+you\\s+(?:generate|create|make|draw)\\s+(?:images|pictures|photos|videos)\\s*\\?)');
// отрицание («не надо картинку», «я не просил генерировать») — не картинка
const NEGREQ = RX(B0 + W('(?:не|нет|без|хватит|перестань|прекрати|stop|don.?t|not)') + B1 + '[^.!?\\n]{0,40}' + W('(?:генер\\w*|рису\\w*|нарис\\w*|картин\\w*|изображ\\w*|draw\\w*|generat\\w*|image\\w*|picture\\w*)'));
const MAKE = RX('(?:' + B0 + MAKE_RU + B1 + '|\\b' + MAKE_EN + '\\b)');
// явные НЕ-генерации: «как нарисовать», графики/таблицы, код, «опиши/что на фото», определения
const HARDNEG = RX(B0 + W('(?:как\\s+(?:нарисова\\w*|рисова\\w*|сделать\\s+(?:график|диаграмм|таблиц)\\w*|построить|вставить|сжать|обрезать|сохранить|скачать|загрузить|конвертир\\w*|уменьшить|увеличить)|что\\s+такое|что\\s+значит|определени\\w*|опиши\\w*|описать|распознай|распознать|что\\s+(?:на|изображено|нарисовано)|прочитай|переведи\\s+текст\\s+с|excel|эксел\\w*|ворд\\w*|word|python|питон\\w*|matplotlib|plt|javascript|css|html|svg|canvas|код\\w*|скрипт\\w*|программ\\w*|функци\\w*|график\\w*|диаграмм\\w*|таблиц\\w*|формул\\w*|uml|блок-схем\\w*|ascii|фотошоп\\w*|photoshop|gimp|математик\\w*|алгебр\\w*|геометри\\w*|how\\s+(?:to|do|can|does)|what\\s+is|what\\s+does|explain|tutorial|code|chart|graph|plot|describe|what.s\\s+in|function|definition)') + B1);
// продолжение после картинки: «ещё одну», «а теперь в синем», «такую же с собакой», «перерисуй», «другой вариант»
const FOLLOW = RX('^\\s*(?:а\\s+|и\\s+|теперь\\s+|ну\\s+)?' + W('(?:ещ[её]|теперь|такую|такой|такое|такие|то\\s+же|тоже\\s+самое|другую|другой|другое|друго\\w*|новую|вариант\\w*|перерисуй\\w*|переделай\\w*|измени\\w*|поменяй\\w*|замени\\w*|добавь\\w*|убери\\w*|сделай\\w*|в\\s+стиле|в\\s+\\w+\\s+(?:цвет\\w*|стил\\w*|тон\\w*)|в\\s+(?:синем|красном|зел[её]ном|ч[её]рн\\w+|бел\\w+|ж[её]лт\\w+|розов\\w+|фиолетов\\w+|оранжев\\w+|голуб\\w+|сер\\w+)|покрупнее|поярче|потемнее|посветлее|реалистичн\\w*|мультяшн\\w*|аниме|пиксел\\w*|акварел\\w*|с\\s+\\w+|без\\s+\\w+|ночью|днём|днем|зимой|летом)') + B1 + '|^\\s*(?:another|one\\s+more|again|now\\s+|make\\s+it|same\\s+but|but\\s+|in\\s+\\w+\\s+(?:color|style)|with\\s+|without\\s+|more\\s+\\w+|change\\s+)');

const FEEDBACK = RX(B0 + W('(?:спасибо|спс|благодар\\w*|класс\\w*|отличн\\w*|круто|крутая|супер|понравил\\w*|прикольн\\w*|шикарн\\w*|топ|thanks|thank\\s+you|nice|great|cool|awesome|love\\s+it)') + B1);
/** Есть ли в тексте «картиночное» слово (картинка/фото/рисунок/логотип… или нарисуй/сгенерь). */
export function mentionsImage(text) { const t = String(text || ''); return NOUN.test(t) || DRAW.test(t); }
/** Просьба сгенерировать видео/анимацию (или вопрос, умеем ли) — не поддерживается. */
export function isVideoRequest(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 700 || !VIDEO.test(t)) return false;
  if (/(?:^|\s)(?:как|how)\s/iu.test(t) && !GEN.test(t)) return false;            // «как смонтировать видео» — обычный вопрос
  if (/\?\s*$/.test(t) && t.split(/\s+/).length <= 4) return true;         // «а видео?», «видео можешь?»
  return GEN.test(t) || DRAW.test(t) || MAKE.test(t) || CAPQ.test(t) || RX(B0 + W('(?:анимируй\\w*|оживи\\w*|сними\\w*|смонтируй\\w*)') + B1 + '|\\banimate\\b').test(t);
}
export const VIDEO_UNSUPPORTED = '🎬 Генерировать видео я, к сожалению, не умею — на этом сайте доступны только текстовые ответы и генерация картинок. Могу нарисовать картинку (например, кадр или постер на эту тему), написать сценарий, раскадровку или подсказать сервисы для генерации видео.';

/** 'yes' — явная просьба; 'maybe' — проверить классификатором; 'no' — точно текст. */
// явная просьба-императив: «нарисуй», «сгенерируй/сделай/создай/покажи/дай … картинку», «draw me», «generate an image»
const IMPER = RX(B0 + W('(?:нарисуй\\w*|изобрази\\w*|отрисуй\\w*|намалюй\\w*|набросай\\w*|дорисуй\\w*|перерисуй\\w*|визуализируй\\w*|[сз]г[еи]н[еи]рируй\\w*|[сз]генерь\\w*|генерни\\w*)') + B1 + '|^\\s*(?:please\\s+)?(?:draw|paint|sketch|illustrate|render|generate|create|make|design)\\b');
const IMPER_MAKE = RX(B0 + W('(?:сделай\\w*|создай\\w*|покажи\\w*|дай|дайте|скинь\\w*|пришли\\w*|сотвори\\w*|запили\\w*|замути\\w*)') + B1);
const QWORD = RX('^\\s*(?:а\\s+|и\\s+|ну\\s+)?' + W('(?:ты|вы|можешь|можете|умеешь|умеете|способ\\w*|правда|реально|разве|неужели|ли|как|что|чем|почему|зачем|какие|какой|сколько|где|когда|кто)') + B1 + '|^\\s*(?:can|could|do|does|are|is|will|would|what|how|why)\\b');
// слова «о возможностях»: если кроме них в вопросе ничего нет — это вопрос, а не заказ конкретной картинки
const CAPWORD = RX('^(?:' + W('(?:а|и|ну|ты|вы|для|меня|нас|пожалуйста|плиз|тоже|ещ[её]|вообще|ли|же|мне|нам|сам|сама|это|так|да|нет|бы|правда|реально|разве|неужели|тут|здесь|сайт|бот|нейросеть|уме\\w*|мож\\w*|могл?\\w*|способ\\w*|дела\\w*|сдела\\w*|рису\\w*|рисов\\w*|нарис\\w*|созда\\w*|[сз]?г[еи]н[еи]р\\w*|генер\\w*|присыла\\w*|показыва\\w*|выда\\w*|поддерж\\w*|вида|какие|какой|любые|разные|свои|картин\\w*|картинк\\w*|фот\\w*|изображ\\w*|рисун\\w*|арт\\w*|иллюстр\\w*|пикч\\w*|лого\\w*|аватар\\w*|ави)') + '|can|could|you|u|do|does|are|is|able|to|me|for|us|please|a|an|the|any|also|really|draw|paint|make|create|generate|images?|pictures?|pics?|photos?|art|drawings?)$', 'iu');
function onlyCapWords(t) { return t.toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/).filter(Boolean).every(w => CAPWORD.test(w)); }
/** Вопрос о возможностях без явной просьбы («картинки умеешь?», «рисуешь?», «can you draw?») — отвечаем текстом. */
export function isCapabilityQuestion(text) {
  const t = String(text || '').trim();
  const q = /\?\s*$/.test(t) || QWORD.test(t);
  if (!q) return false;
  if (/^\s*(?:please\s+)?draw\s+me\b/i.test(t)) return false;
  return onlyCapWords(t);
}
/** Явная просьба (для маркера [[IMAGE]] / отказа модели): императив или «можешь нарисовать <что-то>?» с конкретным предметом. */
export function isExplicitImageRequest(text) {
  const t = String(text || '').trim();
  if (!t || isCapabilityQuestion(t) || isVideoRequest(t) || NEGREQ.test(t) || HARDNEG.test(t)) return false;
  return IMPER.test(t) || (IMPER_MAKE.test(t) && NOUN.test(t)) || (detectImageIntent(t) === 'yes' && !onlyCapWords(t));
}
export function detectImageIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 700) return 'no';
  if (isVideoRequest(t) && !NOUN.test(t)) return 'no';                   // видео — отдельный честный ответ, не картинка
  if (NEGREQ.test(t)) return 'no';                                      // «я не просил генерировать картинку»
  if (isCapabilityQuestion(t)) return 'no';                             // вопрос о возможностях в любом порядке слов
  const noun = NOUN.test(t), draw = DRAW.test(t), gen = GEN.test(t), make = MAKE.test(t), neg = HARDNEG.test(t), q = /\?\s*$/.test(t);
  if (q && CAPQ.test(t)) return 'no';                                   // «а ты умеешь рисовать картинки?» — вопрос о возможностях
  if (q && (draw || gen) && !noun && /^\s*(?:а\s+)?\S+\s+(?:генерир\S*|рисовать|generate|draw)\s+(?:ты\s+)?(?:можешь|умеешь|can)?/iu.test(t) && t.split(/\s+/).length <= 4) return 'no';
  if (neg) return (draw || gen || noun) && (make || draw || gen) && !/(?:как|how)\s/iu.test(t) ? 'maybe' : 'no';
  if (draw) return 'yes';                                    // нарисуй/изобрази/draw … — картинка
  if (gen) return noun ? 'yes' : 'maybe';                    // «сгенерируй картинку» — да; «сгенерируй крысу/текст» — решает классификатор
  if (noun && make) return 'yes';                            // сделай/хочу/дай/можешь … картинку/фото/лого
  if (noun && FEEDBACK.test(t)) return 'maybe';              // «спасибо, отличная картинка» — решает классификатор
  if (noun && t.length <= 140) return q ? 'maybe' : 'yes';   // «картинка крысы», «фото кота в шляпе», «крыса картинкой»
  if (noun) return 'maybe';
  if (make && t.length <= 60 && RX('^\\s*(?:а\\s+)?' + W('(?:сделай\\w*|создай\\w*|покажи\\w*)') + B1).test(t)) return 'maybe';   // «сделай крысу»
  return 'no';
}
/** Короткая реплика-продолжение после картинки («ещё одну», «а теперь в синем цвете»). */
export function isFollowUp(text) { const t = String(text || '').trim(); return !!t && t.length <= 160 && !HARDNEG.test(t) && !NEGREQ.test(t) && !isVideoRequest(t) && !isCapabilityQuestion(t) && !(/\?\s*$/.test(t) && CAPQ.test(t)) && (FOLLOW.test(t) || detectImageIntent(t) !== 'no'); }
/** Ответ текстовой модели — отказ «не могу создавать изображения» или маркер [[IMAGE: …]]. */
export function imageMarker(reply) { const m = String(reply || '').match(/\[\[\s*IMAGE\s*:\s*([^\]]{3,500})\]\]/i); return m ? m[1].trim() : ''; }
export function isImageRefusal(reply) {
  const r = String(reply || '').slice(0, 600);
  return RX(W('(?:не\\s+(?:могу|умею|способ\\w*|име\\w+\\s+возможност\\w*)|нет\\s+возможност\\w*|не\\s+в\\s+состоянии|невозможно)[^.!?\\n]{0,60}(?:созда\\w*|генерир\\w*|сгенерир\\w*|рисова\\w*|нарисова\\w*|изобра\\w*|показ\\w*|отправ\\w*|выда\\w*)[^.!?\\n]{0,40}(?:изображ\\w*|картин\\w*|рисун\\w*|фото\\w*|графи\\w*|визуал\\w*)?')).test(r) ||
    /\b(?:i\s+(?:can(?:no|')t|am\s+(?:not\s+able|unable)|do\s+not\s+have\s+the\s+ability)|unable\s+to)\s+(?:directly\s+)?(?:create|generate|draw|produce|make|show)\s+(?:an?\s+|the\s+)?(?:images?|pictures?|drawings?|photos?|visual)/i.test(r);
}
/** Подсказка текстовым моделям в системном промпте (страховка). */
export const IMAGE_SYSTEM_HINT = 'Этот сайт умеет сам генерировать картинки. Если пользователь ЯВНО просит нарисовать/сгенерировать/показать конкретную картинку, фото, логотип и т. п., НЕ отказывайся и не описывай картинку словами — ответь ровно одной строкой: [[IMAGE: <подробное описание картинки на английском>]]. Во всех остальных случаях (обычные вопросы, вопросы о твоих возможностях, жалобы) отвечай обычным текстом без маркера. Видео сайт генерировать НЕ умеет — на просьбы о видео честно скажи, что не можешь. / This site generates images: only for an explicit image request reply with [[IMAGE: <English prompt>]]; otherwise answer as text; video generation is NOT supported.';

export function classifierSystem(prev) {
  return 'You decide whether a chat message asks to GENERATE/SHOW a picture, and write an English prompt for an image model. ' +
    'Reply ONLY with compact JSON: {"image":true|false,"prompt":"..."}. Messages in any language; casual, misspelled or verb-less requests ("картинка крысы", "сгенерь кота", "a cat pic") are image=true. ' +
    'image=false for: questions about capabilities ("can you generate images?", "а ты умеешь рисовать?"), video/animation requests, complaints or chit-chat, questions about how to draw, charts/plots, code, tables, describing or analysing an existing image, definitions. ' +
    (prev ? 'The previous generated image prompt was: "' + prev.slice(0, 400) + '". If the message is a follow-up (another one, change color/style, same with a dog, etc.), image=true and the prompt must be the previous prompt rewritten with the requested change applied (e.g. color really changed everywhere it matters, subject replaced). ' : '') +
    'prompt: a concise vivid English description (subject, style, colors, details), without words like "draw", "generate", "image of". Max 60 words.';
}
export function parseClassifier(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('bad json');
  const o = JSON.parse(m[0]);
  const prompt = typeof o.prompt === 'string' ? o.prompt.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  if (o.image === true && !prompt) throw new Error('empty prompt');
  return { image: o.image === true, prompt };
}
/** Классификатор Pollinations (бесплатный, но бывает медленным/лимитированным). */
export async function askPollinations(text, ambiguous, signal, prev, timeoutMs = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort(); if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetch(TEXT_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal: ctl.signal,
      body: JSON.stringify({ model: 'openai', temperature: 0, messages: [{ role: 'system', content: classifierSystem(prev) }, { role: 'user', content: (ambiguous ? '[ambiguous] ' : '') + text }] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return parseClassifier(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
}
/** Первый успешный из нескольких классификаторов (Pollinations + быстрая текстовая модель сайта). */
export function firstOf(fns) {
  return (text, amb, signal, prev) => new Promise((res, rej) => {
    let left = fns.length; if (!left) return rej(new Error('no classifier'));
    for (const f of fns) Promise.resolve().then(() => f(text, amb, signal, prev)).then(res, e => { if (--left === 0) rej(e); });
  });
}
const askLLM = askPollinations;

/** Решение + англ. промпт. prev — промпт предыдущей картинки (для продолжений). null — не картинка.
 *  force — уже точно картинка (маркер/отказ текстовой модели): только промпт. */
export async function planImage(text, { signal, llm = askLLM, prev = '', force = false } = {}) {
  let intent = force ? 'yes' : detectImageIntent(text);
  const follow = !!prev && isFollowUp(text);
  if (follow && intent === 'no') intent = 'maybe';
  if (intent === 'no') return null;
  const strongish = ((intent === 'yes' && (NOUN.test(text) || DRAW.test(text))) || mentionsImage(text) || follow) && !(FEEDBACK.test(text) && !DRAW.test(text) && !MAKE.test(text));    // при сбое классификатора всё равно рисуем
  try {
    const o = await llm(text, intent === 'maybe', signal, follow ? prev : '');
    if (!o.image) return null;                                         // классификатор сказал «не картинка» — уважаем
    return { prompt: o.prompt || fallbackPrompt(text, follow ? prev : ''), translated: !!o.prompt };
  } catch (e) {
    if (signal && signal.aborted) throw e;
    if (!strongish) return null;
    return { prompt: fallbackPrompt(text, follow ? prev : ''), translated: false };
  }
}
function fallbackPrompt(text, prev) { const t = String(text || '').trim(); return prev ? prev + ', ' + t : t; }

export function imageUrl(prompt, { seed, width = 1024, height = 1024 } = {}) {
  const s = seed == null ? Math.floor(Math.random() * 1e9) : seed;
  return IMG_HOST + encodeURIComponent(String(prompt).slice(0, 500)) + `?width=${width}&height=${height}&nologo=true&seed=${s}`;
}
/** Разрешаем показывать только картинки Pollinations (история, общие ссылки). */
export const PAID_IMG_RE = /^\/api\/img\/[0-9a-f]{32}\.(?:jpg|png|webp)$/;
export function safeImageUrl(u) {
  if (typeof u === 'string' && PAID_IMG_RE.test(u)) return u;          // свой кэш платной генерации (ключ Pollinations на сервере)
  return typeof u === 'string' && u.length <= 2000 && u.startsWith(IMG_HOST) && !/[\s"'<>]/.test(u) ? u : '';
}
/** Ссылка бесплатного режима → параметры для платной генерации на нашем сервере. */
export function parseImageUrl(u) {
  if (typeof u !== 'string' || !u.startsWith(IMG_HOST)) return null;
  try {
    const x = new URL(u), prompt = decodeURIComponent(x.pathname.slice(new URL(IMG_HOST).pathname.length));
    const num = (k, d) => { const n = parseInt(x.searchParams.get(k), 10); return Number.isFinite(n) ? n : d; };
    return { prompt: prompt.slice(0, 600), seed: Math.abs(num('seed', 0)) % 2147483647, width: num('width', 1024), height: num('height', 1024) };
  } catch { return null; }
}

/** Для НЕявных сообщений: без маркера, только факты о возможностях сайта. */
export const IMAGE_TEXT_HINT = 'Справка о сайте (это правда, не спорь с ней): ты МОЖЕШЬ рисовать картинки — сайт сам генерирует их, когда пользователь явно попросит (например, «нарисуй кота»). Если спрашивают, умеешь ли ты рисовать/делать картинки или фото, отвечай: да, по просьбе, и предложи написать, что нарисовать. Видео генерировать НЕ умеешь — так и скажи. Отвечай обычным текстом; не пиши никаких служебных маркеров в двойных квадратных скобках.';
export function stripMarker(t) { return String(t || '').replace(/\[\[\s*IMAGE\b[\s\S]*?(?:\]\]|$)/gi, '').trim(); }
/** Текст вместо пустого ответа. */
export function emptyReplyText(user) {
  if (isVideoRequest(user)) return VIDEO_UNSUPPORTED;
  if (isCapabilityQuestion(user) || mentionsImage(user)) return 'Да, я умею рисовать картинки — напиши, что нарисовать (например: «нарисуй кота в шляпе»). Видео генерировать не умею.';
  return 'Модель вернула пустой ответ — попробуйте переформулировать вопрос или нажмите «Повторить».';
}

/* Готовые ответы на вопросы о возможностях (без вызова модели). */
const VIDWORD = RX('^(?:' + W('(?:видео\\w*|видос\\w*|ролик\\w*|клип\\w*|анимац\\w*|анимир\\w*|мульт\\w*|гифк\\w*)') + '|gif|gifs|video|videos|clips?|animations?|animate|movies?)$', 'iu');
const ONLYQ = t => /\?\s*$/.test(t) || QWORD.test(t);
const words = t => String(t || '').toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
const CAP_IMG = ['Да, умею рисовать картинки — напиши, что нарисовать, например: «нарисуй кота в космосе».',
  'Да, могу сделать картинку по просьбе — просто опиши её, например: «нарисуй закат над морем в стиле аниме».',
  'Умею! Напиши, что изобразить, — например: «сгенерируй картинку с драконом над замком».'];
const CAP_VID = 'Нет, генерировать видео я не умею. Зато могу нарисовать картинку (например, кадр или постер), написать сценарий или раскадровку.';
const CAP_BOTH = 'Картинки — да: напиши, что нарисовать, например «нарисуй кота в космосе». Видео — нет, генерировать видео я не умею, но могу сделать постер-картинку или сценарий.';
/** Вопрос о возможностях по картинкам/видео → готовый текст; иначе null. */
export function capabilityAnswer(text, pick = Math.random()) {
  const t = String(text || '').trim();
  if (!t || t.length > 160 || !ONLYQ(t) || HARDNEG.test(t) || /^\s*(?:please\s+)?draw\s+me\b/i.test(t)) return null;
  const ws = words(t); if (!ws.length) return null;
  if (!ws.every(w => CAPWORD.test(w) || VIDWORD.test(w))) return null;     // есть конкретный предмет («кота») — это просьба, не вопрос
  const vid = ws.some(w => VIDWORD.test(w));
  const img = ws.some(w => !VIDWORD.test(w) && (NOUN.test(w) || DRAW.test(w) || /^(?:рису\S*|рисов\S*|нарис\S*|изображ\S*|draw|paint)$/iu.test(w))) || (!vid && ws.some(w => GEN.test(w)));
  if (vid && img) return CAP_BOTH;
  if (vid) return CAP_VID;
  if (img) return CAP_IMG[Math.floor(pick * CAP_IMG.length) % CAP_IMG.length];
  return null;
}
