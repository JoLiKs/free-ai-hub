const {launch,open,sleep}=require('./lib.cjs'); const fs=require('fs');
const axe=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
(async()=>{const b=await launch();
 for(const scheme of ['dark','light']){
  const ctx=await b.createBrowserContext(); const p=await open(ctx,{scheme});
  await p.setRequestInterception(true);
  p.on('request',r=>{ if(r.method()==='POST'&&/chat\/completions/.test(r.url())) return r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:'data: {"choices":[{"delta":{"content":"## Тест\\n\\n| a | b |\\n|--|--|\\n| 1 | 2 |\\n\\n```js\\nconst x=1;\\n```"}}]}\n\ndata: [DONE]\n\n'}); r.continue(); });
  await p.type('#input','привет'); await p.click('#sendBtn'); await sleep(1500);
  for(const tab of ['chats','model','settings']){ await p.click('#tab-'+tab); await sleep(200);
   await p.evaluate(axe); const res=await p.evaluate(()=>axe.run(document,{resultTypes:['violations']}));
   console.log(scheme,tab,'violations:',res.violations.length);
   for(const v of res.violations) console.log('  -',v.id,v.impact,v.nodes.length,'|',v.help,'|',v.nodes.slice(0,3).map(n=>n.target.join(' ')).join(' ; '));
  }
  await ctx.close();
 }
 await b.close();})();
