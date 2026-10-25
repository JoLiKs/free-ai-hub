const {launch,sleep}=require('./lib.cjs');
(async()=>{const b=await launch();const p=await b.newPage();await p.goto(process.env.U||'https://aihubai.site/',{waitUntil:'domcontentloaded'});
const r=await p.evaluate(async()=>{const L=await import('/js/local.js');const ev=[];const t0=Date.now();
 try{const r=await Promise.race([L.generateLocal('HuggingFaceTB/SmolLM2-135M-Instruct',[{role:'user',content:'Привет! Ответь одним предложением.'}],{maxTokens:40,temp:0.7,onDelta:t=>ev.push(((Date.now()-t0)/1000|0)+'s tok:'+JSON.stringify(t)),onProgress:m=>{if(m.stage!=='download')ev.push(m.stage)}}),new Promise((_,j)=>setTimeout(()=>j(new Error('TIMEOUT')),150000))]);ev.push('RES len '+r.content.length)}catch(e){ev.push('ERR:'+e.message)}return ev.slice(-30)});
console.log(r.join('\n'));await b.close()})();
