// Живой платный режим: картинка должна отрисоваться целиком (декодирование + проверка нижней части).
const {launch,open,sleep}=require('./lib.cjs');const N=process.env.N||'1',Q=process.env.Q||'нарисуй золотой сапог';
(async()=>{const b=await launch();const p=await open(b,{url:'https://aihubai.site/',pre:()=>localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))});
const net=[];p.on('response',r=>{if(r.url().includes('/api/img'))net.push(r.request().method()+' '+r.url().replace('https://aihubai.site','')+' '+r.status()+' cl='+r.headers()['content-length']);});
await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
await p.click('#input');await p.type('#input',Q);await p.click('#sendBtn');
let s;for(let i=0;i<120;i++){await sleep(1000);s=await p.evaluate(()=>{const f=document.querySelector('.gen-img');if(!f)return null;const i=f.querySelector('img');if(f.classList.contains('err'))return{err:f.innerText};if(!(i&&i.complete&&i.naturalWidth&&!f.classList.contains('loading')))return null;
 const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.drawImage(i,0,0,64,64);const d=x.getImageData(0,48,64,16).data;let w=0;for(let j=0;j<d.length;j+=4)if(d[j]>245&&d[j+1]>245&&d[j+2]>245)w++;
 return{src:i.src.replace(location.origin,''),size:i.naturalWidth+'x'+i.naturalHeight,bottomWhitePct:Math.round(100*w/(d.length/4))}});if(s)break;}
console.log(JSON.stringify(s));console.log(net.join('\n'));
const el=await p.$('.gen-img');if(el)await el.screenshot({path:`/workspace/imggen-full-${N}.png`});await p.screenshot({path:`/workspace/imggen-full-${N}-page.png`});await b.close()})();
