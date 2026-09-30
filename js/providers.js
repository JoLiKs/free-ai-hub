/* ------------------------------------------------------------------ *
 *  Провайдеры. Чтобы добавить ещё один OpenAI-совместимый эндпоинт —
 *  добавьте объект в PROVIDERS (см. README → «Как добавить провайдера»).
 *
 *  group:   'keyless' — работает без ключа, 'key' — нужен (бесплатный) ключ,
 *           'local'   — модель запускается прямо в браузере, 'proxy' — нужен ваш CORS-прокси (proxy/)
 *  keyMode: 'none' | 'optional' | 'required'
 *  limits:  клиентский ограничитель запросов (см. queue.js):
 *           { concurrency, minGapMs, rate: {max, perMs, per:'model'|'provider'} }
 * ------------------------------------------------------------------ */

export const PROVIDERS = [
  {
    id: 'ovh', name: 'OVHcloud AI Endpoints', short: 'OVHcloud', group: 'keyless', type: 'openai', keyMode: 'none', defaultModel: 'Mistral-Small-3.2-24B-Instruct-2506',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    tags: ['без ключа', 'лимит 2/мин'], speed: 'fast',
    vision: ['Qwen2.5-VL-72B-Instruct', 'Qwen3.8-27B', 'Qwen3.6-27B', 'Qwen3.5-9B'],   // проверено curl'ом 30.09.2026: ответили на картинку
    hint: 'Анонимный бесплатный доступ к открытым моделям (Qwen, Llama, Mistral, gpt-oss) в дата-центрах ЕС. Без ключа и регистрации. Лимит — 2 запроса в минуту на модель с вашего IP: приложение само ждёт или переключается на другую модель.',
    limits: { concurrency: 3, rate: { max: 2, perMs: 60000, per: 'model' } },
    staticModels: [
      'gpt-oss-20b', 'gpt-oss-120b', 'Meta-Llama-3_3-70B-Instruct', 'Qwen3.5-9B', 'Qwen3.6-27B', 'Qwen3.8-27B',
      'Qwen3.5-397B-A17B', 'Qwen3-Coder-30B-A3B-Instruct', 'Mistral-Small-3.2-24B-Instruct-2506',
      'Mistral-Nemo-Instruct-2407', 'Mistral-7B-Instruct-v0.3', 'Qwen2.5-VL-72B-Instruct'
    ],
    parseModels(json) {
      // в списке есть эмбеддинги, речь, картинки и guard-модели — оставляем только чат
      return (json.data || [])
        .filter(m => m.context_length > 0 && !/bge|whisper|stable-diffusion|tts|embedding|guard/i.test(m.id))
        .map(m => ({ id: m.id, label: m.id, meta: 'контекст ' + Math.round(m.context_length / 1000) + 'K' }));
    }
  },
  {
    id: 'chat', name: 'ch.at', short: 'ch.at', group: 'keyless', type: 'openai', keyMode: 'none',
    baseUrl: 'https://ch.at/v1', noModelsEndpoint: true,
    tags: ['без ключа', 'потоковый'], speed: 'fast',
    hint: 'Публичный бесплатный чат-шлюз ch.at: без регистрации и ключа, потоковый ответ. Одна универсальная модель (имя модели сервер игнорирует).',
    limits: { concurrency: 2 },
    staticModels: [{ id: 'gpt-4o', label: 'ch.at — универсальная модель', meta: 'имя модели сервер игнорирует' }]
  },
  {
    id: 'llm7', name: 'LLM7.io', short: 'LLM7', group: 'keyless', type: 'openai', keyMode: 'optional', defaultModel: 'mistral-Nemo-Instruct-2407',
    baseUrl: 'https://api.llm7.io/v1', keyUrl: 'https://token.llm7.io/',
    tags: ['без ключа', 'строгие лимиты'], speed: 'fast',
    hint: 'Бесплатный шлюз. Без ключа доступны только «turbo»-модели (остальные — 401). Один запрос одновременно; при 429/503 приложение подождёт и повторит. Ключ с token.llm7.io — по желанию.',
    limits: { concurrency: 1, minGapMs: 1200 },
    staticModels: ['codestral-latest', 'mistral-Nemo-Instruct-2407'],
    parseModels(json, key) {
      // Без ключа доступны только модели уровня "turbo".
      return (json.data || [])
        .filter(m => (m.model_type || 'chat') === 'chat' && (key || m.tier === 'turbo'))
        .sort((a, b) => (b.tier === 'turbo') - (a.tier === 'turbo'))
        .map(m => ({ id: m.id, label: m.id, meta: [m.tier, m.reasoning ? 'reasoning' : '', m.context_window && m.context_window.tokens ? Math.round(m.context_window.tokens / 1000) + 'K ctx' : ''].filter(Boolean).join(' · ') }));
    }
  },
  {
    id: 'horde', name: 'AI Horde (волонтёры)', short: 'AI Horde', group: 'keyless', type: 'openai', keyMode: 'optional', defaultModel: 'aphrodite/TheDrummer/Skyfall-31B-v4.2',
    baseUrl: 'https://oai.aihorde.net/v1', anonKey: '0000000000', keyUrl: 'https://aihorde.net/register',
    statusUrl: 'https://aihorde.net/api/v2/status/models?type=text&min_count=1',
    tags: ['без ключа', 'медленно', 'волонтёры видят промпт'], speed: 'slow', privacy: 'Запросы обрабатывают и видят волонтёры сети.',
    slowNote: 'AI Horde: ответ собирают волонтёры — обычно 5–60 с, иногда дольше…',
    hint: 'Краудсорсинговая сеть GPU-волонтёров. Работает с общедоступным анонимным ключом 0000000000 (встроен). Ответ приходит целиком и может идти десятки секунд; модели — в основном небольшие и RP-файнтюны, качество разное. Запросы видят волонтёры — не отправляйте личное.',
    limits: { concurrency: 2 }, timeoutMs: 180000, noStream: true, ctxBudget: 2500,
    staticModels: [
      'aphrodite/DeepSeek-V4.1-Flash', 'aphrodite/TheDrummer/Skyfall-31B-v4.2', 'aphrodite/TheDrummer/Behemoth-X-123B-v2.1',
      'aphrodite/SicariusSicariiStuff/Impish_LLAMA_4B', 'koboldcpp/gemma-4-31B-it-heretic', 'koboldcpp/Angelic_Eclipse-12B',
      'koboldcpp/mini-magnum-12b-v1.1', 'koboldcpp/L3-8B-Stheno-v3.2', 'koboldcpp/Llama-3.2-3B-Instruct', 'koboldcpp/Llama-3.2-1B-Instruct',
      'koboldcpp/gemma-3-4b-it-heretic', 'koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic', 'koboldcpp/NVIDIA-Nemotron-3-Nano-4B-Q4_K_M',
      'koboldcpp/Qwen3-4B-Nymphaea-RP.i1-Q4_K_S', 'koboldcpp/Qwen/Qwen3.5-2B', 'koboldcpp/Qwen/Qwen3.5-0.8B', 'koboldcpp/Qwen_Qwen3-0.6B-IQ4_XS'
    ],
    flaky: {
      'koboldcpp/Qwen/Qwen3.5-2B': 'очень маленькая модель — ответ может быть с мусором',
      'koboldcpp/Qwen/Qwen3.5-0.8B': 'очень маленькая модель — ответ может быть с мусором',
      'koboldcpp/Qwen_Qwen3-0.6B-IQ4_XS': 'очень маленькая модель — ответ может быть с мусором',
      'koboldcpp/Llama-3.2-1B-Instruct': 'очень маленькая модель',
      'aphrodite/TheDrummer/Behemoth-X-123B-v2.1': 'очередь бывает длинной',
      'koboldcpp/gemma-4-31B-it-heretic': 'очередь бывает длинной'
    },
    parseModels(json) {
      const arr = (json.data || []).slice().sort((a, b) => (b.worker_threads || 0) - (a.worker_threads || 0));
      return arr.map(m => ({ id: m.id, label: (m.clean_name || m.id).replace(/^koboldcpp\/|^aphrodite\//, ''), meta: (m.worker_threads || 0) + ' волонтёр(ов) онлайн' }));
    },
    // Живая статистика очередей: заменяет «пинг» (не нагружаем волонтёров тестовыми задачами)
    applyStatus(list, status) {
      const by = new Map((status || []).map(s => [s.name, s]));
      return list.map(m => { const s = by.get(m.id); return s ? Object.assign({}, m, { live: { count: s.count, eta: s.eta, queued: s.queued } }, { meta: `${s.count} волонтёр(ов) · ожидание ≈ ${s.eta} с` }) : m; });
    }
  },
  {
    id: 'pollinations', name: 'Pollinations Text', short: 'Pollinations', group: 'keyless', type: 'openai', keyMode: 'optional',
    baseUrl: 'https://text.pollinations.ai/openai', modelsUrl: 'https://text.pollinations.ai/openai/models', chatUrl: 'https://text.pollinations.ai/openai',
    keyUrl: 'https://enter.pollinations.ai/',
    tags: ['без ключа', 'лимит ~1/15 с', 'нестабильно'], speed: 'fast',
    hint: 'Анонимный уровень — одна модель (gpt-oss-20b, reasoning) с лимитом ~1 запрос / 15 с на IP; при превышении сервис отвечает 402 — приложение подождёт и повторит. Иногда блокирует запросы по адресу сайта (402/403).',
    limits: { concurrency: 1, minGapMs: 15000 }, ctxBudget: 8000,
    staticModels: [{ id: 'openai-fast', label: 'openai-fast (gpt-oss-20b)', meta: 'reasoning' }],
    flaky: { 'openai-fast': 'частые 402 из-за лимита ~1 запрос / 15 с' },
    parseModels(json) {
      const arr = Array.isArray(json) ? json : (json.data || []);
      return arr.filter(m => !m.output_modalities || m.output_modalities.includes('text'))
        .map(m => ({ id: m.name || m.id, label: m.name || m.id, meta: m.description || '' }));
    }
  },
  {
    id: 'local', name: 'В браузере (WebGPU/WASM)', short: 'В браузере', group: 'local', type: 'local', keyMode: 'none', defaultModel: 'onnx-community/Qwen2.5-0.5B-Instruct',
    tags: ['без сервера', 'офлайн после загрузки', 'загрузка 180–800 МБ'], speed: 'local',
    hint: 'Модель скачивается один раз (кэшируется браузером) и работает прямо у вас на устройстве — без сервера и без ключа, промпты никуда не уходят. Нужен современный браузер; с WebGPU быстрее. Библиотека и веса грузятся с jsDelivr и Hugging Face (единственные внешние загрузки этого режима).',
    limits: { concurrency: 1 }, ctxBudget: 1500,
    staticModels: [
      { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', label: 'SmolLM2 135M', size: 182e6, meta: '≈180 МБ · очень слабая, для проверки' },
      { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', label: 'SmolLM2 360M', size: 388e6, meta: '≈390 МБ · простые задачи, англ.' },
      { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Qwen 2.5 0.5B', size: 786e6, meta: '≈790 МБ · лучший из малых, мультиязычный' }
    ]
  },
  {
    id: 'kilo', name: 'Kilo Gateway (через ваш прокси)', short: 'Kilo', group: 'proxy', type: 'openai', keyMode: 'none', needsProxy: true, proxyPath: '/kilo',
    keyUrl: 'https://kilo.ai/docs/gateway/authentication', defaultModel: 'kilo-auto/free',
    tags: ['нужен CORS-прокси', 'без ключа', 'лимит ≈200/час', 'может обучаться на промптах'], speed: 'fast',
    privacy: 'Бесплатные модели Kilo могут логировать и использовать промпты для обучения.',
    hint: 'Kilo Gateway отдаёт бесплатные модели без ключа (≈200 запросов/час на IP), но НЕ отправляет CORS-заголовки — из браузера напрямую не работает. Разверните proxy/worker.js (Cloudflare Workers, бесплатно) и укажите его адрес в «Настройки → CORS-прокси». Промпты могут использоваться для обучения.',
    limits: { concurrency: 2, rate: { max: 20, perMs: 60000, per: 'provider' } },
    parseModels(json) {
      return (json.data || []).filter(m => m.isFree && !/content-safety|space-bunny/i.test(m.id))
        .map(m => ({ id: m.id, label: m.name && m.name !== m.id ? m.name : m.id, meta: (m.context_length ? Math.round(m.context_length / 1000) + 'K ctx' : '') + (m.id.startsWith('kilo-auto') || m.id.startsWith('openrouter/') ? ' · авто-роутер' : '') }));
    }
  },
  {
    id: 'openrouter', name: 'OpenRouter (free)', short: 'OpenRouter', group: 'key', type: 'openai', keyMode: 'required',
    baseUrl: 'https://openrouter.ai/api/v1', modelsUrl: 'https://openrouter.ai/api/v1/models', modelsNeedKey: false,
    keyUrl: 'https://openrouter.ai/keys', tags: ['нужен ключ'], speed: 'fast',
    hint: 'Список бесплатных моделей загружается без ключа. Для самого чата нужен бесплатный ключ OpenRouter.',
    limits: { concurrency: 2, rate: { max: 20, perMs: 60000, per: 'provider' } },
    parseModels(json) {
      return (json.data || [])
        .filter(m => m.pricing && String(m.pricing.prompt) === '0' && String(m.pricing.completion) === '0')
        .map(m => ({ id: m.id, label: m.name || m.id, meta: m.context_length ? Math.round(m.context_length / 1000) + 'K ctx' : '' }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
  },
  {
    id: 'groq', name: 'Groq', short: 'Groq', group: 'key', type: 'openai', keyMode: 'required',
    baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', tags: ['нужен ключ', 'очень быстро'], speed: 'fast',
    hint: 'Очень быстрый инференс, бесплатный тариф с лимитами. Нужен бесплатный ключ.',
    limits: { concurrency: 2 },
    parseModels(json) {
      return (json.data || []).filter(m => !/whisper|tts|guard|orpheus|playai/i.test(m.id))
        .map(m => ({ id: m.id, label: m.id, meta: (m.owned_by || '') + (m.context_window ? ' · ' + Math.round(m.context_window / 1000) + 'K ctx' : '') }));
    }
  },
  {
    id: 'gemini', name: 'Google Gemini', short: 'Gemini', group: 'key', type: 'gemini', keyMode: 'required',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', tags: ['нужен ключ'], speed: 'fast',
    hint: 'Бесплатный ключ из Google AI Studio. Есть бесплатный тариф с лимитами.',
    limits: { concurrency: 2 },
    staticModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    parseModels(json) {
      return (json.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name, meta: m.name.replace(/^models\//, '') }));
    }
  },
  {
    id: 'custom', name: 'Свой OpenAI-совместимый', short: 'Свой', group: 'key', type: 'openai', keyMode: 'optional', custom: true,
    keyUrl: 'https://github.com/public-apis/public-apis#machine-learning', tags: ['свой URL'], speed: 'fast',
    hint: 'Любой сервер с /chat/completions в формате OpenAI: LM Studio, Ollama (http://localhost:11434/v1), vLLM, свой прокси и т.д. Для доступа к сервису без CORS см. /proxy/.',
    limits: { concurrency: 2 }
  }
];

export const pById = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

/** Порядок провайдеров для автопереключения при сбое (только без ключа) */
export const FALLBACK_ORDER = ['ovh', 'chat', 'llm7', 'pollinations', 'horde'];

export const SYSTEM_PRESETS = [
  { id: '', name: 'Без системного промпта', text: '' },
  { id: 'ru', name: 'Кратко и по-русски', text: 'Отвечай кратко, точно и по-русски. Если не уверен — так и скажи.' },
  { id: 'dev', name: 'Помощник программиста', text: 'Ты опытный senior-разработчик. Давай рабочий, лаконичный код с краткими пояснениями, указывай крайние случаи и сложность. Код — в блоках с указанием языка.' },
  { id: 'tr', name: 'Переводчик RU⇄EN', text: 'Ты переводчик. Если текст на русском — переведи на английский, если на английском — на русский. Выводи только перевод, без комментариев.' },
  { id: 'eli5', name: 'Объясни просто', text: 'Объясняй простыми словами, как для новичка, с короткими аналогиями и примерами. Разбивай ответ на небольшие шаги.' },
  { id: 'edit', name: 'Редактор текста', text: 'Ты редактор. Исправь ошибки, улучшь стиль и ясность, сохранив смысл и тон автора. Сначала выдай исправленный текст, затем список главных правок.' }
];

export const SUGGESTIONS = [
  { icon: '💡', title: 'Объяснить', text: 'Объясни, что такое замыкания в JavaScript, с коротким примером' },
  { icon: '🐍', title: 'Код', text: 'Напиши функцию на Python, которая проверяет, является ли строка палиндромом (игнорируя регистр и знаки)' },
  { icon: '🚀', title: 'Идеи', text: 'Придумай 5 идей для pet-проекта на выходные, каждую — в одну строку' },
  { icon: '🌍', title: 'Перевод', text: 'Переведи на английский и объясни нюансы: «Счастье — это простые вещи»' },
  { icon: '📊', title: 'Таблица', text: 'Сравни REST, GraphQL и gRPC в виде таблицы: плюсы, минусы, когда выбирать' },
  { icon: '✍️', title: 'Текст', text: 'Напиши вежливое письмо коллеге с просьбой перенести встречу на завтра' }
];

/** Понимает ли модель картинки (OpenAI-формат image_url). У «своего» эндпоинта — на совести пользователя. */
export function supportsVision(p, mid) {
  if (!p) return false;
  if (p.custom) return true;
  return Array.isArray(p.vision) && p.vision.includes(mid);
}
