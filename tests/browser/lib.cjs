const puppeteer=require('puppeteer-core');
exports.launch=async(extra=[])=>puppeteer.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage',...extra]});
exports.open=async(b,{w=1440,h=900,scheme='dark',url=process.env.APP_URL||'http://127.0.0.1:8138/index.html',mobile=false,pre}={})=>{
  const p=await b.newPage();
  await p.setViewport({width:w,height:h,deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
  await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:scheme}]);
  const logs=[]; p.on('console',m=>{const t=m.type(); if(t==='error'||t==='warning') logs.push(t+': '+m.text());}); p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  if(pre) await p.evaluateOnNewDocument(pre);
  await p.goto(url,{waitUntil:'load'});
  await p.waitForFunction('document.documentElement.dataset.ready==="1"',{timeout:15000}).catch(()=>logs.push('NOT READY'));
  p.logs=logs; return p;
};
exports.sleep=ms=>new Promise(r=>setTimeout(r,ms));
