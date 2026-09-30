/* XSS в админке: вредоносный текст пользователя/ответа/названий провайдера → выводится как текст, скрипты не исполняются.
 * env: BACKEND, ADMIN_PW */
const {launch,sleep}=require('./lib.cjs'); const {BACKEND,ADMIN_PW}=process.env; let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
const uuid=()=>crypto.randomUUID();
(async()=>{
  const evil=`<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script><svg onload="window.__pwn=3"> "'><b>bold</b> javascript:alert(4)`;
  const sid=uuid();
  const r=await fetch(BACKEND+'/api/log',{method:'POST',headers:{'content-type':'text/plain','origin':'http://127.0.0.1:1'},body:JSON.stringify({session_id:sid,chat_id:'xss',provider:'ovh',model:'m',user_text:evil,assistant_text:evil,lang:'ru'})});
  ok(r.status===200,'вредоносное событие принято как данные ('+r.status+')');
  const b=await launch(); const p=await b.newPage(); await p.setViewport({width:1440,height:900}); const logs=[]; p.on('pageerror',e=>logs.push(e.message)); p.on('dialog',d=>{logs.push('DIALOG '+d.message()); d.dismiss();});
  await p.goto(BACKEND+'/admin'); await p.type('#pw',ADMIN_PW); await p.click('#loginForm button'); await sleep(1200);
  await p.type('#fQ','bold'); await p.click('#filters button[type=submit]'); await sleep(800);
  await p.click('.slist li button'); await sleep(800);
  const res=await p.evaluate(()=>({pwn:window.__pwn, imgs:document.querySelectorAll('#msgs .body img,#msgs .body script,#msgs .body svg,#msgs .body b').length, text:document.querySelector('#msgs .msg .body').textContent.includes('<img src=x onerror='), marks:document.querySelectorAll('#msgs mark').length, prev:document.querySelector('.s-prev').textContent.includes('<img')}));
  ok(res.pwn===undefined,'window.__pwn не задан (скрипты не исполнены)'); ok(res.imgs===0,'в переписке нет элементов img/script/svg/b'); ok(res.text,'разметка показана как обычный текст'); ok(res.prev,'превью в списке — текст'); ok(res.marks>=1,'подсветка совпадений работает через <mark> ('+res.marks+')');
  // CSP: попытка inline-скрипта блокируется
  const csp=await p.evaluate(()=>{try{const s=document.createElement('script');s.textContent='window.__csp=1';document.head.append(s);}catch(e){} return window.__csp;}); ok(csp===undefined,'CSP блокирует inline-скрипт');
  // очистка
  await p.click('#convDel'); await sleep(300); await p.click('#dlgOk'); await sleep(700);
  ok(logs.length===0,'нет ошибок/диалогов: '+logs.join('|'));
  await b.close(); console.log(fails?'FAILED':'ALL OK'); process.exit(fails?1:0);
})();
