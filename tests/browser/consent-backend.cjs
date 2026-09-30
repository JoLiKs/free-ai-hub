/* Согласие + журнал на бэкенде: BACKEND_URL пуст / задан; отказ; согласие; секреты не уходят; удаление своих данных.
 * env: SITE_ON=http://127.0.0.1:P1/index.html  SITE_OFF=http://127.0.0.1:P2/index.html  BACKEND=http://127.0.0.1:P3  ADMIN_PW=...  SHOTS=dir */
const {launch,open,sleep}=require('./lib.cjs');
const {SITE_ON,SITE_OFF,BACKEND,ADMIN_PW,SHOTS}=process.env;
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
const sse=t=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\ndata: [DONE]\n\n';

async function adminApi(){ // логин через fetch, кука в заголовке
  const r=await fetch(BACKEND+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:ADMIN_PW})});
  const cookie=r.headers.get('set-cookie').split(';')[0]; const csrf=(await r.json()).csrf;
  return {get:async p=>(await fetch(BACKEND+'/api/admin'+p,{headers:{cookie}})).json(), csrf, cookie};
}
let BACKEND_DOWN=false;
async function mockNet(p, seen){ // моки моделей; запросы к бэкенду — пропускаем и логируем
  await p.setRequestInterception(true);
  p.on('request',r=>{
    const u=r.url();
    if(u.startsWith(BACKEND)&&BACKEND_DOWN) return r.abort('failed');
    if(u.startsWith(BACKEND)) { seen.push({url:u,method:r.method(),body:r.postData()||''}); return r.continue(); }
    if(u.startsWith('http://127.0.0.1')) return r.continue();
    if(r.method()==='POST'&&/chat\/completions/.test(u)) return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:sse('Привет! Это **мок-ответ** модели. `код`')});
    if(r.method()==='OPTIONS') return r.respond({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
    return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({data:[{id:'gpt-oss-20b'}]})});
  });
}
async function chat(p,text){ await p.click('#input'); await p.type('#input',text); await p.click('#sendBtn'); await p.waitForFunction('!document.body.classList.contains("busy") && document.querySelectorAll("#msgsA .msg.assistant, #msgsA .msg").length>=2',{timeout:15000}); await sleep(600); }

