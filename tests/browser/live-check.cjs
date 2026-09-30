/* Проверка опубликованного сайта (без отправки сообщений): чипа нет, окно согласия работает, нет ошибок в консоли, реклама выключена.
 * env: LIVE_URL, SHOTS (скрины live-header-*.png при заданном SHOT_TAG) */
const {launch,open,sleep}=require('./lib.cjs');
const URL_=process.env.LIVE_URL, SHOTS=process.env.SHOTS;
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
(async()=>{
  const b=await launch();
  for(const [tag,pre] of [['dark',null],['cyber',()=>{try{localStorage.setItem('fah.settings',JSON.stringify({cyber:true}));}catch(e){}}]]){
    const ctx=await b.createBrowserContext(); const p=await open(ctx,{url:'about:blank',w:1440,h:900}); const bad=[]; const googleReq=[]; p.logs.length=0; /* сброс: 'NOT READY' относится к about:blank в lib.open */
    p.on('request',r=>{if(/googlesyndication|doubleclick|adsbygoogle/.test(r.url())) googleReq.push(r.url());});
    p.on('response',r=>{if(r.status()>=400&&r.url().startsWith(URL_)) bad.push(r.status()+' '+r.url());});
    if(pre) await p.evaluateOnNewDocument(pre);
    await p.goto(URL_+'/index.html?cb='+Date.now(),{waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"',{timeout:20000}).catch(()=>ok(false,'приложение не готово')); await sleep(1200);
    ok(await p.evaluate(()=>!document.getElementById('logChip')&&!document.querySelector('.log-chip')&&!/на сервере|○ локально/.test(document.querySelector('.topbar').innerText)),`[${tag}] чипа в шапке нет`);
    ok(await p.evaluate(()=>{const d=document.getElementById('consentDialog'); return !!d&&d.open&&[...d.querySelectorAll('button')].map(x=>x.textContent).join('|')==='Не сохранять|Принимаю';}),`[${tag}] окно согласия показано (Не сохранять | Принимаю)`);
    ok(await p.evaluate(()=>document.getElementById('adsGroup').hidden&&!document.getElementById('adsDialog')&&!document.getElementById('adBox')),`[${tag}] реклама выключена (нет окна/блока)`);
    ok(googleReq.length===0,`[${tag}] запросов к googlesyndication нет`);
    ok(!p.logs.some(l=>/error|PAGEERROR|NOT READY/i.test(l)),`[${tag}] ошибок консоли нет `+JSON.stringify(p.logs)); ok(bad.length===0,`[${tag}] нет 4xx/5xx для файлов сайта `+bad.join(','));
    // выбор «Не сохранять» (на сервер ничего не уходит) → диалог закрывается, переключатель в настройках есть
    await p.click('#consentNo'); await sleep(500);
    ok(await p.evaluate(()=>!document.getElementById('consentDialog')&&JSON.parse(localStorage.getItem('fah.consent'))==='no'),`[${tag}] «Не сохранять» закрывает окно и запоминается`);
    await p.evaluate(()=>document.getElementById('tab-settings').click()); await sleep(300);
    ok(await p.evaluate(()=>!document.getElementById('logGroup').hidden&&!!document.getElementById('consentToggle')&&!!document.getElementById('deleteMyDataBtn')),`[${tag}] в «Настройки» есть переключатель и «Удалить мои данные с сервера»`);
    if(SHOTS){ await p.screenshot({path:`${SHOTS}/live-header-${tag}.png`,clip:{x:0,y:0,width:1440,height:260}}); await p.screenshot({path:`${SHOTS}/live-full-${tag}.png`}); }
    await ctx.close();
  }
  await b.close(); console.log(fails?'FAILED '+fails:'ALL OK'); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
