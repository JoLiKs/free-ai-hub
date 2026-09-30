/* Реклама: (1) по умолчанию (ADSENSE_CLIENT пуст) — ни одного запроса к Google, нет окна/блока;
 *          (2) с фиктивным ID (config.js подменяется ТОЛЬКО в этом тесте): окно согласия, загрузка скрипта после выбора, NPA, блок «Реклама»,
 *              тёмная/светлая/кибер/мобильный 390px, блокировщик рекламы не ломает чат.
 * env: SHOTS=dir (скриншоты ads-*.png), CHROME. Сам поднимает статический сервер; Google подменён моком (сеть не используется). */
const http=require('http'),fs=require('fs'),path=require('path');
const {launch,open,sleep}=require('./lib.cjs');
const ROOT=path.join(__dirname,'..','..'), SHOTS=process.env.SHOTS;
const FAKE='ca-pub-1234567890123456', SLOT='1234567890';
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
function serve(overrideConfig){
  return new Promise(res=>{const s=http.createServer((q,r)=>{
    let u=decodeURIComponent(q.url.split('?')[0]); if(u==='/') u='/index.html';
    if(u==='/js/config.js'&&overrideConfig){r.writeHead(200,{'content-type':'text/javascript'});return r.end(overrideConfig);}
    const f=path.join(ROOT,u); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}
    r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);
  }).listen(0,'127.0.0.1',()=>res(s));});
}
const cfgWith=(client,slot)=>fs.readFileSync(path.join(ROOT,'js/config.js'),'utf8').replace(/ADSENSE_CLIENT = '[^']*'/,`ADSENSE_CLIENT = '${client}'`).replace(/ADSENSE_SLOT = '[^']*'/,`ADSENSE_SLOT = '${slot}'`).replace(/BACKEND_URL = '[^']*'/,"BACKEND_URL = ''");
const sse=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\ndata: [DONE]\n\n';
/* мок Google: скрипт «заполняет» <ins> баннером-заглушкой (как это сделал бы AdSense) */
const GOOGLE_JS=`(function(){var q=window.adsbygoogle=window.adsbygoogle||[];window.__adsLoaded=(window.__adsLoaded||0)+1;
 var fill=function(){document.querySelectorAll('ins.adsbygoogle:not([data-ad-status])').forEach(function(ins){ins.setAttribute('data-ad-status','filled');ins.innerHTML='<div style="height:90px;background:linear-gradient(90deg,#3b82f6,#9333ea);color:#fff;display:flex;align-items:center;justify-content:center;font:600 14px sans-serif;border-radius:6px">Тестовое объявление (мок)</div>';});};
 q.push=function(){setTimeout(fill,30);return 1;}; setTimeout(fill,30);})();`;
