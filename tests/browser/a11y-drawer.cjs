const {launch,open,sleep}=require('./lib.cjs');
(async()=>{
 const b=await launch();
 const p=await open(await b.createBrowserContext(),{w:390,h:844,mobile:true});
 await p.click('#openSidebar'); await sleep(400);
 // Tab through 40 times, check focus stays within sidebar
 const outside=[];
 for(let i=0;i<45;i++){ await p.keyboard.press('Tab'); const r=await p.evaluate(()=>{const a=document.activeElement; return {in:!!a.closest('#sidebar'), id:a.id||a.tagName, vis:a.offsetParent!==null}}); if(!r.in) outside.push(r.id); }
 console.log('focus escaped drawer to:',[...new Set(outside)]);
 await p.keyboard.press('Escape'); await sleep(400);
 console.log('drawer open after Esc:',await p.evaluate(()=>document.getElementById('sidebar').classList.contains('open')),'focus',await p.evaluate(()=>document.activeElement.id));
 // inert on main when open?
 await p.click('#openSidebar'); await sleep(400);
 console.log('main inert/aria-hidden:',await p.evaluate(()=>[document.getElementById('main').inert,document.getElementById('main').getAttribute('aria-hidden')]));
 await b.close();
 // reduced motion
 const b2=await launch(); const q=await b2.newPage(); await q.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]); await q.goto((process.env.APP_URL||'http://127.0.0.1:8138/index.html')); await q.waitForFunction('document.documentElement.dataset.ready==="1"');
 console.log('reduced-motion durations:',await q.evaluate(()=>{const s=getComputedStyle(document.querySelector('.card-btn')||document.body);return [s.transitionDuration,s.animationDuration, getComputedStyle(document.documentElement).scrollBehavior]}));
 await b2.close();
})();
