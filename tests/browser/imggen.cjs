// Генерация картинок в чате: «нарисуй…» → картинка; «как нарисовать график в excel» → обычный текстовый ответ.
const {launch,open,sleep}=require('./lib.cjs');
const OUT=process.env.OUT||'/workspace/imggen';
(async()=>{const b=await launch();const p=await open(b,{pre:()=>localStorage.setItem('fah.settings',JSON.stringify({autoFallback:true}))});
await sleep(800); if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(400);}
const ask=async(t)=>{await p.click('#input');await p.type('#input',t);await p.click('#sendBtn');};
const last=()=>p.evaluate(()=>{const m=[...document.querySelectorAll('.msg.assistant')].pop();if(!m)return null;return{name:m.querySelector('.name').textContent,img:!!m.querySelector('.gen-img img'),loading:!!m.querySelector('.gen-img.loading'),err:!!m.querySelector('.gen-img.err,.bubble.err'),loaded:(()=>{const i=m.querySelector('.gen-img img');return !!(i&&i.complete&&i.naturalWidth)})(),acts:[...m.querySelectorAll('.act')].map(a=>a.dataset.act).join(','),text:m.querySelector('.bubble').innerText.slice(0,120),busy:!!document.querySelector('.bubble.cursor,.typing')}});
await ask('Нарисуй рыжего кота-космонавта на фоне Земли');
let shotL=0;for(let i=0;i<90;i++){await sleep(1000);const s=await last();if(s&&s.loading&&!shotL){shotL=1;await p.screenshot({path:OUT+'-loading.png'});}if(s&&(s.loaded||s.err)){console.log('IMG',JSON.stringify(s));break;}if(i%10==0)console.log(JSON.stringify(s));}
await sleep(500);await p.screenshot({path:OUT+'-answer.png'});
await ask('как нарисовать график в excel');
for(let i=0;i<60;i++){await sleep(1000);const s=await last();if(s&&!s.busy&&s.text&&!/Картинка/.test(s.name)){console.log('TEXT',JSON.stringify(s));break;}}
await p.screenshot({path:OUT+'-nofalsepositive.png'});
console.log(p.logs.join('\n'));await b.close()})();
