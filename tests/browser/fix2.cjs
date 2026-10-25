const {launch,open,sleep}=require('./lib.cjs');
const M=process.env.MODEL||'onnx-community/Qwen2.5-0.5B-Instruct',W=+(process.env.W||1366),H=+(process.env.H||768),OUT=process.env.OUT||'/workspace/localai-fix2';
(async()=>{const b=await launch();
const p=await open(b,{w:W,h:H,mobile:!!process.env.DPR2,url:process.env.APP_URL||'https://aihubai.site/',pre:new Function(`localStorage.setItem('fah.settings',JSON.stringify({provider:'local',models:{local:'${M}'},localOk:{'${M}':true},autoFallback:false,maxTokens:30}))`)});
await sleep(800);if(await p.$('#consentNo')){await p.click('#consentNo');await sleep(400);}
await p.click('#input');await p.type('#input','Привет');await p.click('#sendBtn');
for(let i=0;i<120;i++){await sleep(1000);const r=await p.evaluate(()=>{const m=[...document.querySelectorAll('.msg.assistant')].pop();if(!m)return null;const st=m.querySelector('.status');if(!st||st.hidden||!/%/.test(st.innerText)||!/[1-9]/.test((st.querySelector('.lp-meta')||{}).innerText.split('·')[1]||''))return null;
 const cs=getComputedStyle(st),bub=m.querySelector('.bubble');const row=st.querySelector('.lp-row');
 return {cls:st.className,h:st.getBoundingClientRect().height,sh:st.scrollHeight,ch:st.clientHeight,ov:cs.overflow,maxh:cs.maxHeight,hgt:cs.height,disp:cs.display,dir:cs.flexDirection,clip:cs.clipPath,rowH:row&&row.getBoundingClientRect().height,bubDisp:getComputedStyle(bub).display,bubHTML:bub.innerHTML.slice(0,60),txt:st.innerText,css:[...document.styleSheets].map(s=>s.href).join(',')}});
 if(r){console.log(JSON.stringify(r));const el=await p.$('.msg.assistant:last-of-type .msg-main');await el.screenshot({path:OUT+'-'+W+'.png'});break;}}
await b.close()})();
