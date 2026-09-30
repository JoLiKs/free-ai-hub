const {launch,open,sleep}=require('./lib.cjs'); const fs=require('fs');
const axe=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const URL=process.env.APP_URL||'http://127.0.0.1:8138/index.html';
const MD='## Тест\n\n- a `code`\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n```js\nconst x=1;\n```';
(async()=>{const b=await launch();
 const rel=async(p)=>{await p.setRequestInterception(true);p.on('request',r=>{const u=r.url(); if(r.method()==='POST'&&/chat\/completions/.test(u)) return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:'data: {"choices":[{"delta":{"content":'+JSON.stringify(MD)+'}}]}\n\ndata: [DONE]\n\n'}); if(r.method()==='GET'&&!u.includes('127.0.0.1')) return r.abort(); r.continue();});};
 // 1. toggle + persistence + return to previous theme
 for (const [pref,scheme] of [['light','dark'],['auto','light'],['dark','light'],['auto','dark']]) {
  const ctx=await b.createBrowserContext();
  const p=await open(ctx,{scheme,pre:`if(!localStorage.getItem('fah.settings'))localStorage.setItem('fah.settings',JSON.stringify({theme:'${pref}'}))`});
  const st=()=>p.evaluate(()=>({theme:document.documentElement.dataset.theme,cyber:document.documentElement.classList.contains('cyber'),pressed:document.getElementById('cyberBtn').getAttribute('aria-pressed'),ls:JSON.parse(localStorage.getItem('fah.settings')).cyber,bg:getComputedStyle(document.body).backgroundColor}));
  const s0=await st(); await p.focus('#cyberBtn'); await p.keyboard.press('Enter'); await sleep(300); const s1=await st();
  await p.reload({waitUntil:'load'}); await p.waitForFunction('document.documentElement.dataset.ready==="1"'); const s2=await st();
  await p.focus('#cyberBtn'); await p.keyboard.press('Space'); await sleep(300); const s3=await st();
  console.log(pref,scheme,'\n off:',JSON.stringify(s0),'\n on(Enter):',JSON.stringify(s1),'\n reload:',JSON.stringify(s2),'\n off(Space):',JSON.stringify(s3), p.logs.filter(l=>!/ERR_FAILED/.test(l)));
  await ctx.close();
 }
 // 2. no flash: html class present before first paint (sampled at DOMContentLoaded and via head script)
 { const ctx=await b.createBrowserContext(); const p=await ctx.newPage(); await p.evaluateOnNewDocument(`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}));window.__early=[];new MutationObserver(()=>{}).observe(document,{childList:true,subtree:true});document.addEventListener('readystatechange',()=>window.__early.push(document.readyState+':'+document.documentElement.classList.contains('cyber')));`);
   await p.goto(URL,{waitUntil:'load'}); console.log('early class states:',await p.evaluate(()=>window.__early.join(','))); 
   console.log('inline script before stylesheet:',await p.evaluate(()=>{const s=[...document.head.children];return s.findIndex(e=>e.tagName==='SCRIPT'&&!e.src)<s.findIndex(e=>e.tagName==='LINK'&&e.rel==='stylesheet')})); await ctx.close(); }
 // 3. axe + contrast in cyber, all tabs, popover open, compare
 { const ctx=await b.createBrowserContext(); const p=await open(ctx,{pre:`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}))`}); await rel(p);
  await p.type('#input','привет'); await p.click('#sendBtn'); await sleep(1500);
  const run=async(label)=>{await p.evaluate(axe); const res=await p.evaluate(()=>axe.run(document,{resultTypes:['violations']})); console.log('axe cyber',label,'violations:',res.violations.length); for(const v of res.violations) console.log('  -',v.id,v.impact,v.nodes.length,'|',v.help,'|',v.nodes.slice(0,4).map(n=>n.target.join(' ')+' '+(n.any[0]&&n.any[0].message||'').slice(0,110)).join(' ;; '));};
  for(const tab of ['chats','model','settings']){await p.click('#tab-'+tab); await sleep(250); await run(tab);}
  await p.click('#curLabel'); await sleep(500); await run('popover'); await p.keyboard.press('Escape'); await sleep(200);
  await p.click('#tab-model'); await p.click('#compareToggle+.sw'); await sleep(800); await run('compare'); await ctx.close(); }
 // 4. reduced motion
 { const ctx=await b.createBrowserContext(); const p=await open(ctx,{pre:`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}))`}); await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const r=await p.evaluate(()=>{const n=document.getAnimations().filter(a=>a.playState==='running'&&a.effect&&getComputedStyle(a.effect.target).animationDuration).map(a=>a.animationName||a.constructor.name).filter(n=>n); return {running:[...new Set(n)], gridAnim:getComputedStyle(document.body,'::before').animationName, h1:getComputedStyle(document.querySelector('.brand h1'),'::before').display};}); console.log('reduced-motion:',JSON.stringify(r)); await ctx.close(); }
 // 5. animations present normally
 { const ctx=await b.createBrowserContext(); const p=await open(ctx,{pre:`localStorage.setItem('fah.settings',JSON.stringify({cyber:true}))`});
  console.log('normal anims:',await p.evaluate(()=>[...new Set(document.getAnimations().filter(a=>a.playState==='running').map(a=>a.animationName))].join(',')));
  // non-cyber: nothing of cyber applies
  await ctx.close(); }
 await b.close();})();
