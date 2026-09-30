/* Необязательная реклама Google AdSense. ВЫКЛЮЧЕНА, пока ADSENSE_CLIENT в js/config.js пуст или имеет неверный формат.
 *
 * Правила:
 *  - скрипт Google (pagead2.googlesyndication.com) загружается ТОЛЬКО после выбора пользователя в окне «Реклама»
 *    (или ранее сохранённого выбора в localStorage `fah.settings.adsConsent`: 'personal' | 'nonpersonal');
 *  - «Только неперсонализированная» → перед загрузкой ставится window.adsbygoogle.requestNonPersonalizedAds = 1;
 *  - ID издателя проверяется строгим регэкспом (защита от инъекции в URL/атрибуты);
 *  - любые ошибки (блокировщик рекламы, сеть) молча игнорируются и не влияют на чат;
 *  - без ADSENSE_SLOT рисовать нечего (авто-реклама через сам скрипт); с ним — одна плашка, скрытая, пока реклама не загрузится.
 * Модуль не трогает DOM на верхнем уровне (проверяется в Node). */
import { store as defaultStore } from './store.js';

export const CLIENT_RE = /^ca-pub-\d{10,20}$/;
export const SLOT_RE = /^\d{5,20}$/;
export const CONSENT_KEY = 'settings.adsConsent';       // → localStorage 'fah.settings.adsConsent'
export const SCRIPT_BASE = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
export const ADS_PRIVACY_NOTE = ' Реклама (если включена) показывается сервисом Google AdSense: он может использовать cookies для персонализированной рекламы; выбор можно изменить в «Настройки → Реклама».';

export const isValidClient = id => typeof id === 'string' && CLIENT_RE.test(id);
export const isValidSlot = s => typeof s === 'string' && SLOT_RE.test(s);
export const scriptUrl = id => (isValidClient(id) ? SCRIPT_BASE + '?client=' + id : '');

export function createAds({ client = '', slot = '', store = defaultStore, win = globalThis.window, doc = globalThis.document } = {}) {
  const cid = isValidClient(client) ? client : '';
  const sid = cid && isValidSlot(slot) ? slot : '';
  let loaded = false, box = null;
  const api = {
    get enabled() { return !!cid; },
    get client() { return cid; },
    get slot() { return sid; },
    get loaded() { return loaded; },
    /** 'personal' | 'nonpersonal' | '' */
    get consent() { const v = store.get(CONSENT_KEY, ''); return v === 'personal' || v === 'nonpersonal' ? v : ''; },
    get needsAsk() { return !!cid && api.consent === ''; },
    setConsent(v) { if (v !== 'personal' && v !== 'nonpersonal') return false; store.set(CONSENT_KEY, v); return true; },
    /** Загружает скрипт AdSense, если реклама включена и пользователь сделал выбор. Возвращает true, если загрузка начата. */
    load() {
      try {
        if (!cid || loaded || !api.consent || !doc || !win) return false;
        loaded = true;
        win.adsbygoogle = win.adsbygoogle || [];
        if (api.consent === 'nonpersonal') win.adsbygoogle.requestNonPersonalizedAds = 1;
        const s = doc.createElement('script');
        s.async = true; s.crossOrigin = 'anonymous'; s.src = scriptUrl(cid);
        s.onerror = () => { /* блокировщик рекламы / сеть — молча */ };
        (doc.head || doc.documentElement).appendChild(s);
        api.mount();
        return true;
      } catch { return false; }
    },
    /** Плашка «Реклама» (только при заданном ADSENSE_SLOT): скрыта, пока Google не отдал объявление. */
    mount() {
      try {
        if (!sid || box || !doc) return;
        const host = doc.getElementById('sidebar'); if (!host) return;
        box = doc.createElement('div'); box.className = 'ad-box'; box.id = 'adBox';
        const lab = doc.createElement('span'); lab.className = 'ad-label'; lab.textContent = 'Реклама';
        const ins = doc.createElement('ins'); ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        ins.setAttribute('data-ad-client', cid); ins.setAttribute('data-ad-slot', sid);
        ins.setAttribute('data-ad-format', 'horizontal'); ins.setAttribute('data-full-width-responsive', 'false');
        box.append(lab, ins); host.appendChild(box);
        const mark = () => { if (ins.getAttribute('data-ad-status') === 'filled') box.classList.add('filled'); else box.classList.remove('filled'); };
        if (win.MutationObserver) new win.MutationObserver(mark).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
        let pushed = false;
        const push = () => {
          if (pushed || !ins.offsetWidth) return;                 // у свёрнутой панели ширина 0 — Google не покажет объявление
          pushed = true;
          try { (win.adsbygoogle = win.adsbygoogle || []).push({}); } catch { /* */ }
        };
        push();
        if (!pushed && win.ResizeObserver) { const ro = new win.ResizeObserver(() => { push(); if (pushed) ro.disconnect(); }); ro.observe(box); }
      } catch { /* реклама не должна ломать чат */ }
    }
  };
  return api;
}

/** Диалог выбора для рекламы. Возвращает 'personal' | 'nonpersonal'. Esc выбор не заменяет. */
export function showAdsDialog(doc = document) {
  return new Promise(resolve => {
    const d = doc.createElement('dialog'); d.className = 'dialog consent ads-consent'; d.id = 'adsDialog';
    d.setAttribute('aria-labelledby', 'adsTitle'); d.setAttribute('aria-describedby', 'adsText');
    d.innerHTML = '<form method="dialog"><h2 id="adsTitle">Реклама на сайте</h2><div class="dialog-body"><p id="adsText">На сайте может показываться реклама Google. Реклама от Google может использовать файлы cookie для показа персонализированных объявлений.</p><p class="muted small">Выберите «Только неперсонализированная», если не хотите персонализации: реклама будет зависеть только от содержимого страницы. На работу чата это не влияет. Выбор можно изменить в «Настройки → Реклама».</p></div><div class="dialog-actions"><button class="btn" value="nonpersonal" id="adsNonPersonal">Только неперсонализированная</button><button class="btn primary" value="personal" id="adsPersonal" autofocus>Принимаю</button></div></form>';
    doc.body.appendChild(d);
    d.addEventListener('cancel', e => e.preventDefault());
    d.addEventListener('close', () => { const v = d.returnValue === 'personal' ? 'personal' : 'nonpersonal'; d.remove(); resolve(v); });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  });
}
