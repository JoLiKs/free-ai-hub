const {launch,open,sleep}=require('./lib.cjs'); const fs=require('fs');
(async()=>{
 const evil={app:'free-ai-hub',chats:[{title:'<img src=x onerror=window.__pwn=1>',provider:'<b>x</b>',model:'"><img src=x onerror=window.__pwn=2>',msgs:[{role:'user',content:'<img src=x onerror=window.__pwn=3>'},{role:'assistant',label:'<img src=x onerror=window.__pwn=4>',content:'ok <img src=x onerror=window.__pwn=5>',reasoning:'<img src=x onerror=window.__pwn=6>'}],msgsB:[]}]};
 fs.writeFileSync(''+require('os').tmpdir()+'/fah-evil.json',JSON.stringify(evil));
 const b=await launch(); const p=await open(await b.createBrowserContext(),{});
 await p.click('#tab-chats'); const [fc]=await Promise.all([p.waitForFileChooser(),p.click('#importBtn')]); await fc.accept([''+require('os').tmpdir()+'/fah-evil.json']); await sleep(800);
 await p.click('#chatList > * '); await sleep(800).catch(()=>{});
 console.log('pwn',await p.evaluate(()=>window.__pwn),'imgs',await p.evaluate(()=>document.querySelectorAll('img').length), 'msgs',await p.evaluate(()=>document.querySelectorAll('.msg').length), p.logs);
 await b.close();
})();
