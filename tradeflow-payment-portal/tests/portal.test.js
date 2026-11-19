'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const http=require('node:http');
const {spawn}=require('node:child_process');
async function openPort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function until(fn,timeout=9000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await sleep(120);}throw new Error('Timed out waiting for expected update');}
async function fixture(admins,env={}){
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'tradeflow-test-'));
  const root=path.resolve(__dirname,'..');
  for(const name of ['server.js','lib.js'])fs.copyFileSync(path.join(root,name),path.join(work,name));
  fs.cpSync(path.join(root,'public'),path.join(work,'public'),{recursive:true});
  fs.mkdirSync(path.join(work,'data'));
  const key='c'.repeat(64);
  process.env.APP_SECRET=key;
  const lib=require(path.join(work,'lib.js'));
  lib.save({version:1,admins:admins(lib),sessions:[],trades:[],events:[]});
  const port=await openPort(),origin=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[path.join(work,'server.js')],{
    cwd:work,env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:origin,TELEGRAM_POLL_MS:'500',...env},stdio:'pipe'
  });
  let error='';child.stderr.on('data',c=>{error+=c.toString();});
  try{await until(async()=>{if(child.exitCode!==null)throw new Error('Server crashed: '+error);try{return (await fetch(origin+'/api/health')).ok;}catch{return false;}},5000);}
  catch(e){child.kill();fs.rmSync(work,{recursive:true,force:true});throw e;}
  const json=async(url,data,session='')=>{
    const r=await fetch(origin+url,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json','Origin':origin}),...(session?{'Cookie':session}:{})},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
    const b=(r.headers.get('content-type')||'').includes('json')?await r.json():null;
    return {status:r.status,body:b,cookie:r.headers.get('set-cookie')};
  };
  return {json,origin,work,lib,child,async close(){child.kill('SIGTERM');await sleep(150);fs.rmSync(work,{recursive:true,force:true});}};
}
const payload=(platform='Skrill')=>({platform,bankName:'Example Client Bank',tradeId:'TRD-441',transactionId:'TXN-230',amount:'1500.25',currency:'USD',clientLabel:'Client 412',expiryHours:168});
test('two admins isolated; any entered reference requires manual approval, rejected client can retry, 2FA gated',async()=>{
  const f=await fixture(lib=>[
    {id:'admin-1',username:'manager1',passwordHash:lib.hashPassword('UnusualSecureP@ssword123'),active:true,botTokenEnc:null,chatIdEnc:null},
    {id:'admin-2',username:'manager2',passwordHash:lib.hashPassword('AnotherSecureP@ssword987'),active:true,botTokenEnc:null,chatIdEnc:null}
  ]);
  try{
    const {json,origin}=f;
    const login1=await json('/api/admin/login',{username:'manager1',password:'UnusualSecureP@ssword123'});
    const login2=await json('/api/admin/login',{username:'manager2',password:'AnotherSecureP@ssword987'});
    assert.equal(login1.status,200);assert.equal(login2.status,200);
    const aCookie=login1.cookie.split(';')[0],bCookie=login2.cookie.split(';')[0];
    const create=await json('/api/admin/trades',payload(),aCookie);
    assert.equal(create.status,201);
    const trade=create.body.trade;
    assert.match(trade.link,/\/t\/[\w-]{40,}/);
    assert.equal(trade.promoCode,undefined,'No server-generated promo code');
    assert.equal((await json('/api/admin/trades',undefined,aCookie)).body.trades.length,1);
    assert.equal((await json('/api/admin/trades',undefined,bCookie)).body.trades.length,0);
    assert.equal((await json('/api/admin/trades/'+trade.id+'/print',undefined,bCookie)).status,404);
    const token=trade.link.split('/').at(-1);
    assert.equal((await fetch(trade.link)).status,200);
    let r=await json('/api/client/'+token+'/action',{action:'accept'});assert.equal(r.status,200);
    r=await json('/api/client/'+token+'/contact',{contact:'johnsmith@example.com'});
    assert.equal(r.body.trade.contactMasked,'jo***@example.com');
    r=await json('/api/client/'+token+'/promo',{code:'WRONGREF123'});
    assert.equal(r.status,200,'Any well-formed trade reference goes for approval');
    assert.equal(r.body.trade.stage,'promo_pending');
    assert.equal((await json('/api/client/'+token+'/security',{status:'enabled'})).status,409,'Client must wait for admin approval');
    let pending=(await json('/api/admin/trades',undefined,aCookie)).body.trades[0];
    assert.equal(pending.reviewHint,'…F123');
    assert.equal((await json('/api/admin/trades/'+trade.id+'/review',{decision:'approve',reviewId:pending.reviewId},bCookie)).status,404,'Other admin cannot approve');
    r=await json('/api/admin/trades/'+trade.id+'/review',{decision:'reject',reviewId:pending.reviewId},aCookie);
    assert.equal(r.status,200);
    assert.equal((await json('/api/client/'+token)).body.trade.stage,'promo_rejected');
    assert.equal((await json('/api/admin/trades/'+trade.id+'/review',{decision:'approve',reviewId:pending.reviewId},aCookie)).status,409,'Old review cannot be replayed');
    r=await json('/api/client/'+token+'/promo',{code:'MYCHATREF987'});
    assert.equal(r.status,200);assert.equal(r.body.trade.stage,'promo_pending');
    pending=(await json('/api/admin/trades',undefined,aCookie)).body.trades[0];
    r=await json('/api/admin/trades/'+trade.id+'/review',{decision:'approve',reviewId:pending.reviewId},aCookie);
    assert.equal(r.status,200);
    assert.equal((await json('/api/client/'+token)).body.trade.stage,'promo_verified');
    r=await json('/api/client/'+token+'/security',{status:'enabled'});assert.equal(r.status,200);
    r=await json('/api/client/'+token+'/finish',{});assert.equal(r.status,200);assert.equal(r.body.trade.finalDecision,'Accept');
    const events=(await json('/api/admin/trades',undefined,aCookie)).body.events;
    assert.equal(events.length,10);
    assert.equal(events.every(e=>e.telegram==='unconfigured'),true);
    const rawDatabase=fs.readFileSync(path.join(f.work,'data/database.json'),'utf8');
    assert.equal(rawDatabase.includes('johnsmith@example.com'),false,'Full email is not stored');
    assert.equal(rawDatabase.includes('UnusualSecureP@ssword123'),false,'Admin passwords not stored raw');
    assert.equal(rawDatabase.includes('MYCHATREF987'),false,'Trade chat reference not stored raw');
    assert.equal((await json('/api/client/'+token+'/finish',{})).status,409,'Cannot repeat final step');
    const printable=await fetch(origin+'/api/admin/trades/'+trade.id+'/print',{headers:{Cookie:aCookie}});
    assert.equal(printable.status,200);
    assert.ok((await printable.text()).includes('Accepted payment instruction'));
  }finally{await f.close();}
});
test('private Telegram Approve / Reject inline buttons control trade and are not usable by other Telegram users',async()=>{
  const bot='1234567:THIS_IS_A_FAKE_TEST_BOT_TOKEN_12345';
  const tg={messages:[],updates:[],answered:[],edits:[],nextMessageId:1};
  const fakeTelegram=http.createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk.toString();
    const b=JSON.parse(data||'{}'),method=req.url.split('/').at(-1);
    let result=true;
    if(method==='sendMessage'){
      tg.messages.push({...b,message_id:tg.nextMessageId});
      result={message_id:tg.nextMessageId++,chat:{id:b.chat_id,type:'private'}};
    }else if(method==='getUpdates')result=tg.updates.filter(u=>u.update_id >= Number(b.offset||0));
    else if(method==='answerCallbackQuery')tg.answered.push(b);
    else if(method==='editMessageReplyMarkup')tg.edits.push(b);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,result}));
  });
  await new Promise(resolve=>fakeTelegram.listen(0,'127.0.0.1',resolve));
  const apiBase='http://127.0.0.1:'+fakeTelegram.address().port;
  const f=await fixture(lib=>[{id:'admin-1',username:'manager1',passwordHash:lib.hashPassword('UnusualSecureP@ssword123'),active:true,botTokenEnc:lib.encrypt(bot),chatIdEnc:lib.encrypt('222')}],{TELEGRAM_API_BASE:apiBase});
  try{
    const {json}=f;
    const login=await json('/api/admin/login',{username:'manager1',password:'UnusualSecureP@ssword123'});
    const aCookie=login.cookie.split(';')[0];
    const create=await json('/api/admin/trades',payload('Binance'),aCookie);
    const token=create.body.trade.link.split('/').at(-1),id=create.body.trade.id;
    await json('/api/client/'+token+'/action',{action:'reject'});
    await json('/api/client/'+token+'/contact',{contact:'+254712345678'});
    await json('/api/client/'+token+'/promo',{code:'CHATEDREF123'});
    let telegramReview=await until(()=>tg.messages.find(m=>m.reply_markup?.inline_keyboard?.length));
    assert.match(telegramReview.text,/Trade reference entered: CHATEDREF123/);
    assert.match(telegramReview.text,/\+254\*\*\*678/);
    const rejectData=telegramReview.reply_markup.inline_keyboard[0][1].callback_data;
    assert.ok(Buffer.byteLength(rejectData)<=64,'Telegram callback_data must fit 64 bytes');
    // Unauthorized user pressing the same bot message must not change the trade.
    tg.updates.push({update_id:1,callback_query:{id:'cb-unauthorized',data:rejectData,from:{id:999},message:{chat:{id:222,type:'private'},message_id:telegramReview.message_id}}});
    await until(()=>tg.answered.find(x=>x.callback_query_id==='cb-unauthorized'));
    assert.equal((await json('/api/client/'+token)).body.trade.stage,'promo_pending');
    // Assigned private chat owner can reject it.
    tg.updates.push({update_id:2,callback_query:{id:'cb-reject',data:rejectData,from:{id:222},message:{chat:{id:222,type:'private'},message_id:telegramReview.message_id}}});
    await until(async()=> (await json('/api/client/'+token)).body.trade.stage==='promo_rejected');
    assert.equal((await json('/api/client/'+token+'/security',{status:'enabled'})).status,409);
    await json('/api/client/'+token+'/promo',{code:'CHECKREF987'});
    telegramReview=await until(()=>tg.messages.find(m=>m.reply_markup?.inline_keyboard?.length&&m.text.includes('CHECKREF987')));
    const approveData=telegramReview.reply_markup.inline_keyboard[0][0].callback_data;
    tg.updates.push({update_id:3,callback_query:{id:'cb-approve',data:approveData,from:{id:222},message:{chat:{id:222,type:'private'},message_id:telegramReview.message_id}}});
    await until(async()=> (await json('/api/client/'+token)).body.trade.stage==='promo_verified');
    assert.ok(tg.answered.some(x=>x.callback_query_id==='cb-reject'));
    assert.ok(tg.answered.some(x=>x.callback_query_id==='cb-approve'));
    assert.ok(tg.edits.length>=2,'Handled buttons should be removed');
    assert.equal((await json('/api/admin/trades',undefined,aCookie)).body.trades[0].reviewId,null);
    assert.equal((await json('/api/client/'+token+'/security',{status:'enabled'})).status,200);
    assert.equal((await json('/api/client/'+token+'/finish',{})).status,200);
    assert.equal((await json('/api/admin/trades',undefined,aCookie)).body.trades[0].finalDecision,'Reject');
    assert.ok(tg.messages.find(m=>m.text.includes('Admin approved trade reference')));
  }finally{await f.close();await new Promise(resolve=>fakeTelegram.close(resolve));}
});
