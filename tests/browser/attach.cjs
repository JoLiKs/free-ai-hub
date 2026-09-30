// Картинки: кнопка видна только у vision-модели; вложение уходит как image_url; после отправки превью очищается.
const {launch,open,sleep}=require('./lib.cjs'); const fs=require('fs'), os=require('os'), path=require('path'), zlib=require('zlib');
function png(){ // красный квадрат 40×30 без зависимостей
  const crc=(b)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return(x^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
  const w=40,h=30,ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3).map((_,i)=>i%3===0?255:0)]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ihdr),ch('IDAT',zlib.deflateSync(Buffer.concat(Array(h).fill(row)))),ch('IEND',Buffer.alloc(0))]);
}
(async()=>{
  const f=path.join(os.tmpdir(),'fah-red.png'); fs.writeFileSync(f,png());
  const b=await launch(); const p=await open(await b.createBrowserContext(),{});
  let body=null; await p.setRequestInterception(true);
  p.on('request',r=>{ if(r.method()==='POST'&&/chat\/completions/.test(r.url())){ body=JSON.parse(r.postData()); r.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'text/event-stream'},body:'data: {"choices":[{"delta":{"content":"Красный"}}]}\n\ndata: [DONE]\n\n'}); } else r.continue(); });
  const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) process.exitCode=1;};
  ok(await p.evaluate(()=>document.getElementById('attachBtn').hidden),'у Mistral-Small кнопка вложения скрыта');
  await p.evaluate(async()=>{const f=window.__fah; f.state.settings.autoFallback=false; f.state.settings.models.ovh='Qwen3.5-9B'; f.renderAll();});
  ok(await p.evaluate(()=>!document.getElementById('attachBtn').hidden),'у Qwen3.5-9B кнопка видна');
  await (await p.$('#attachFile')).uploadFile(f); await sleep(600);
  ok(await p.evaluate(()=>document.querySelectorAll('#attachStrip img').length===1),'превью добавлено');
  await p.type('#input','что на картинке?'); await p.click('#sendBtn'); await sleep(1500);
  const c=body&&body.messages[body.messages.length-1].content;
  ok(Array.isArray(c)&&c[0].type==='text'&&c[1].type==='image_url'&&/^data:image\/jpeg;base64,/.test(c[1].image_url.url),'запрос содержит content[text,image_url]');
  ok(await p.evaluate(()=>document.getElementById('attachStrip').hidden&&document.querySelectorAll('#msgsA .msg-imgs img').length===1),'превью очищено, картинка в сообщении');
  ok(!p.logs.some(l=>/PAGEERROR/.test(l)),'нет ошибок страницы');
  await b.close();
})();
