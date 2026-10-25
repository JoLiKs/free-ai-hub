// Живая цепочка: крыса → синяя → с собакой → ещё одну (паузы ~25 с). Подпись + средний цвет картинки.
const {launch,open,sleep}=require('./lib.cjs');const OUT='/workspace/imggen-fix3';
const SEQ=['картинка крысы','а теперь в синем цвете','такую же с собакой','ещё одну'];
(async()=>{const b=await launch();const p=await open(b,{url:'https://aihubai.site/',pre:()=>localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))});
await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
for(let k=0;k<SEQ.length;k++){if(k)await sleep(25000);await p.click('#input');await p.type('#input',SEQ[k]);await p.click('#sendBtn');
 let r=null;for(let i=0;i<120;i++){await sleep(1000);r=await p.evaluate(n=>{const f=[...document.querySelectorAll('.gen-img')];if(f.length<n)return null;const e=f[n-1],i=e.querySelector('img');
  const cap=(e.querySelector('.gen-cap,figcaption')||{}).innerText||i?.alt||'';if(e.classList.contains('err'))return{err:e.innerText,cap};
  if(!(i&&i.complete&&i.naturalWidth&&!e.classList.contains('loading')))return null;
  const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.drawImage(i,0,0,32,32);const d=x.getImageData(0,0,32,32).data;let R=0,G=0,B=0,bl=0;
  for(let j=0;j<d.length;j+=4){R+=d[j];G+=d[j+1];B+=d[j+2];if(d[j+2]>d[j]+25&&d[j+2]>d[j+1]+10)bl++;}const q=d.length/4;
  return{cap,avg:[R/q|0,G/q|0,B/q|0],bluePx:Math.round(100*bl/q)+'%',src:i.src.slice(0,140)}},k+1);if(r)break;}
 console.log(JSON.stringify({msg:SEQ[k],...r}));await p.screenshot({path:`${OUT}-live-${k+1}.png`});}
await b.close()})();
