/* Скриншоты: уведомление о согласии, вход в админку, список сессий, переписка, статистика, настройки (dark + cyber). */
const {launch,open,sleep}=require('./lib.cjs');
const {SITE_ON,BACKEND,ADMIN_PW,SHOTS}=process.env;
(async()=>{
  const b=await launch();
  for (const cyber of [false,true]) {
    const tag=cyber?'cyber':'dark';
    // сайт: уведомление
    { const ctx=await b.createBrowserContext(); const p=await open(ctx,{url:SITE_ON,w:1440,h:900,pre:cyber?`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}))`:undefined});
      await p.setRequestInterception(true); p.on('request',r=>{const u=r.url(); if(u.startsWith('http://127.0.0.1')) return r.continue(); r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:'{"data":[{"id":"gpt-oss-20b"}]}'});});
      await p.reload({waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"'); await sleep(900);
      await p.screenshot({path:`${SHOTS}/consent-notice-${tag}.png`});
      const m=await open(ctx,{url:SITE_ON,w:390,h:844,mobile:true,pre:cyber?`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}))`:undefined});
      await m.reload({waitUntil:'load'}); await sleep(1200); await m.screenshot({path:`${SHOTS}/consent-notice-390-${tag}.png`});
      await ctx.close(); }
    // админка
    const ctx=await b.createBrowserContext(); const p=await ctx.newPage(); await p.setViewport({width:1440,height:900});
    const logs=[]; p.on('console',m=>{if(['error','warning'].includes(m.type())) logs.push(m.text());}); p.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
    await p.evaluateOnNewDocument(`try{localStorage.setItem('fah.admin.theme','${cyber?'cyber':'dark'}')}catch(e){}`);
    await p.goto(BACKEND+'/admin',{waitUntil:'load'}); await sleep(800);
    await p.screenshot({path:`${SHOTS}/admin-login-${tag}.png`});
    await p.type('#pw','wrong-password'); await p.click('#loginForm button'); await sleep(900);
    await p.screenshot({path:`${SHOTS}/admin-login-error-${tag}.png`});
    await p.evaluate(()=>{document.getElementById('pw').value='';}); await p.type('#pw',ADMIN_PW); await p.click('#loginForm button'); await sleep(1500);
    await p.screenshot({path:`${SHOTS}/admin-sessions-${tag}.png`});
    await p.click('.slist li:nth-child(2) button'); await sleep(700);
    await p.screenshot({path:`${SHOTS}/admin-conversation-${tag}.png`});
    // поиск
    await p.type('#fQ','SQL'); await p.click('#filters button[type=submit]'); await sleep(700);
    await p.click('.slist li button'); await sleep(600);
    await p.screenshot({path:`${SHOTS}/admin-search-${tag}.png`});
    await p.click('#tab-stats'); await sleep(900); await p.screenshot({path:`${SHOTS}/admin-stats-${tag}.png`});
    await p.click('#tab-settings'); await sleep(600); await p.screenshot({path:`${SHOTS}/admin-settings-${tag}.png`});
    // мобильная
    const m=await ctx.newPage(); await m.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true}); await m.goto(BACKEND+'/admin',{waitUntil:'load'}); await sleep(900);
    await m.screenshot({path:`${SHOTS}/admin-sessions-390-${tag}.png`});
    console.log(tag,'logs:',logs.join(' | ')||'none'); await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
