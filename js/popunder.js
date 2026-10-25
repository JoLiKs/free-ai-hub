/* Публичные флаги сайта (/api/site-config через _worker.js) + реклама, управляемая из админки (Настройки → Реклама):
 *  - Popunder (Adsterra) — только при popunder === true;
 *  - баннер 160×300 (Adsterra) в боковой панели на десктопе — только при banner160 === true.
 * Любая ошибка/таймаут/нет эндпоинта (GitHub Pages) → реклама выключена, imggen по умолчанию включён.
 * Промис с конфигом доступен как window.FAH_SITE_CONFIG (его использует чат для генерации картинок). */
(function () {
  var SRC = 'https://abscloud.org/1/b9f21345bbec20ebda6c7c6d2ef309ca';
  var B160 = '861ab60e21b94af9a777ec082eba16b2';
  var DEF = { popunder: false, banner160: false, imggen: true, imggen_paid: false };
  function load() {
    if (!window.fetch || location.protocol === 'file:') return Promise.resolve(DEF);
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
    return fetch('/api/site-config', { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { clearTimeout(t); var o = {}; for (var k in DEF) o[k] = c && typeof c[k] === 'boolean' ? c[k] : DEF[k]; return o; })
      .catch(function () { clearTimeout(t); return DEF; });
  }
  var cfgP = window.FAH_SITE_CONFIG = load();

  function popunder() {
    if (document.querySelector('script[src="' + SRC + '"]')) return;
    var s = document.createElement('script'); s.setAttribute('data-cfasync', 'false'); s.src = SRC; document.body.appendChild(s);
  }
  // Баннер 160×300: atOptions глобальный и скрипт пишет через document.write → изолируем в собственном iframe (/ads/b160.html, тот же домен),
  // чтобы не конфликтовать с Native Banner / Social Bar. Только на широких экранах; пустой — скрыт.
  function banner160() {
    var box = document.getElementById('banner160');
    if (!box || box.dataset.loaded) return;
    var wide = window.matchMedia ? window.matchMedia('(min-width: 821px) and (min-height: 760px)') : { matches: true };
    var start = function () {
      if (!wide.matches || box.dataset.loaded) return;
      box.dataset.loaded = '1';
      var f = document.createElement('iframe');
      f.title = 'Реклама'; f.width = '160'; f.height = '300'; f.setAttribute('scrolling', 'no');
      f.src = '/ads/b160';
      box.querySelector('.b160-slot').appendChild(f); box.hidden = false;   // показываем сразу (рекламе нужен видимый слот), пустой — скрываем ниже
      // показываем, только когда внутри появилось содержимое (iframe/img рекламной сети)
      var tries = 0, iv = setInterval(function () {
        tries++;
        var filled = false;
        try { var d = f.contentDocument; filled = !!(d && d.body && d.body.querySelector('iframe,img,a,ins,div,object,embed')); } catch (e) { filled = true; }
        if (filled) clearInterval(iv); else if (tries > 40) { clearInterval(iv); box.hidden = true; }
      }, 500);
    };
    if (wide.matches) start(); else if (wide.addEventListener) wide.addEventListener('change', start);
  }

  cfgP.then(function (cfg) {
    if (cfg.popunder === true) popunder();
    if (cfg.banner160 === true) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner160); else banner160(); }
  });
})();
