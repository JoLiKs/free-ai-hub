// LIVE: вопросы о возможностях/видео/болтовня → текст; «нарисуй кота» → картинка. Один чат, как у пользователя.
const {launch,open,sleep}=require('./lib.cjs');
const PH=['картинки умеешь?','А видео генерировать можешь?','Ты шо прикалуешься','нарисуй кота'];
(async()=>{const b=await launch();
for(const st of [{autoFallback:true},{autoFallback:false,provider:'ovh',model:'Mistral-Small-3.2-24B-Instruct-2506'}]){
 const p=await open(b,{url:'https://aihubai.site/',pre:new Function(`localStorage.setItem('fah.settings',JSON.stringify(${JSON.stringify(st)}))`)});
 await sleep(1000);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(300);}
 console.log('== settings',JSON.stringify(st), await p.evaluate(()=>[...document.scripts].map(s=>s.src).filter(s=>/app\.js/.test(s)).join()));
 for(let n=1;n<=PH.length;n++){await p.click('#input');await p.type('#input',PH[n-1]);await p.click('#sendBtn');
  let s={timeout:true};for(let i=0;i<90;i++){await sleep(1000);const r=await p.evaluate(n=>{const ms=[...document.querySelectorAll('.msg.assistant')];if(ms.length<n)return null;const m=ms[n-1];return{name:m.querySelector('.name').textContent,img:!!m.querySelector('.gen-img'),busy:!!document.querySelector('.typing,.bubble.cursor,.status:not([hidden])'),text:m.querySelector('.bubble').innerText.replace(/\s+/g,' ').slice(0,140)}},n);if(r&&(r.img||(!r.busy&&r.text))){s=r;break;}}
  console.log(JSON.stringify([PH[n-1],s]));}
 await p.screenshot({path:'/workspace/e2e-capq-'+(st.provider||'default')+'.png'});await p.close();}
await b.close()})();