async function mock(p,seen,{block=false}={}){
  await p.setRequestInterception(true);
  p.on('request',r=>{const u=r.url();
    if(/googlesyndication|doubleclick|google\.com\/pagead/.test(u)){seen.push(u); return block?r.abort('blockedbyclient'):r.respond({status:200,headers:{'content-type':'text/javascript','access-control-allow-origin':'*'},body:GOOGLE_JS});}
    if(u.startsWith('http://127.0.0.1')) return r.continue();
    if(r.method()==='POST'&&/chat\/completions/.test(u)) return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:sse('Привет! Мок-ответ.')});
    if(r.method()==='OPTIONS') return r.respond({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({data:[{id:'gpt-oss-20b'}]})});
  });
}
async function chat(p,text){ await p.click('#input'); await p.type('#input',text); await p.click('#sendBtn'); await p.waitForFunction('!document.body.classList.contains("busy") && document.querySelectorAll("#msgsA .msg").length>=2',{timeout:15000}); await sleep(400); }
const gotoReady=async(p,url)=>{await p.goto(url,{waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"',{timeout:15000}); await sleep(500);};

(async()=>{
  const b=await launch();
  // ---------- 1. по умолчанию: пусто ----------
  { const srv=await serve(null); const url=`http://127.0.0.1:${srv.address().port}/index.html`; const ctx=await b.createBrowserContext(); const seen=[];
    const p=await open(ctx,{url:'about:blank'}); await mock(p,seen); await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('fah.consent','"no"');}catch(e){}}); /* реальный config.js: окно журнала уже отвечено */ await gotoReady(p,url);
    ok(await p.evaluate(()=>!document.getElementById('adsDialog')&&document.getElementById('adsGroup').hidden&&!document.getElementById('adBox')),'по умолчанию: нет окна рекламы, блок «Реклама» в настройках скрыт, контейнера нет');
    ok(await p.evaluate(()=>!document.querySelector('script[src*="googlesyndication"]')&&!('adsbygoogle' in window)),'по умолчанию: скрипт Google не добавлен');
    await p.evaluate(()=>{localStorage.setItem('fah.settings.adsConsent','"personal"');}); await gotoReady(p,url);
    await chat(p,'проверка'); await sleep(500);
    ok(seen.length===0,'по умолчанию: 0 запросов к googlesyndication (даже с сохранённым согласием) ('+seen.length+')');
    ok(!p.logs.some(l=>/PAGEERROR/.test(l)&&!/about:blank/.test(l)),'нет ошибок страницы: '+p.logs.join('|'));
    await ctx.close(); srv.close(); }
  // ---------- 1b. неверный формат в конфиге = выключено ----------
  { const srv=await serve(cfgWith('ca-pub-12"><script>alert(1)</script>','')); const url=`http://127.0.0.1:${srv.address().port}/index.html`; const ctx=await b.createBrowserContext(); const seen=[];
    const p=await open(ctx,{url:'about:blank'}); await mock(p,seen); await gotoReady(p,url);
    ok(await p.evaluate(()=>!document.getElementById('adsDialog')&&document.getElementById('adsGroup').hidden)&&seen.length===0,'неверный формат ID: реклама выключена, запросов нет');
    await ctx.close(); srv.close(); }
  // ---------- 2. фиктивный ID + slot ----------
  const srv=await serve(cfgWith(FAKE,SLOT)); const url=`http://127.0.0.1:${srv.address().port}/index.html`;
  for(const [tag,opts,pre] of [
    ['dark',{w:1440,h:900,scheme:'dark'}],
    ['light',{w:1440,h:900,scheme:'light',pre:()=>{try{localStorage.setItem('fah.settings',JSON.stringify({theme:'light'}));}catch(e){}}}],
    ['cyber',{w:1440,h:900,scheme:'dark',pre:()=>{try{localStorage.setItem('fah.settings',JSON.stringify({cyber:true}));}catch(e){}}}],
    ['mobile',{w:390,h:844,scheme:'dark',mobile:true}]]){
    const ctx=await b.createBrowserContext(); const seen=[]; const p=await open(ctx,{...opts,url:'about:blank'}); await mock(p,seen);
    if(opts.pre) await p.evaluateOnNewDocument(opts.pre);
    await gotoReady(p,url);
    const dlg=await p.evaluate(()=>{const d=document.getElementById('adsDialog'); if(!d) return null; const r=d.getBoundingClientRect(); return {open:d.open,text:d.textContent,btns:[...d.querySelectorAll('button')].map(x=>x.textContent).join('|'),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,focus:document.activeElement&&document.activeElement.id};});
    ok(dlg&&dlg.open&&/cookie/.test(dlg.text)&&/Google/.test(dlg.text),`[${tag}] окно согласия на рекламу показано (Google, cookies)`);
    ok(dlg&&dlg.btns==='Только неперсонализированная|Принимаю','['+tag+'] кнопки «Принимаю» / «Только неперсонализированная»');
    ok(dlg&&dlg.fits&&dlg.focus==='adsPersonal',`[${tag}] окно помещается в экран, фокус на «Принимаю»`);
    ok(seen.length===0,`[${tag}] до выбора запросов к Google нет`);
    await p.keyboard.press('Escape'); await sleep(150); ok(await p.evaluate(()=>!!document.getElementById('adsDialog')),`[${tag}] Esc не заменяет выбор`);
    if(SHOTS) await p.screenshot({path:`${SHOTS}/ads-consent-${tag}.png`});
    if(tag==='light'){ await p.click('#adsNonPersonal'); } else await p.click('#adsPersonal');
    await sleep(900);
    const st=await p.evaluate(()=>({ls:localStorage.getItem('fah.settings.adsConsent'),npa:window.adsbygoogle&&window.adsbygoogle.requestNonPersonalizedAds,sc:[...document.querySelectorAll('script[src*="googlesyndication"]')].map(s=>({src:s.src,async:s.async,co:s.crossOrigin})),loaded:window.__adsLoaded||0}));
    ok(st.ls===(tag==='light'?'"nonpersonal"':'"personal"'),`[${tag}] выбор записан в fah.settings.adsConsent (${st.ls})`);
    ok(st.sc.length===1&&st.sc[0].src===`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${FAKE}`&&st.sc[0].async&&st.sc[0].co==='anonymous',`[${tag}] скрипт: верный URL, async, crossorigin`);
    ok(tag==='light'?st.npa===1:st.npa===undefined,`[${tag}] requestNonPersonalizedAds ${tag==='light'?'= 1':'не задан'}`);
    // контейнер
    if(tag==='mobile'){ await p.click('#openSidebar'); await sleep(500); }
    await p.evaluate(()=>{const t=document.getElementById('tab-settings'); if(t) t.click();}); await sleep(300);
    const box=await p.evaluate(()=>{const b=document.getElementById('adBox'); if(!b) return null; const r=b.getBoundingClientRect(),s=document.getElementById('sidebar').getBoundingClientRect(),ci=document.getElementById('input').getBoundingClientRect(); return {filled:b.classList.contains('filled'),label:b.querySelector('.ad-label').textContent,h:r.height,inSidebar:r.left>=s.left-1&&r.right<=s.right+1&&r.bottom<=s.bottom+1,dbg:JSON.stringify([r.left,r.right,r.bottom,s.left,s.right,s.bottom,document.documentElement.scrollWidth]),overInput:!(r.right<=ci.left||r.left>=ci.right||r.bottom<=ci.top||r.top>=ci.bottom),vis:getComputedStyle(b).visibility,docW:document.documentElement.scrollWidth,vw:innerWidth};});
    ok(box&&box.filled&&box.label==='Реклама'&&box.vis==='visible'&&box.h>30,`[${tag}] контейнер «Реклама» виден после заполнения (h=${box&&Math.round(box.h)})`);
    ok(box&&box.inSidebar&&(tag==='mobile'||!box.overInput)&&box.docW<=box.vw,`[${tag}] контейнер внутри боковой панели, не перекрывает ввод (на мобильном панель — выезжающий drawer), нет горизонтального скролла `+(box&&box.dbg));
    ok(await p.evaluate(()=>{const g=document.getElementById('adsGroup'); return !g.hidden&&document.getElementById('adsConsentSel').value===(localStorage.getItem('fah.settings.adsConsent')||'').replace(/"/g,'');}),`[${tag}] в «Настройки» есть группа «Реклама» с текущим выбором`);
    if(SHOTS){ await p.screenshot({path:`${SHOTS}/ads-box-${tag}.png`}); }
    if(tag==='mobile'){ await p.evaluate(()=>document.getElementById('adsGroup').scrollIntoView()); await sleep(200); if(SHOTS) await p.screenshot({path:`${SHOTS}/ads-settings-${tag}.png`}); await p.click('#closeSidebar'); await sleep(400); }
    // перезагрузка: выбор помнится, окно не показывается, скрипт грузится сразу
    const before=seen.length; await gotoReady(p,url);
    ok(await p.evaluate(()=>!document.getElementById('adsDialog')),`[${tag}] после перезагрузки окно не показывается`);
    ok(seen.length===before+1,`[${tag}] после перезагрузки скрипт грузится сразу (сохранённый выбор)`);
    await chat(p,'чат работает'); ok(await p.evaluate(()=>document.querySelectorAll('#msgsA .msg').length)>=2,`[${tag}] чат работает`);
    ok(!p.logs.some(l=>/PAGEERROR/.test(l)&&!/about:blank/.test(l)),`[${tag}] нет ошибок страницы: `+p.logs.join('|'));
    await ctx.close();
  }
  // ---------- 3. блокировщик рекламы ----------
  { const ctx=await b.createBrowserContext(); const seen=[]; const p=await open(ctx,{url:'about:blank'}); await mock(p,seen,{block:true});
    await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('fah.settings.adsConsent','"personal"');}catch(e){}});
    await gotoReady(p,url); await sleep(500);
    ok(seen.length===1,'адблок: запрос к Google был и заблокирован');
    ok(await p.evaluate(()=>{const b=document.getElementById('adBox'); return !!b&&!b.classList.contains('filled')&&b.getBoundingClientRect().height===0;}),'адблок: пустого блока нет (контейнер схлопнут)');
    await chat(p,'при адблоке'); ok(await p.evaluate(()=>document.querySelectorAll('#msgsA .msg').length)>=2,'адблок: чат работает');
    ok(!p.logs.some(l=>/PAGEERROR/.test(l)&&!/about:blank/.test(l)),'адблок: нет JS-ошибок страницы'); await ctx.close(); }
  // ---------- 4. только client, без slot = авто-реклама ----------
  { const s2=await serve(cfgWith(FAKE,'')); const u2=`http://127.0.0.1:${s2.address().port}/index.html`; const ctx=await b.createBrowserContext(); const seen=[]; const p=await open(ctx,{url:'about:blank'}); await mock(p,seen);
    await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('fah.settings.adsConsent','"personal"');}catch(e){}}); await gotoReady(p,u2); await sleep(400);
    ok(seen.length===1&&await p.evaluate(()=>!document.getElementById('adBox')&&!document.querySelector('ins.adsbygoogle')),'без SLOT: скрипт грузится (авто-реклама), контейнера на странице нет');
    await ctx.close(); s2.close(); }
  srv.close(); await b.close(); console.log(fails?'FAILED '+fails:'ALL OK'); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
