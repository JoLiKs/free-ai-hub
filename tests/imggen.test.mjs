// Детектор запросов картинок: 60+ фраз (явные, разговорные, с опечатками, без глагола, EN) + ложные срабатывания + продолжения.
import { detectImageIntent as d, isVideoRequest, isFollowUp, isImageRefusal, imageMarker, planImage } from '../js/imggen.js?v=3.9';
const YES = [ // ожидаем 'yes' или 'maybe' (идёт на генерацию/классификатор), но НЕ 'no'
  'картинка крысы', 'крыса картинкой', 'нарисуй мне крысу', 'а можешь картинку с крысой?', 'сгенерь крысу', 'фото крысы в шляпе',
  'Сделай картинку с крысой', 'можешь сделать картинку с крысой', 'хочу картинку крысы', 'Давай картинку с крысой', 'создай кртинку крысы',
  'картинку с крысой пожалуйста', 'Нарисуй крысу', 'Сгенерируй изображение крысы', 'А картинку с крысой можешь?', 'покажи крысу на картинке',
  'дай фотку крысы', 'нужна картинка крыса-пират', 'крыса в космосе, картинка', 'изоброжение крысы', 'картика с крысой', 'генерни крысу в очках',
  'нарисуйте пожалуйста крысу', 'сгенерируй крысу', 'можешь нарисовать крысу?', 'Нарисуешь крысу?', 'аватарка с крысой', 'логотип с крысой для кафе',
  'обои с крысой на рабочий стол', 'постер с крысой', 'арт крысы в стиле киберпанк', 'иллюстрация: крыса читает книгу', 'рисунок крысы',
  'пикча с крысой', 'изобрази крысу', 'крыса, фото', 'фото кота в шляпе', 'Нарисуй кота в космосе', 'нарисуйте закат над морем',
  'создай изображение футуристического города', 'Сделай логотип для кофейни', 'сгенерируй фото девушки в лесу', 'Пожалуйста, нарисуй единорога',
  'хочу картинку с котиком', 'сделай крысу', 'скинь картинку с крысой', 'Draw a cat wearing a hat', 'generate an image of a red sports car',
  'a picture of mountains at sunrise', 'create a logo for my startup', 'rat picture', 'a rat pic please', 'can you draw a rat?', 'show me a rat image',
  'make an image of a rat in a hat', 'generate a rat', 'rat wallpaper', 'photo of a rat on the moon', 'Сгенерируй картинку с драконом', 'картинка: крыса-рыцарь'
];
const NO = [
  'как нарисовать график в excel', 'Как нарисовать кота карандашом?', 'Напиши код для генерации изображения на python', 'Объясни, что такое изображение в линейной алгебре',
  'что такое изображение в математике', 'построй диаграмму продаж', 'what is an image file format', 'Привет, как дела?', 'Сравни REST и GraphQL в виде таблицы',
  'how to draw a chart in matplotlib', 'Опиши это фото', 'что изображено на картинке?', 'как сжать фото без потери качества', 'как вставить картинку в word',
  'Расскажи про крыс', 'Чем кормить декоративную крысу?', 'Сколько живут крысы', 'Переведи на английский: кошка', 'Напиши стихотворение про осень',
  'describe this photo', 'как сделать график в excel', 'Что такое фотосинтез?'
];
const FOLLOW = ['а теперь в синем цвете', 'ещё одну', 'сделай такую же с собакой', 'другой вариант', 'а теперь ночью', 'в стиле аниме', 'another one', 'make it blue', 'перерисуй покрупнее'];
const NOTFOLLOW = ['Спасибо!', 'Расскажи про крыс', 'как нарисовать график в excel'];
let bad = 0; const fail = (...a) => { bad++; console.log('FAIL', ...a); };
for (const t of YES) if (d(t) === 'no') fail('missed:', t);
for (const t of NO) if (d(t) === 'yes') fail('false+ :', t, d(t));
for (const t of NO) if (d(t) !== 'no' && !/фото|картин|изображ/i.test(t)) fail('false maybe:', t, d(t));
for (const t of FOLLOW) if (!isFollowUp(t)) fail('follow missed:', t);
for (const t of NOTFOLLOW) if (isFollowUp(t)) fail('follow false+:', t);
for (const r of ['Я не могу создавать или генерировать изображения, но могу помочь вам описать', 'К сожалению, я не умею рисовать картинки.', "I can't create images, but I can describe", 'I am unable to generate images.']) if (!isImageRefusal(r)) fail('refusal missed:', r);
for (const r of ['Крысы — умные животные.', 'Я могу описать картинку.', 'Here is a description.']) if (isImageRefusal(r)) fail('refusal false+:', r);
if (imageMarker('[[IMAGE: a cute rat in a hat]]') !== 'a cute rat in a hat') fail('marker');
// сбой классификатора: слово-«картинка» → всё равно рисуем; без него — текст
const boom = async () => { throw new Error('timeout'); };
if (!(await planImage('а можешь картинку с крысой?', { llm: boom }))) fail('classifier fail dropped noun prompt');
if (await planImage('сделай крысу', { llm: boom })) fail('classifier fail should not force verb-only');
const fp = await planImage('а теперь в синем цвете', { llm: boom, prev: 'a rat in a hat' });
if (!fp || !/a rat in a hat/.test(fp.prompt)) fail('follow-up fallback must merge prev prompt');
if (await planImage('Спасибо, отличная картинка!', { llm: boom, prev: 'a rat' })) fail('feedback must not draw on classifier failure');
if (d('Спасибо, отличная картинка!') === 'yes') fail('feedback yes');
if (await planImage('Расскажи про крыс', { llm: boom, prev: 'a rat' })) fail('non-follow after image');

// баг 23.10: вопросы/жалобы/видео не должны становиться картинками
const TEXT_ONLY = ['А видео генерировать можешь?', 'Я задал тебе вопрос,а не сказал генерировать картинку', 'Ты шо прикалуешься', 'Згинирируй мне видео о крипто мире!',
  'Можешь ли ты генерировать картинки?', 'А ты умеешь рисовать?', 'генерировать умеешь?', 'can you generate images?', 'Сгенерируй мне текст поздравления', 'не надо картинку, просто ответь',
  'сделай видео про котов', 'generate a video of a cat', 'хватит рисовать картинки'];
for (const t of TEXT_ONLY) if (d(t) !== 'no' && !(d(t) === 'maybe' && /текст/.test(t))) fail('text-only got image intent:', t, d(t));
for (const t of TEXT_ONLY) if (isFollowUp(t) && !/текст/.test(t)) fail('text-only is follow-up:', t);
for (const t of ['А видео генерировать можешь?', 'Згинирируй мне видео о крипто мире!', 'сделай видео про котов', 'generate a video of a cat', 'анимируй эту картинку', 'сгенерируй ролик']) if (!isVideoRequest(t)) fail('video missed:', t);
for (const t of ['как смонтировать видео на телефоне', 'Нарисуй крысу', 'Расскажи про фильм Матрица']) if (isVideoRequest(t)) fail('video false+:', t);
const no = async () => ({ image: false, prompt: '' });
if (await planImage('сгенерируй мне текст поздравления', { llm: no })) fail('classifier "no" must be respected');
if (await planImage('сгенерируй крысу', { llm: boom })) fail('bare generate verb on classifier failure must not draw');
const n = TEXT_ONLY.length + YES.length + NO.length + FOLLOW.length + NOTFOLLOW.length;
console.log(bad ? `FAIL ${bad}` : `imggen tests: ${n} phrases OK`); process.exit(bad ? 1 : 0);
