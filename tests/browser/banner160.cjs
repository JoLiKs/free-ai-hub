// Баннер 160×300: виден в сайдбаре на десктопе над Native Banner, скрыт на мобильном. APP_URL=https://aihubai.site/
const {launch,open,sleep}=require('./lib.cjs');
const URL0=process.env.APP_URL||'https://aihubai.site/', OUT=process.env.OUT||'/workspace/banner160';
const st=p=>p.evaluate(()=>{const b=document.getElementById('banner160'),n=document.querySelector('.adst-box');if(!b)return 'none';const r=b.getBoundingClientRect(),q=n&&n.getBoundingClientRect();let inner='';try{inner=b.querySelector('iframe').contentDocument.body.innerHTML.slice(-400)}catch(e){inner='x-origin'}return JSON.stringify({hidden:b.hidden,disp:getComputedStyle(b).display,top:Math.round(r.top),h:Math.round(r.height),w:Math.round(r.width),nativeTop:q&&Math.round(q.top),above:q?r.bottom<=q.top+1:null,iframes:b.querySelectorAll('iframe').length,inner})});
(async()=>{const b=await launch();
for(const [name,url,opt] of [['desktop',URL0,{w:1440,h:900}],['share',process.env.SHARE_URL,{w:1440,h:900}],['mobile',URL0,{w:390,h:844,mobile:true}],]){ if(!url) continue;
 const p=await b.newPage();await p.setViewport({width:opt.w,height:opt.h,isMobile:!!opt.mobile,hasTouch:!!opt.mobile,deviceScaleFactor:1});await p.evaluateOnNewDocument(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false})});await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 if(await p.$('#consentNo')){await p.click('#consentNo').catch(()=>{});}
 await sleep(12000);console.log(name,await st(p));
 if(name==='share'){await p.evaluate(()=>{const b=document.getElementById('banner160');b&&b.scrollIntoView({block:'center'})});await sleep(500);}
 await p.screenshot({path:`${OUT}-${name}.png`});await p.close();}
await b.close()})();
