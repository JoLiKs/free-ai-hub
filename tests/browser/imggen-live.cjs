// LIVE: разные формулировки «крыса» → должна появиться картинка (новый чат на каждую фразу); затем продолжение «а теперь в синем цвете».
const {launch,open,sleep}=require('./lib.cjs');
const PH=(process.env.PH||'картинка крысы|а можешь картинку с крысой?|сгенерь крысу|нарисуй мне крысу|фото крысы в шляпе|крыса картинкой|сделай крысу|Давай картинку с крысой|создай кртинку крысы|rat picture please').split('|');
const OUT=process.env.OUT||'/workspace/imggen-fix';
(async()=>{const b=await launch();const res=[];
for(let k=0;k<PH.length;k++){const t=PH[k];
 const st=JSON.parse(process.env.SETTINGS||'{"autoFallback":true}');
 const p=await open(b,{url:process.env.APP_URL||'https://aihubai.site/',pre:new Function(`localStorage.setItem('fah.settings',JSON.stringify(${JSON.stringify(st)}))`)});
 await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
 const ask=async q=>{await p.click('#input');await p.type('#input',q);await p.click('#sendBtn');};
 const wait=async(n)=>{for(let i=0;i<90;i++){await sleep(1000);const s=await p.evaluate(n=>{const ms=[...document.querySelectorAll('.msg.assistant')];if(ms.length<n)return null;const m=ms[n-1];const i=m.querySelector('.gen-img img');return{name:m.querySelector('.name').textContent,img:!!m.querySelector('.gen-img'),loaded:!!(i&&i.complete&&i.naturalWidth),err:!!m.querySelector('.gen-img.err,.bubble.err'),busy:!!document.querySelector('.typing,.bubble.cursor,.status:not([hidden])'),text:m.querySelector('.bubble').innerText.slice(0,90),cap:(m.querySelector('figcaption')||{}).textContent||''}},n);
   if(s&&((s.img&&(s.loaded||s.err))||(!s.img&&!s.busy&&s.text)))return s;}return {timeout:true};};
 await ask(t);const s=await wait(1);res.push([t,s]);console.log(JSON.stringify([t,s]).slice(0,330));
 if(k===0){await p.screenshot({path:OUT+'-1.png'});await ask('а теперь в синем цвете');const f=await wait(2);console.log(JSON.stringify(['FOLLOW: а теперь в синем цвете',f]).slice(0,330));await p.screenshot({path:OUT+'-followup.png'});}
 if(k===1)await p.screenshot({path:OUT+'-2.png'});
 if(k===PH.length-1)await p.screenshot({path:OUT+'-last.png'});
 await p.close();}
console.log('IMAGES:',res.filter(r=>r[1].img).length+'/'+res.length);await b.close()})();
