const {launch,open,sleep}=require('./lib.cjs');
(async()=>{const b=await launch(); const ctx=await b.createBrowserContext(); const p=await open(ctx,{});
 const act=()=>p.evaluate(()=>{const a=document.activeElement;return a?(a.id||a.className||a.tagName):null});
 const pop=()=>p.evaluate(()=>!document.querySelector('#popover').hidden);
 // Ctrl+K opens model picker
 await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control'); await sleep(300);
 console.log('ctrl+k popover:',await pop(),'focus:',await act());
 await p.keyboard.type('qwen'); await sleep(200);
 console.log('filtered:',await p.evaluate(()=>document.querySelectorAll('#popover [role=option]').length));
 await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(300);
 console.log('popover closed:',!(await pop()),'model:',await p.evaluate(()=>window.__fah.state.settings.models.ovh),'focus:',await act());
 // '/' focuses input
 await p.evaluate(()=>document.body.focus()); await p.keyboard.press('/'); console.log('/ focus:',await act());
 // Alt+N new chat, Alt+B toggle sidebar
 await p.keyboard.down('Alt'); await p.keyboard.press('b'); await p.keyboard.up('Alt'); await sleep(200);
 console.log('sidebar collapsed:',await p.evaluate(()=>document.getElementById('app').classList.contains('collapsed')));
 await p.keyboard.down('Alt'); await p.keyboard.press('b'); await p.keyboard.up('Alt');
 // Tab order first few
 await p.evaluate(()=>document.activeElement.blur()); const order=[]; for(let i=0;i<12;i++){await p.keyboard.press('Tab'); order.push(await act());} console.log('tab order:',order.join(' > '));
 // tabs arrow keys
 await p.focus('#tab-model'); await p.keyboard.press('ArrowRight'); await sleep(100); console.log('after ArrowRight tab:',await act(), await p.evaluate(()=>document.getElementById('tab-settings').getAttribute('aria-selected')));
 // focus-visible ring exists
 await p.focus('#sendBtn'); const ring=await p.evaluate(()=>{const s=getComputedStyle(document.getElementById('sendBtn'));return s.outlineStyle+' '+s.outlineWidth+' '+s.boxShadow.slice(0,40)}); console.log('sendBtn focus style:',ring);
 // Esc closes sidebar drawer on mobile handled elsewhere; check dialogs: delete all chats dialog focus trap
 console.log(p.logs.join('\n')||'no logs');
 await b.close();})();
