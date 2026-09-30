const {launch,open,sleep}=require('./lib.cjs');
(async()=>{const b=await launch(); const p=await open(await b.createBrowserContext(),{w:+process.argv[2]||1440,h:+process.argv[3]||900,mobile:(+process.argv[2]||1440)<600});
 await p.setRequestInterception(true);
 p.on('request',async r=>{ const u=r.url(); if(r.method()==='POST'&&/chat\/completions/.test(u)){ const k=Math.random(); if(k<.15) return r.respond({status:429,headers:{'access-control-allow-origin':'*','retry-after':'1'},body:'{}'}); if(k<.25) return r.respond({status:500,headers:{'access-control-allow-origin':'*'},body:'{"error":"x"}'}); await new Promise(x=>setTimeout(x,Math.random()*800)); try{r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:'data: {"choices":[{"delta":{"reasoning_content":"думаю"}}]}\n\ndata: {"choices":[{"delta":{"content":"## Ответ\\n\\n- пункт **жирный**\\n\\n```js\\nlet a=1\\n```\\n\\n| a | b |\\n|--|--|\\n| 1 | 2 |"}}]}\n\ndata: [DONE]\n\n'});}catch{} } else if(/oai.endpoints|ch.at|llm7|pollinations|aihorde/.test(u)&&r.method()==='GET'){ r.abort(); } else r.continue(); });
 const sels=['button','a[href]','summary','select','input[type=checkbox]','[role=tab]','[role=option]','.card-btn','[data-act]','.chip','.star'];
 let n=0; const t0=Date.now();
 while(Date.now()-t0<(+process.argv[4]||90)*1000){
  const r=Math.random();
  try{
   if(r<.15){ await p.keyboard.type(['привет','## x','```\n','a'.repeat(50),'\n'][Math.floor(Math.random()*5)]); }
   else if(r<.25){ await p.keyboard.press(['Enter','Escape','Tab','ArrowUp','ArrowDown','/'][Math.floor(Math.random()*6)]); }
   else if(r<.3){ await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); }
   else { const els=await p.$$(sels.join(',')); const vis=[]; for(const e of els.sort(()=>Math.random()-.5).slice(0,12)){ if(await e.isVisible?.() ?? true){vis.push(e);} } const t=vis[Math.floor(Math.random()*vis.length)]; if(t){ const id=await t.evaluate(e=>e.id||''); if(/deleteAll|clearCache|resetBtn/.test(id)&&Math.random()<.7) continue; await t.click({delay:0}).catch(()=>{}); } }
  }catch(e){}
  n++; await sleep(40);
  // auto-confirm dialogs
  await p.evaluate(()=>{const ok=document.querySelector('dialog[open] .btn.primary, .modal .btn.primary, [role=dialog] .btn.danger'); if(ok&&Math.random()<.5) ok.click();}).catch(()=>{});
 }
 const st=await p.evaluate(()=>({ready:document.documentElement.dataset.ready, msgs:document.querySelectorAll('.msg').length, sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth}));
 console.log('actions',n,st); console.log([...new Set(p.logs.filter(l=>!/Failed to load resource|CORS|net::ERR/.test(l)))].slice(0,10)); await b.close();})();
