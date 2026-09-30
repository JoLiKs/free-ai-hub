const {launch,open,sleep}=require('./lib.cjs');
(async()=>{
 const b=await launch(); const ctx=await b.createBrowserContext(); const p=await open(ctx,{});
 await sleep(2500);
 console.log('sw controlling:',await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); return !!r&&!!r.active}));
 await p.reload(); await p.waitForFunction('document.documentElement.dataset.ready==="1"'); await sleep(500);
 await p.setOfflineMode(true); await p.reload({waitUntil:'load'}).catch(e=>console.log('reload err',e.message));
 await p.waitForFunction('document.documentElement.dataset.ready==="1"',{timeout:8000}).then(()=>console.log('offline reload: app ready')).catch(()=>console.log('offline reload: NOT ready'));
 console.log(p.logs.filter(l=>!/CORS|Failed to load|ERR_/.test(l)));
 await b.close();
})();
