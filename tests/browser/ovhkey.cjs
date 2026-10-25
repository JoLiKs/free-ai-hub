// Посетитель с просроченным OVH-ключом в localStorage: баннера нет, ключ не уходит в OVH, чат с Mistral работает.
const {launch,open,sleep}=require('./lib.cjs');
(async()=>{const b=await launch();const p=await open(b,{url:'https://aihubai.site/',pre:()=>{localStorage.setItem('fah.keys',JSON.stringify({ovh:'expired-ovh-token-123'}));localStorage.setItem('fah.settings',JSON.stringify({provider:'ovh',model:'Mistral-Small-3.2-24B-Instruct-2506'}));}});
const auth=[];p.on('request',r=>{if(r.url().includes('kepler.ai.cloud.ovh.net'))auth.push(r.method()+' '+r.url().split('/v1')[1]+' auth='+(r.headers()['authorization']?'YES':'no'));});
await p.reload({waitUntil:'networkidle2'});await sleep(2500);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
const banner=await p.evaluate(()=>{const e=document.querySelector('#banner,.banner');return e&&!e.hidden&&e.offsetParent?e.innerText:'';});
await p.click('#input');await p.type('#input','Ответь одним словом: столица Франции?');await p.click('#sendBtn');
let t='';for(let i=0;i<60;i++){await sleep(1000);t=await p.evaluate(()=>{const m=[...document.querySelectorAll('.msg.assistant .bubble, .bubble')].pop();return m?m.innerText:''});if(/париж/i.test(t))break;}
const cur=await p.evaluate(()=>document.querySelector('.cur-model,#curModel')?.innerText||'');
console.log(JSON.stringify({banner,cur,answer:t.slice(0,80)}));console.log(auth.join('\n'));
await p.screenshot({path:'/workspace/ovhkey-fix.png'});await b.close()})();
