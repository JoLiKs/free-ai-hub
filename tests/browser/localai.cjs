// Проверка режима «В браузере»: прогресс загрузки + потоковый ответ. MODEL=..., OUT=/workspace/localai
const {launch,open,sleep}=require('./lib.cjs');
const MODEL=process.env.MODEL||'HuggingFaceTB/SmolLM2-135M-Instruct', OUT=process.env.OUT||'/workspace/localai';
(async()=>{const b=await launch(process.env.NOGPU?['--disable-gpu']:[]);
const pre=`localStorage.setItem('fah.settings',JSON.stringify({provider:'local',models:{local:${JSON.stringify(MODEL)}},localOk:{${JSON.stringify(MODEL)}:true},autoFallback:false,maxTokens:${+(process.env.MAXT||60)}}));`+(process.env.PRE||'')+`;window.__wl=[];const W0=window.Worker;window.Worker=function(u,o){const w=new W0(u,o);const t0=Date.now();w.addEventListener('message',e=>{const d=e.data||{};if(d.type!=='token'&&d.type!=='progress'||d.stage&&d.stage!=='download')window.__wl.push(((Date.now()-t0)/1000|0)+'s '+d.type+' '+(d.stage||d.message||''))});w.addEventListener('error',e=>window.__wl.push('ERR '+e.message));return w};`;
const p=await open(b,{pre:new Function(pre)});
await sleep(800); if(await p.$('#consentNo')) { await p.click('#consentNo').catch(()=>{}); await sleep(400); } await p.click('#input'); await p.type('#input','Привет! Ответь одним предложением.'); await sleep(200); await p.click('#sendBtn'); await sleep(800); await p.evaluate(()=>{const d=document.querySelector('dialog[open]');if(d){const bs=[...d.querySelectorAll('button')];(bs.find(x=>/primary|ok/.test(x.className))||bs.pop()).click();}});
p.on('error',e=>console.log('PAGECRASH',e.message));let shot=0;const t0=Date.now();
for(;;){await sleep(1500);const s=await p.evaluate(()=>{const m=[...document.querySelectorAll('.msg.assistant')].pop();if(!m)return null;const st=m.querySelector('.status');return{st:st&&!st.hidden?st.innerText:'',bub:m.querySelector('.bubble').innerText.slice(-60),len:m.querySelector('.bubble').textContent.length,err:!!m.querySelector('.bubble.err'),busy:!!document.querySelector('.msg.assistant .typing,.bubble.cursor')}});
 console.log(((Date.now()-t0)/1000|0)+'s',JSON.stringify(s));
 if(s&&s.st&&/%/.test(s.st)&&!shot){shot=1;await p.screenshot({path:OUT+'-loading.png'});}
 if(s&&(s.err||(!s.busy&&s.bub.trim()&&!s.st))){await p.screenshot({path:OUT+(s.err?'-error.png':'-answer.png')});break;}
 if(Date.now()-t0>+(process.env.TMAX||300000)){await p.screenshot({path:OUT+'-timeout.png'});break;}}
console.log('WL',await p.evaluate(()=>window.__wl.join(' | ')+' STOP:'+document.getElementById('stopBtn').hidden+' BUB:'+[...document.querySelectorAll('.bubble')].map(b=>b.className+'/'+(b.querySelector('.typing')?'T':'')).join(',')+' ACTS:'+[...document.querySelectorAll('.msg.assistant .act')].map(a=>a.dataset.act)).catch(e=>e.message));console.log(p.logs.join('\n'));await b.close()})();
