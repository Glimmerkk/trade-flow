'use strict';
const token=location.pathname.split('/').filter(Boolean).at(-1);
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let trade=null;
const stageNumber={new:1,selected:2,contacted:3,promo_rejected:3,promo_pending:3,promo_verified:4,security_recorded:5,final:5};
function alertMessage(s){const el=$('#client-alert');el.textContent=s;el.hidden=false;el.classList.add('error');}
function clearAlert(){const el=$('#client-alert');el.textContent='';el.hidden=true;}
async function api(url,body){
  const r=await fetch(url,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed.');return data;
}
async function sendStep(step,payload,button){
  if(button){button.disabled=true;button.textContent='Saving…';}clearAlert();
  try{const r=await api('/api/client/'+encodeURIComponent(token)+'/'+step,payload);trade=r.trade;render();}
  catch(e){alertMessage(e.message);if(button){button.disabled=false;button.textContent=button.dataset.label||'Continue';}}
}
function row(a,b){return `<div class="detail-row"><span>${esc(a)}</span><strong>${esc(b||'—')}</strong></div>`;}
function info(){return `<div class="client-detail-panel"><div class="section-kicker">PAYMENT REQUEST AMOUNT</div><div class="payment-amount">${esc(trade.amount)} <small>${esc(trade.currency)}</small></div>${row('Trading platform',trade.platform)}${row('Trade ID',trade.tradeId)}${row('Transaction ID',trade.transactionId)}${row('Bank',trade.bankName)}${trade.clientLabel?row('Client reference',trade.clientLabel):''}</div>`;}
function heading(k,h,description){return `<div class="section-kicker">${esc(k)}</div><h2>${esc(h)}</h2><p>${esc(description)}</p>`;}
function render(){
  if(!trade)return;
  document.body.className='client-ui theme-'+trade.platform.toLowerCase();
  const step=stageNumber[trade.stage]||1;
  $('#step-indicator').textContent=trade.stage==='final'?'COMPLETED':'STEP '+step+' OF 5';
  $('#platform-label').textContent=trade.platform+' trade';
  $('#progress-fill').style.width=((step/5)*100)+'%';
  const root=$('#client-content');
  if(trade.stage==='new') {
    root.innerHTML=heading('01 / REVIEW','Your '+trade.platform+' trade request','Check the payment information below and choose how you want to respond.')+info()+`<div class="client-button-group"><button id="accept" class="client-button">Accept payment</button><button id="reject" class="client-button client-button-outline">Reject payment</button></div><p class="mini-note">Selecting an option does not execute or cancel a transfer on ${esc(trade.platform)}.</p>`;
    $('#accept').onclick=e=>sendStep('action',{action:'accept'},e.currentTarget);
    $('#reject').onclick=e=>sendStep('action',{action:'reject'},e.currentTarget);
  }else if(trade.stage==='selected') {
    const verb=trade.selectedAction==='Accept'?'accept':'reject';
    root.innerHTML=heading('02 / IDENTIFY','Confirm your contact','To '+verb+' this '+trade.platform+' trade instruction, enter your contact email address or international phone number.')+
    `<form id="contact-form"><label class="client-field">Email address or phone number<input class="client-input" id="client-contact" autocomplete="off" placeholder="you@example.com or +254 7xx xxx xxx" required maxlength="200"></label><button type="submit" class="client-button" data-label="Continue to trade code">Continue to trade code</button></form><p class="mini-note">We only retain and notify your administrator of a masked contact, such as jo***@email.com or +254***123.</p>`;
    $('#contact-form').onsubmit=e=>{e.preventDefault();sendStep('contact',{contact:$('#client-contact').value},e.currentTarget.querySelector('button'));};
  }else if(trade.stage==='contacted'||trade.stage==='promo_rejected') {
    const declined=trade.stage==='promo_rejected';
    root.innerHTML=heading('03 / TRADE REFERENCE',declined?'Reference rejected — try again':'Submit your trade reference',declined?'The administrator declined the reference you submitted. Confirm it in your original trade chat and try again.':'Enter the trade reference your trading partner gave you through the original trade chat. The admin will review it manually before you can continue.')+
    `<div class="client-detail-panel">${row('Platform',trade.platform)}${row('Your contact',trade.contactMasked)}${row('Requested action',trade.selectedAction)}</div><form id="promo-form"><label class="client-field">Trade-chat reference (6–32 characters, including a letter)<input class="client-input" id="client-code" autocomplete="off" autocapitalize="characters" maxlength="32" minlength="6" placeholder="Trade-chat reference (not an OTP)" required></label><button type="submit" class="client-button" data-label="Submit for admin review">Submit for admin review</button></form><p class="mini-note">This reference is shown to your assigned administrator in a private Telegram chat for manual approval. Never enter an exchange password, one-time login code, or recovery code.</p>`;
    $('#promo-form').onsubmit=e=>{e.preventDefault();sendStep('promo',{code:$('#client-code').value},e.currentTarget.querySelector('button'));};
  }else if(trade.stage==='promo_pending') {
    root.innerHTML=heading('03 / WAITING FOR REVIEW','Awaiting administrator approval','Your trade reference was submitted. Your trading partner must approve or reject it before you can proceed to the 2FA-status page.')+
    `<div class="client-detail-panel">${row('Platform',trade.platform)}${row('Trade ID',trade.tradeId)}${row('Contact',trade.contactMasked)}${row('Submitted reference',trade.reviewHint||'Submitted')}${row('Status','Pending manual review')}</div><div class="pending-row"><span class="waiting-spinner" aria-hidden="true"></span><strong>Waiting for the admin to respond in Telegram…</strong></div><button id="check-review" class="client-button client-button-outline" data-label="Check status">Check status now</button><p class="mini-note">This page automatically checks the decision. Do not enter passwords or 2FA codes on this portal.</p>`;
    $('#check-review').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const r=await api('/api/client/'+encodeURIComponent(token));trade=r.trade;render();}catch(err){alertMessage(err.message);}finally{button.disabled=false;}};
  }else if(trade.stage==='promo_verified') {
    root.innerHTML=heading('04 / ACCOUNT SECURITY','Security status','Does your own '+trade.platform+' account currently have two-factor authentication enabled? This is an informational declaration only.')+
    `<form id="security-form"><div class="choice-list"><label class="choice"><input type="radio" name="security" value="enabled" required> Yes, my account has 2FA enabled</label><label class="choice"><input type="radio" name="security" value="disabled" required> No, my account does not have 2FA enabled</label></div><button type="submit" class="client-button" data-label="Continue">Continue</button></form><p class="mini-note">We will notify the trade administrator of your selection only. Never share an SMS code, authenticator code or recovery phrase here.</p>`;
    $('#security-form').onsubmit=e=>{e.preventDefault();const v=new FormData(e.currentTarget).get('security');if(!v){alertMessage('Please select your 2FA status.');return;}sendStep('security',{status:v},e.currentTarget.querySelector('button'));};
  }else if(trade.stage==='security_recorded') {
    const isAccept=trade.selectedAction==='Accept';
    root.innerHTML=heading('05 / FINAL CONFIRMATION','Review your choice','You are about to record your decision on this payment request.')+
    `<div class="client-detail-panel">${row('Trading platform',trade.platform)}${row('Amount',trade.amount+' '+trade.currency)}${row('Your contact',trade.contactMasked)}${row('Code','Verified')}${row('2FA status',trade.securityReported==='enabled'?'Reported enabled':'Reported disabled')}${row('Your decision',isAccept?'Accept payment instruction':'Reject payment instruction')}</div><button class="client-button" id="finish" data-label="Confirm my decision">Confirm my decision</button><p class="mini-note">This records a decision. It does not release, transfer, or cancel actual funds on a third-party service.</p>`;
    $('#finish').onclick=e=>sendStep('finish',{},e.currentTarget);
  }else if(trade.stage==='final'){
    const accepted=trade.finalDecision==='Accept';
    root.innerHTML=`<div class="result-icon">${accepted?'✓':'×'}</div>`+heading('REQUEST RECORDED',accepted?'Your acceptance was recorded':'Your rejection was recorded',`Your ${trade.platform} trade instruction has been marked ${accepted?'accepted':'rejected'} in TradeFlow. Your trading partner has been notified.`)+
    `<div class="client-detail-panel">${row('Trade ID',trade.tradeId)}${row('Amount',trade.amount+' '+trade.currency)}${row('Decision',accepted?'Accepted':'Rejected')}${row('Email / phone',trade.contactMasked)}</div><p class="mini-note">This confirmation is not proof that money has moved or that an action was completed on ${esc(trade.platform)}. Check your official account for payment settlement.</p>`;
  }
}
async function start(){
  try{const response=await api('/api/client/'+encodeURIComponent(token));trade=response.trade;render();}
  catch(e){$('#client-content').innerHTML=heading('LINK UNAVAILABLE','Unable to open payment request',e.message);$('#progress-fill').style.width='0%';$('#step-indicator').textContent='LINK ERROR';}
}
let polling=false;
setInterval(async()=>{
  if(polling||!trade||trade.stage!=='promo_pending'||document.hidden)return;
  polling=true;
  try{const r=await api('/api/client/'+encodeURIComponent(token));if(r.trade.stage!==trade.stage){trade=r.trade;render();}}
  catch{}finally{polling=false;}
},3000);
start();
