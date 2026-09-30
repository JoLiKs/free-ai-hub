const {launch,open,sleep}=require('./lib.cjs');
(async()=>{
 const b=await launch(); const p=await open(await b.createBrowserContext(),{});
 await p.setRequestInterception(true); let n=0;
 p.on('request',r=>{ if(r.method()==='POST'&&/chat\/completions/.test(r.url())){ n++; const fin=n===1?'length':'stop'; const body='data: '+JSON.stringify({choices:[{delta:{content:n===1?'Начало ответа':'…и продолжение'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:fin}]})+'\n\ndata: [DONE]\n\n'; r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body}); } else r.continue();});
 await p.type('#input','привет'); await p.click('#sendBtn'); await sleep(1500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('.msg.assistant .act')].map(e=>e.textContent), ));
 await p.click('.msg.assistant [data-act=cont]'); await sleep(1500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('.msg')].map(e=>e.className+': '+e.textContent.slice(0,80))), p.logs.filter(l=>!/CORS|Failed/.test(l)));
 await b.close();
})();
