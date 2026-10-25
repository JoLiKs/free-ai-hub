const {launch,open,sleep}=require('./lib.cjs');
const PH=(process.env.PH||'умеешь рисовать?|а картинки умеешь делать?').split('|');
(async()=>{const b=await launch();
for(let run=0;run<(+process.env.RUNS||2);run++){
 const p=await open(b,{url:'https://aihubai.site/',pre:new Function(`localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))`)});
 p.on('response',async r=>{const u=r.url();if(r.request().method()==='POST'&&!/telemetry|\/api\/log/.test(u)){let t='';try{t=await r.text()}catch(e){t='ERR '+e.message}const req=r.request().postData()||'';let sys='';try{const j=JSON.parse(req);sys=(j.messages||[]).filter(m=>m.role==='system').map(m=>m.content).join('').slice(0,60)}catch{}const c=(t.match(/"content":"((?:[^"\\]|\\.)*)"/g)||[]).map(x=>x.slice(11,-1)).join('');console.log('  NET',r.status(),u.slice(0,70),'| sys:',sys,'| out:',(c||t).slice(0,200));}});
 await sleep(1000);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
 for(let n=1;n<=PH.length;n++){await p.click('#input');await p.type('#input',PH[n-1]);await p.click('#sendBtn');
  let s={timeout:true};for(let i=0;i<90;i++){await sleep(1000);const r=await p.evaluate(n=>{const ms=[...document.querySelectorAll('.msg.assistant')];if(ms.length<n)return null;const m=ms[n-1];return{name:m.querySelector('.name').textContent,img:!!m.querySelector('.gen-img'),busy:!!document.querySelector('.typing,.bubble.cursor,.status:not([hidden])'),text:m.querySelector('.bubble').innerText.replace(/\s+/g,' ').slice(0,140),meta:(m.querySelector('.meta,.stats,footer')||{}).textContent||''}},n);if(r&&(r.img||!r.busy)){s=r;if(r.img||r.text||i>20)break;}}
  console.log(run,JSON.stringify([PH[n-1],s]));}
 await p.close();}
await b.close()})();
