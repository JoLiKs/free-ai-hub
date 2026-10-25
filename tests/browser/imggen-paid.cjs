// Платный режим на живом сайте с замоканным сервером: site-config.imggen_paid=true, POST /api/img → /api/img/<id>.jpg.
// MODE=ok — картинка с нашего сервера; MODE=fail — сервер отвечает {error:'quota',fallback:true} → бесплатная прямая ссылка; MODE=free — без мока.
const fs=require('fs');const {launch,open,sleep}=require('./lib.cjs');
const MODE=process.env.MODE||'ok',OUT='/workspace/imggen-paid';const J=fs.readFileSync('/tmp/paid.jpg');const ID='0123456789abcdef0123456789abcdef.jpg';
(async()=>{const b=await launch();const p=await open(b,{url:'https://aihubai.site/',pre:()=>localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))});
const log=[];if(MODE!=='free'){await p.setRequestInterception(true);
p.on('request',r=>{const u=new URL(r.url());
 if(u.pathname==='/api/site-config')return r.respond({status:200,contentType:'application/json',body:'{"popunder":false,"banner160":true,"imggen":true,"imggen_paid":true}'});
 if(u.pathname==='/api/img'&&r.method()==='POST'){log.push('POST '+r.postData());return r.respond(MODE==='ok'?{status:200,contentType:'application/json',body:JSON.stringify({ok:true,url:'/api/img/'+ID,cached:false})}:{status:503,contentType:'application/json',body:'{"ok":false,"error":"quota","fallback":true}'});}
 if(u.pathname==='/api/img/'+ID){log.push('GET '+u.pathname);return r.respond({status:200,contentType:'image/jpeg',body:J});}
 if(u.hostname==='image.pollinations.ai')log.push('FREE '+u.pathname.slice(0,40));
 r.continue();});}
await p.reload({waitUntil:'networkidle2'});await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
await p.click('#input');await p.type('#input','картинка крысы');await p.click('#sendBtn');
let s;for(let i=0;i<120;i++){await sleep(1000);s=await p.evaluate(()=>{const f=document.querySelector('.gen-img');if(!f)return null;const i=f.querySelector('img');return{err:f.classList.contains('err'),loaded:!!(i&&i.complete&&i.naturalWidth&&!f.classList.contains('loading')),src:i&&i.src,href:f.querySelector('a').getAttribute('href')}});if(s&&(s.loaded||s.err))break;}
await sleep(1500);
const stored=await p.evaluate(()=>{for(const k of Object.keys(localStorage)){const v=localStorage.getItem(k);const m=v&&v.match(/"url":"([^"]+)"/);if(m)return m[1];}return '';});
console.log(MODE,JSON.stringify(s),'stored:',stored.slice(0,90));console.log(log.join('\n'));
await p.screenshot({path:`${OUT}-${MODE}.png`});await b.close()})();