(async()=>{
  const b=await launch();
  // ---------- 1. BACKEND_URL пуст ----------
  { const ctx=await b.createBrowserContext(); const seen=[]; const p=await open(ctx,{url:SITE_OFF}); await mockNet(p,seen);
    ok(await p.evaluate(()=>!document.querySelector('dialog#consentDialog')),'BACKEND_URL пуст: уведомление НЕ показано');
    ok(await p.evaluate(()=>document.getElementById('logChip').hidden && document.getElementById('logGroup').hidden),'BACKEND_URL пуст: чип и блок настроек скрыты');
    await chat(p,'проверка без бэкенда');
    ok(await p.evaluate(()=>document.querySelectorAll('#msgsA .msg').length)>=2,'чат работает без бэкенда');
    ok(seen.length===0,'ничего не отправляется на сервер ('+seen.length+')');
    ok(!p.logs.some(l=>/PAGEERROR/.test(l)),'нет ошибок страницы: '+p.logs.join('|'));
    await ctx.close(); }
  // ---------- 2. BACKEND_URL задан ----------
  const adm=await adminApi(); const before=(await adm.get('/sessions?limit=1')).total;
  const ctx=await b.createBrowserContext(); const seen=[]; const p=await open(ctx,{url:SITE_ON}); await mockNet(p,seen);
  await p.reload({waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"'); await sleep(500);
  ok(await p.evaluate(()=>{const d=document.getElementById('consentDialog'); return !!d&&d.open&&d.textContent.includes('Сообщения в этом чате сохраняются на сервере владельца сайта для улучшения сервиса и могут быть прочитаны им. Не отправляйте пароли, персональные и другие чувствительные данные.');}),'первый визит: модальное уведомление с точным текстом');
  ok(await p.evaluate(()=>[...document.querySelectorAll('#consentDialog button')].map(b=>b.textContent).join('|'))==='Не сохранять|Принимаю','кнопки «Принимаю» и «Не сохранять»');
  ok(await p.evaluate(()=>document.activeElement&&document.activeElement.id==='consentYes'),'фокус на диалоге (a11y)');
  await p.keyboard.press('Escape'); await sleep(200);
  ok(await p.evaluate(()=>!!document.getElementById('consentDialog')),'Esc не закрывает диалог (нужен явный выбор)');
  ok(seen.length===0,'до выбора ничего не отправлено');
  if(SHOTS) await p.screenshot({path:SHOTS+'/consent-dialog-'+(process.env.TAG||'dark')+'.png'});
  await p.click('#consentNo'); await sleep(400);
  ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('fah.consent'))==='no'),'выбор «Не сохранять» запомнен в localStorage');
  await chat(p,'секретный вопрос при отказе');
  ok(await p.evaluate(()=>document.querySelectorAll('#msgsA .msg').length)>=2,'после отказа чат работает так же');
  ok(seen.filter(x=>x.method!=='OPTIONS').length===0,'отказ: НИЧЕГО не уходит на сервер');
  // reload → диалог не показывается
  await p.reload({waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"'); await sleep(400);
  ok(await p.evaluate(()=>!document.getElementById('consentDialog')),'повторный визит: уведомление не показывается');
  // включаем в настройках
  await p.evaluate(()=>document.getElementById('tab-settings').click()); await sleep(200);
  ok(await p.evaluate(()=>!document.getElementById('logGroup').hidden && !document.getElementById('consentToggle').checked),'в «Настройки» есть переключатель (выключен)');
  // секреты: ключ, свой URL, системный промпт
  await p.evaluate(()=>{const s=document.getElementById('systemPrompt'); s.value='SYSPROMPT-SECRET-XYZ'; s.dispatchEvent(new Event('input'));});
  await p.evaluate(()=>{window.__fah.state.keys.ovh='sk-SUPERSECRETKEY-987654321'; window.__fah.state.settings.customUrl='https://private.example/v1';});
  await p.click('label.switch:has(#consentToggle)'); await sleep(300);
  ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('fah.consent'))==='yes'),'переключатель → согласие сохранено');
  await chat(p,'Привет, это тест журнала. мой ключ sk-SUPERSECRETKEY-987654321');
  await sleep(800);
  const posts=seen.filter(x=>x.method==='POST'&&x.url.endsWith('/api/log'));
  ok(posts.length===1,'после согласия отправлено событие /api/log ('+posts.length+')');
  if(posts[0]){ const body=posts[0].body;
    ok(!body.includes('SYSPROMPT-SECRET')&&!body.includes('private.example')&&!body.includes('SUPERSECRETKEY'),'ключ / свой URL / системный промпт НЕ в теле запроса');
    const j=JSON.parse(body); ok(j.user_text.includes('[ключ скрыт]')&&j.assistant_text.includes('мок-ответ')&&j.provider&&j.model,'в теле: текст вопроса (ключ скрыт), ответ, провайдер, модель'); }
  const after=await adm.get('/sessions?limit=5&q='+encodeURIComponent('тест журнала')); ok(after.total===1,'бэкенд сохранил сессию (найдена поиском)');
  // удаление своих данных
  await p.evaluate(()=>{document.getElementById('deleteMyDataBtn').scrollIntoView();}); 
  if(SHOTS) { await p.screenshot({path:SHOTS+'/site-settings-consent-'+(process.env.TAG||'dark')+'.png'}); }
  await p.click('#deleteMyDataBtn'); await sleep(300);
  await p.click('dialog.dialog:not(#consentDialog) button[value=ok]'); await sleep(700);
  const toastOk=await p.evaluate(()=>[...document.querySelectorAll('.toast')].some(x=>/Удалено сообщений/.test(x.textContent)));
  const gone=await adm.get('/sessions?limit=5&q='+encodeURIComponent('тест журнала')); ok(gone.total===0,'«Удалить мои данные с сервера» удалило сессию на бэкенде');
  ok(toastOk,'показан toast об удалении');
  // выключаем обратно → снова ничего не уходит
  const n0=seen.filter(x=>x.method==='POST').length;
  await p.click('label.switch:has(#consentToggle)'); await sleep(200); await chat(p,'после отключения');
  ok(seen.filter(x=>x.method==='POST').length===n0,'после выключения переключателя события не отправляются');
  // недоступный бэкенд не ломает чат
  await p.click('label.switch:has(#consentToggle)'); await sleep(200);
  BACKEND_DOWN=true;
  const n1=await p.evaluate(()=>document.querySelectorAll('#msgsA .msg').length); await chat(p,'бэкенд лежит'); ok(await p.evaluate(n=>document.querySelectorAll('#msgsA .msg').length>=n+2&&!document.querySelector('#msgsA .msg.error'),n1),'бэкенд недоступен: чат работает, ошибок нет');
  ok(!p.logs.some(l=>/PAGEERROR/.test(l)),'нет ошибок страницы');
  await ctx.close(); await b.close(); console.log(fails?'FAILED '+fails:'ALL OK'); process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
