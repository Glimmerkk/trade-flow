'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {
  ROOT,db,modify,id,randomToken,sha,verifyPassword,encrypt,decrypt,
  maskContact,escapeHtml,iso,currencies,secretKey
}=require('./lib');
secretKey();
const PORT=Number(process.env.PORT||3000);
const BASE=(process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
if(!/^https?:\/\/[^/]+$/.test(BASE))throw new Error('PUBLIC_BASE_URL needs a valid origin, e.g. https://yourdomain.com');
const PLATFORMS=['Skrill','Binance','Bybit'];
const TELEGRAM_API_BASE=(process.env.TELEGRAM_API_BASE||'https://api.telegram.org').replace(/\/$/,'');
if(!/^https:\/\/[^/]+$/.test(TELEGRAM_API_BASE)&&!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(TELEGRAM_API_BASE))throw new Error('Invalid Telegram API endpoint');
const TELEGRAM_POLL_MS=Math.max(500,Number(process.env.TELEGRAM_POLL_MS||2000));
const RATE=new Map();
const PUBLIC_FILES={
  '/styles.css':['public/styles.css','text/css; charset=utf-8'],
  '/admin.js':['public/admin.js','text/javascript; charset=utf-8'],
  '/client.js':['public/client.js','text/javascript; charset=utf-8'],
  '/print.js':['public/print.js','text/javascript; charset=utf-8']
};
function send(res,status,payload,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(JSON.stringify(payload));
}
function html(res,status,markup) {
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(markup);
}
function err(status,message) {const e=new Error(message);e.status=status;return e;}
function limit(key,max,period) {
  const now=Date.now(); let r=RATE.get(key);
  if(!r||now>r.until)r={until:now+period,count:0};
  r.count++;RATE.set(key,r);
  if(r.count>max)throw err(429,'Too many attempts. Please try again later.');
  if(RATE.size>5000)for(const [k,v] of RATE)if(now>v.until)RATE.delete(k);
}
function sourceIp(req) {return req.socket.remoteAddress||'unknown';}
function originCheck(req) {
  const o=req.headers.origin;
  if(o){
    let got='';try{got=new URL(o).origin;}catch{}
    let hostOrigin='';try{hostOrigin=new URL((req.socket.encrypted?'https':'http')+'://'+req.headers.host).origin;}catch{}
    if(got!==new URL(BASE).origin && got!==hostOrigin)throw err(403,'Cross-site request blocked.');
  }
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw err(415,'JSON is required.');
}
async function jsonBody(req) {
  let raw='';
  for await(const chunk of req) {
    raw+=chunk.toString('utf8');
    if(raw.length>16384)throw err(413,'Request is too large.');
  }
  let obj;
  try{obj=JSON.parse(raw||'{}');}catch{throw err(400,'Invalid request body.');}
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw err(400,'Invalid request body.');
  return obj;
}
function getCookie(req,key) {
  const m=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='));
  return m?m.slice(key.length+1):null;
}
function currentAdmin(req) {
  const cookie=getCookie(req,'tf_session');if(!cookie)return null;
  const sessionHash=sha(cookie);
  const d=db();const session=d.sessions.find(s=>s.tokenHash===sessionHash&&s.expiresAt>Date.now());
  if(!session)return null;
  const admin=d.admins.find(a=>a.id===session.adminId&&a.active);
  return admin?{admin,session}:null;
}
function adminRequired(req) {const auth=currentAdmin(req);if(!auth)throw err(401,'Please log in to the admin portal.');return auth.admin;}
function cookieHeader(raw,maxAge=8*3600) {
  return `tf_session=${raw}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${BASE.startsWith('https:')?'; Secure':''}`;
}
function tradeByToken(token) {
  if(!/^[A-Za-z0-9_-]{30,100}$/.test(token||''))return null;
  return db().trades.find(t=>t.linkHash===sha(token))||null;
}
function goodTrade(token) {
  let t=tradeByToken(token);
  if(!t)throw err(404,'This payment link does not exist.');
  // Previous versions auto-matched codes. Require manual approval for any legacy
  // trade that had only reached that pre-approval step when the site was updated.
  if(t.stage==='promo_verified'&&t.reviewDecision!=='approve'){
    modify(d=>{const x=d.trades.find(v=>v.id===t.id);if(x&&x.stage==='promo_verified'&&x.reviewDecision!=='approve'){
      x.stage='contacted';x.reviewHint=null;x.updatedAt=iso();
    }});
    t=tradeByToken(token);
  }
  if(Date.parse(t.expiresAt)<Date.now()&&t.stage!=='final')throw err(410,'This payment link has expired. Ask the sender for a new link.');
  return t;
}
function publicTrade(t) {
  return {
    platform:t.platform,bankName:t.bankName,transactionId:t.transactionId,
    tradeId:t.tradeId,clientLabel:t.clientLabel,amount:t.amount,currency:t.currency,
    issuedAt:t.createdAt,expiresAt:t.expiresAt,stage:t.stage,
    selectedAction:t.selectedAction,contactMasked:t.contactMasked,
    contactKind:t.contactKind,securityReported:t.securityReported,
    finalDecision:t.finalDecision,reviewHint:t.reviewHint||null
  };
}
function publicAdminTrade(t) {
  return {...publicTrade(t),id:t.id,link:BASE+'/t/'+decrypt(t.linkEnc),
    reviewId:t.stage==='promo_pending'?t.reviewId:null,
    adminId:t.adminId,updatedAt:t.updatedAt,notificationCount:t.notificationCount||0};
}
function shorten(s,n=100) {return String(s??'').slice(0,n).replace(/[\r\n\t]/g,' ');}
function telegramMessage(t,event) {
  const a=db().admins.find(x=>x.id===t.adminId);
  const lines=[
    '🔔 TradeFlow · Client activity',
    'Admin: '+shorten(a?.username||'Unknown'),
    'Platform: '+shorten(t.platform),
    'Trade ID: '+shorten(t.tradeId),
    'Transaction ID: '+shorten(t.transactionId),
    'Amount: '+shorten(t.amount)+' '+t.currency,
    'Step: '+shorten(event.title),
    'Client: '+(t.contactMasked?`${t.contactKind} ${t.contactMasked}`:'Not entered'),
    'Trade reference status: '+(t.stage==='promo_pending'?'AWAITING YOUR APPROVAL':t.stage==='promo_verified'||t.stage==='security_recorded'||t.stage==='final'?'Admin approved':t.stage==='promo_rejected'?'Admin rejected':'Not submitted'),
    'Client 2FA: '+(t.securityReported==='enabled'?'Reported enabled (not independently verified)':t.securityReported==='disabled'?'Reported disabled':'Not reported'),
    'Client decision: '+(t.finalDecision||t.selectedAction||'Not chosen')
  ];
  if(event.title==='Client submitted trade code for manual review' && t.stage==='promo_pending' && t.reviewCodeEnc){
    // This is an independently agreed trade-chat reference, NOT a platform OTP or credential.
    lines.push('Trade reference entered: '+shorten(decrypt(t.reviewCodeEnc),40));
    lines.push('Compare with the reference in your own trade chat, then use Approve or Reject below.');
  }
  if(event.detail)lines.push('Detail: '+shorten(event.detail,160));
  lines.push('Time: '+event.createdAt);
  return lines.join('\n');
}
async function telegramRequest(token,method,body){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
  try{
    const response=await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal
    });
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(`Telegram ${method} rejected the request`);
    return result.result;
  }finally{clearTimeout(timer);}
}
async function notifyEvent(tradeId,eventId) {
  const d=db();const t=d.trades.find(x=>x.id===tradeId), e=d.events.find(x=>x.id===eventId);
  if(!t||!e)return;
  const admin=d.admins.find(a=>a.id===t.adminId);
  let delivery='unconfigured';
  if(admin?.botTokenEnc&&admin?.chatIdEnc){
    try {
      const token=decrypt(admin.botTokenEnc),chat_id=decrypt(admin.chatIdEnc);
      const pending=e.title==='Client submitted trade code for manual review'&&t.stage==='promo_pending';
      await telegramRequest(token,'sendMessage',{
        chat_id,text:telegramMessage(t,e),disable_web_page_preview:true,
        ...(pending?{reply_markup:{inline_keyboard:[[ 
          {text:'✅ Approve reference',callback_data:`r:${t.id}:${t.reviewId}:a`},
          {text:'❌ Reject reference',callback_data:`r:${t.id}:${t.reviewId}:r`}
        ]]}}:{})
      });
      delivery='sent';
    }catch{delivery='failed';}
  }
  modify(data=>{const x=data.events.find(z=>z.id===eventId);if(x)x.telegram=delivery;
    const t2=data.trades.find(z=>z.id===tradeId);if(t2&&delivery==='sent')t2.notificationCount=(t2.notificationCount||0)+1;});
}
async function event(tradeId,title,detail='') {
  const e={id:id(),tradeId,title,detail,createdAt:iso(),telegram:'pending'};
  modify(d=>{d.events.push(e);});
  await notifyEvent(tradeId,e.id);
}
function changeTrade(tradeId,fn) {
  return modify(d=>{const t=d.trades.find(x=>x.id===tradeId);if(!t)throw err(404,'Trade not found');
    const out=fn(t);t.updatedAt=iso();return out??t;});
}
function ensureStage(t,expected){if(t.stage!==expected)throw err(409,'This step has already been completed or is not available. Refresh to resume.');}
async function reviewTrade(tradeId,adminId,reviewId,decision,source){
  if(!['approve','reject'].includes(decision))throw err(400,'Choose approve or reject.');
  changeTrade(tradeId,t=>{
    if(t.adminId!==adminId)throw err(403,'This trade belongs to a different administrator.');
    if(t.stage!=='promo_pending'||t.reviewId!==reviewId)throw err(409,'This review is no longer pending.');
    t.stage=decision==='approve'?'promo_verified':'promo_rejected';
    t.reviewDecision=decision;t.reviewDecisionAt=iso();t.reviewCodeEnc=null;t.reviewId=null;
  });
  await event(tradeId,decision==='approve'?'Admin approved trade reference':'Admin rejected trade reference',
    decision==='approve'?'Client may proceed to 2FA status':'Client may enter another trade reference');
}
async function handleTelegramCallback(token,callback){
  if(!callback||typeof callback.id!=='string')return;
  let message='This action is not recognized.';
  let completed=false;
  try{
    const matched=String(callback.data||'').match(/^r:([a-f0-9-]{36}):([A-Za-z0-9_-]{12}):([ar])$/);
    if(matched){
      const t=db().trades.find(x=>x.id===matched[1]);
      const admin=t&&db().admins.find(a=>a.id===t.adminId&&a.active&&a.botTokenEnc&&a.chatIdEnc);
      const chatId=admin?decrypt(admin.chatIdEnc):null;
      const registeredBot=admin?decrypt(admin.botTokenEnc):null;
      // For authority to approve, this must be the assigned admin's PRIVATE bot chat.
      if(!admin||registeredBot!==token||!/^\d+$/.test(chatId||'')||
         String(callback.from?.id)!==chatId||String(callback.message?.chat?.id)!==chatId||
         callback.message?.chat?.type!=='private'){
        message='Not authorized. Only the assigned admin in a private Telegram chat can decide.';
      }else{
        try{
          await reviewTrade(t.id,admin.id,matched[2],matched[3]==='a'?'approve':'reject','Telegram');
          completed=true;message=matched[3]==='a'?'Approved. Client can proceed to the 2FA-status page.':'Rejected. Client can re-enter the trade reference.';
        }catch(e){message=e.status===409?'Already handled or no longer pending.':'Review could not be completed.';}
      }
    }
  }catch{message='Could not process this decision.';}
  try{await telegramRequest(token,'answerCallbackQuery',{callback_query_id:callback.id,text:message,show_alert:!completed});}catch{}
  if(completed&&callback.message?.message_id){
    try{await telegramRequest(token,'editMessageReplyMarkup',{
      chat_id:callback.message.chat.id,message_id:callback.message.message_id,
      reply_markup:{inline_keyboard:[]}
    });}catch{}
  }
}
let telegramPollBusy=false;
async function pollTelegram(){
  if(telegramPollBusy)return;
  telegramPollBusy=true;
  try{
    const tokens=new Set();
    for(const a of db().admins){if(a.active&&a.botTokenEnc&&a.chatIdEnc)tokens.add(decrypt(a.botTokenEnc));}
    await Promise.all([...tokens].map(async(token)=>{
      const key=sha(token);
      try{
        const offset=db().telegramOffsets?.[key]||0;
        const updates=await telegramRequest(token,'getUpdates',{offset,timeout:0,limit:25,allowed_updates:['callback_query']});
        if(!Array.isArray(updates))return;
        for(const u of updates){
          if(!Number.isSafeInteger(u.update_id)||u.update_id<offset)continue;
          if(u.callback_query)await handleTelegramCallback(token,u.callback_query);
          modify(d=>{d.telegramOffsets??={};d.telegramOffsets[key]=Math.max(d.telegramOffsets[key]||0,u.update_id+1);});
        }
      }catch(e){/* Telegram unreachable or bot webhook mode: keep saved offset and retry. */}
    }));
  }finally{telegramPollBusy=false;}
}
function receiptHtml(t,owner) {
  const rows=[['Trade platform',t.platform],['Client reference',t.clientLabel||'Not provided'],['Bank name',t.bankName],['Trade ID',t.tradeId],['Transaction ID',t.transactionId],['Request issued',new Date(t.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC'],['Client response',t.finalDecision||'Awaiting confirmation']];
  const label=(t.finalDecision==='Accept')?'Accepted payment instruction':(t.finalDecision==='Reject')?'Rejected payment instruction':'Pending payment instruction';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TradeFlow payment notice</title><link rel="stylesheet" href="/styles.css"><script defer src="/print.js"></script></head><body class="receipt-body"><main class="receipt sheet"><div class="receipt-head"><div><div class="eyebrow">TRADEFLOW · INDEPENDENT TRADE DOCUMENT</div><h1>Payment instruction notice</h1><p>Reference: ${escapeHtml(t.id.slice(0,8).toUpperCase())}</p></div><button class="primary print-hide" id="print-page">Print / Save PDF</button></div><div class="receipt-amount"><div>Request amount</div><strong>${escapeHtml(t.amount)} ${escapeHtml(t.currency)}</strong><p>${escapeHtml(label)}</p></div>${rows.map(([k,v])=>`<div class="receipt-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}<p class="receipt-disclaimer">This notice records a client response to a trade request created by ${escapeHtml(owner.username)}. It is not a bank confirmation, proof of settlement, or a document issued by ${escapeHtml(t.platform)}. Verify any actual transfer through the payment provider.</p></main></body></html>`;
}
async function handle(req,res) {
  const url=new URL(req.url,BASE),pathname=url.pathname,method=req.method;
  if(method==='GET'&&PUBLIC_FILES[pathname]) {
    const [file,type]=PUBLIC_FILES[pathname];
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
    return res.end(fs.readFileSync(path.join(ROOT,file)));
  }
  if(method==='GET'&&(pathname==='/'||pathname==='/admin')){
    return html(res,200,fs.readFileSync(path.join(ROOT,'public/admin.html'),'utf8'));
  }
  const clientPage=pathname.match(/^\/t\/([A-Za-z0-9_-]+)$/);
  if(method==='GET'&&clientPage) {
    const trade=goodTrade(clientPage[1]);
    // A visit is a single notification per trade, preventing refresh spam.
    if(!trade.firstOpenedAt){
      changeTrade(trade.id,t=>{if(!t.firstOpenedAt)t.firstOpenedAt=iso();});
      await event(trade.id,'Client opened payment link');
    }
    return html(res,200,fs.readFileSync(path.join(ROOT,'public/client.html'),'utf8'));
  }
  if(method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true,app:'TradeFlow',version:'1.1.0'});
  if(method==='GET'&&pathname==='/api/currencies')return send(res,200,{currencies:currencies()});
  if(method==='POST')originCheck(req);
  if(method==='POST'&&pathname==='/api/admin/login') {
    limit('login:'+sourceIp(req),8,15*60*1000);
    const body=await jsonBody(req);
    const username=String(body.username||'').trim().toLowerCase();
    const user=db().admins.find(a=>a.username===username&&a.active);
    if(!user||typeof body.password!=='string'||!verifyPassword(body.password,user.passwordHash))throw err(401,'Incorrect username or password.');
    const token=randomToken(32),expiresAt=Date.now()+8*3600*1000;
    modify(d=>{d.sessions=d.sessions.filter(s=>s.expiresAt>Date.now());d.sessions.push({tokenHash:sha(token),adminId:user.id,expiresAt,createdAt:iso()});});
    return send(res,200,{ok:true,username:user.username},{'Set-Cookie':cookieHeader(token)});
  }
  if(method==='GET'&&pathname==='/api/admin/me') {
    const a=currentAdmin(req)?.admin;
    return send(res,200,{authenticated:Boolean(a),username:a?.username||null,telegramConfigured:Boolean(a?.botTokenEnc&&a?.chatIdEnc)});
  }
  if(method==='POST'&&pathname==='/api/admin/logout'){
    const token=getCookie(req,'tf_session');
    if(token)modify(d=>{d.sessions=d.sessions.filter(s=>s.tokenHash!==sha(token));});
    return send(res,200,{ok:true},{'Set-Cookie':cookieHeader('',0)});
  }
  if(method==='GET'&&pathname==='/api/admin/trades'){
    const a=adminRequired(req), d=db();
    return send(res,200,{trades:d.trades.filter(t=>t.adminId===a.id).sort((x,y)=>y.createdAt.localeCompare(x.createdAt)).map(publicAdminTrade),
      events:d.events.filter(e=>d.trades.some(t=>t.id===e.tradeId&&t.adminId===a.id)).sort((x,y)=>y.createdAt.localeCompare(x.createdAt)).slice(0,150)});
  }
  if(method==='POST'&&pathname==='/api/admin/trades'){
    const admin=adminRequired(req);limit('create:'+admin.id,60,3600000);
    const b=await jsonBody(req);
    const platform=String(b.platform||''), bankName=shorten(b.bankName,100).trim(),
      tradeId=shorten(b.tradeId,100).trim(),transactionId=shorten(b.transactionId,100).trim(),
      currency=String(b.currency||'').toUpperCase(), amount=String(b.amount||'').trim(),
      clientLabel=shorten(b.clientLabel,100).trim();
    if(!PLATFORMS.includes(platform))throw err(400,'Choose Skrill, Binance, or Bybit.');
    if(!bankName||!tradeId||!transactionId)throw err(400,'Bank name, trade ID, and transaction ID are required.');
    if(!currencies().includes(currency))throw err(400,'Choose a supported fiat or crypto currency.');
    if(!/^(?:\d{1,14})(?:\.\d{1,8})?$/.test(amount)||Number(amount)<=0)throw err(400,'Enter a positive amount (up to 8 decimal places).');
    const hours=Number(b.expiryHours||168);
    if(![24,72,168,336].includes(hours))throw err(400,'Choose a valid expiration.');
    const key=randomToken(32),tid=id(),now=iso();
    const trade={id:tid,adminId:admin.id,platform,bankName,tradeId,transactionId,
      amount,currency,clientLabel,createdAt:now,updatedAt:now,
      expiresAt:new Date(Date.now()+hours*3600000).toISOString(),
      linkHash:sha(key),linkEnc:encrypt(key),stage:'new',selectedAction:null,contactMasked:null,contactKind:null,
      reviewId:null,reviewHint:null,reviewCodeEnc:null,reviewAttempts:0,reviewDecision:null,
      securityReported:null,finalDecision:null,notificationCount:0};
    modify(d=>{d.trades.push(trade);});
    await event(tid,'Admin created a payment request');
    return send(res,201,{trade:publicAdminTrade(db().trades.find(t=>t.id===tid))});
  }
  if(method==='POST'&&pathname==='/api/admin/test-telegram') {
    const a=adminRequired(req);
    const trades=db().trades.filter(t=>t.adminId===a.id);
    if(!trades.length)throw err(400,'Create a transaction first, then test Telegram.');
    const tid=trades[trades.length-1].id;
    await event(tid,'Admin tested Telegram notifications');
    const e=db().events.filter(x=>x.tradeId===tid).at(-1);
    return send(res,200,{ok:e.telegram==='sent',delivery:e.telegram});
  }
  const adminReview=pathname.match(/^\/api\/admin\/trades\/([a-f0-9-]+)\/review$/);
  if(method==='POST'&&adminReview){
    const admin=adminRequired(req),body=await jsonBody(req);
    const trade=db().trades.find(t=>t.id===adminReview[1]&&t.adminId===admin.id);
    if(!trade)throw err(404,'Trade not found');
    await reviewTrade(trade.id,admin.id,String(body.reviewId||''),String(body.decision||''),'Dashboard');
    return send(res,200,{ok:true,trade:publicAdminTrade(db().trades.find(t=>t.id===trade.id))});
  }
  const printable=pathname.match(/^\/api\/admin\/trades\/([a-f0-9-]+)\/print$/);
  if(method==='GET'&&printable){
    const a=adminRequired(req),trade=db().trades.find(t=>t.id===printable[1]&&t.adminId===a.id);
    if(!trade)throw err(404,'Not found');
    return html(res,200,receiptHtml(trade,a));
  }
  const clientApi=pathname.match(/^\/api\/client\/([A-Za-z0-9_-]+)(?:\/(action|contact|promo|security|finish))?$/);
  if(clientApi){
    const token=clientApi[1],step=clientApi[2]||'';
    const t=goodTrade(token);
    if(method==='GET'&&!step)return send(res,200,{trade:publicTrade(t)});
    if(method!=='POST')throw err(405,'Method not allowed');
    limit('client:'+sourceIp(req)+':'+t.id,100,15*60*1000);
    const body=await jsonBody(req);
    if(step==='action'){
      const action=body.action==='accept'?'Accept':body.action==='reject'?'Reject':null;
      if(!action)throw err(400,'Select accept or reject.');
      ensureStage(t,'new');
      changeTrade(t.id,x=>{x.selectedAction=action;x.stage='selected';});
      await event(t.id,'Client selected '+action+' payment');
    }else if(step==='contact'){
      ensureStage(t,'selected');
      const contact=maskContact(body.contact);
      changeTrade(t.id,x=>{x.contactKind=contact.kind;x.contactMasked=contact.masked;x.stage='contacted';});
      await event(t.id,'Client entered '+contact.kind.toLowerCase(),'Contact masked in alerts');
    }else if(step==='promo'){
      if(!['contacted','promo_rejected'].includes(t.stage))throw err(409,'A review is already pending or this step is complete.');
      limit('promo:'+sourceIp(req)+':'+t.id,8,15*60*1000);
      const code=String(body.code||'').trim().toUpperCase();
      if(!/^[A-Z0-9-]{6,32}$/.test(code)||!/[A-Z]/.test(code))throw err(400,'Enter a 6–32 character trade-chat reference containing at least one letter. Never enter a platform OTP.');
      changeTrade(t.id,x=>{
        x.stage='promo_pending';x.reviewId=randomToken(9);x.reviewCodeEnc=encrypt(code);
        x.reviewHint='…'+code.slice(-4);x.reviewAttempts=(x.reviewAttempts||0)+1;
        x.reviewDecision=null;
      });
      await event(t.id,'Client submitted trade code for manual review','Admin approval required before client can continue');
    }else if(step==='security'){
      ensureStage(t,'promo_verified');
      if(body.status!=='enabled'&&body.status!=='disabled')throw err(400,'Choose enabled or disabled.');
      changeTrade(t.id,x=>{x.securityReported=body.status;x.stage='security_recorded';});
      await event(t.id,'Client reported 2FA '+body.status,'Self-reported only; no OTP collected');
    }else if(step==='finish'){
      ensureStage(t,'security_recorded');
      changeTrade(t.id,x=>{x.finalDecision=x.selectedAction;x.stage='final';x.completedAt=iso();});
      await event(t.id,'Client confirmed '+t.selectedAction+' decision','Not a provider-confirmed transfer');
    }else throw err(404,'Unknown step');
    return send(res,200,{ok:true,trade:publicTrade(db().trades.find(x=>x.id===t.id))});
  }
  return send(res,404,{error:'Not found'});
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  try{await handle(req,res);}catch(e){
    if(res.headersSent){res.end();return;}
    if(!e.status)console.error('Unexpected error:',e);
    send(res,e.status||500,{error:e.status?e.message:'Internal server error.'});
  }
});
server.listen(PORT,()=>{
  const loop=setInterval(()=>{pollTelegram().catch(()=>{});},TELEGRAM_POLL_MS);loop.unref();
  pollTelegram().catch(()=>{});
  console.log('\nTradeFlow is ready: '+BASE+'/admin');
  console.log('This independent portal does not connect to Skrill, Binance or Bybit accounts.');
  console.log('Tip: use HTTPS hosting and your own public domain before sharing links.\n');
});
