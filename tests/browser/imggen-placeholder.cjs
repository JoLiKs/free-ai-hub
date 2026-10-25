// Симуляция «жёлтой заглушки» Pollinations: перехватываем запросы картинок.
// MODE=retry — 2 заглушки, затем настоящая; MODE=fail — всегда заглушка → ошибка с кнопкой, затем кнопка → настоящая.
const fs=require('fs');const {launch,open,sleep}=require('./lib.cjs');
const MODE=process.env.MODE||'retry',OUT=process.env.OUT||'/workspace/imggen-fix3';const Y=fs.readFileSync('/tmp/yellow.jpg');
(async()=>{const b=await launch();const p=await open(b,{url:process.env.APP_URL||'https://aihubai.site/',pre:()=>localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))});
let n=0,allow=false;const seen=[];await p.setRequestInterception(true);
p.on('request',r=>{const u=r.url();if(!u.startsWith('https://image.pollinations.ai/prompt/'))return r.continue();n++;seen.push(u.match(/seed=(\d+)/)?.[1]);
 if(allow||(MODE==='retry'&&n>2))return r.continue();r.respond({status:200,contentType:'image/jpeg',headers:{'access-control-allow-origin':'*'},body:Y});});
await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
await p.click('#input');await p.type('#input','картинка крысы');await p.click('#sendBtn');
const st=()=>p.evaluate(()=>{const f=document.querySelector('.gen-img');if(!f)return null;const i=f.querySelector('img');return{cls:f.className,ph:(f.querySelector('.gen-ph')||{}).innerText||'',btn:!!f.querySelector('.gen-retry'),loaded:!!(i&&i.complete&&i.naturalWidth&&!f.classList.contains('loading')&&!f.classList.contains('err'))}});
let shot=0;for(let i=0;i<110;i++){await sleep(1000);const s=await st();if(s&&/занят/.test(s.ph)&&!shot){shot=1;await p.screenshot({path:OUT+'-'+MODE+'-retrying.png'});}
 if(s&&(s.loaded||s.btn)){console.log(MODE,'after',i+'s',JSON.stringify(s),'requests',n,'seeds',seen.join(','));break;}}
await p.screenshot({path:OUT+'-'+MODE+'-result.png'});
if(MODE==='fail'){allow=true;await p.click('.gen-retry');for(let i=0;i<90;i++){await sleep(1000);const s=await st();if(s&&(s.loaded||s.btn&&i>3)){console.log('after retry button',JSON.stringify(s));break;}}await p.screenshot({path:OUT+'-fail-after-button.png'});}
await b.close()})();
