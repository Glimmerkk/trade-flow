'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA, 'database.json');
function loadEnv() {
  const f=path.join(ROOT,'.env');
  if(!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f,'utf8').split(/\r?\n/)) {
    const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if(m && !Object.hasOwn(process.env,m[1])) process.env[m[1]]=m[2];
  }
}
loadEnv();
function secretKey() {
  const s=process.env.APP_SECRET||'';
  if(!/^[0-9a-f]{64}$/i.test(s)) throw new Error('APP_SECRET must be 64 hex characters; run npm run setup');
  return Buffer.from(s,'hex');
}
function db() {
  fs.mkdirSync(DATA,{recursive:true});
  if(!fs.existsSync(DB_FILE)) return {version:1,admins:[],sessions:[],trades:[],events:[]};
  return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
}
function save(d) {
  fs.mkdirSync(DATA,{recursive:true});
  const temp=DB_FILE+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(d,null,2),{mode:0o600});
  fs.renameSync(temp,DB_FILE);
}
function modify(fn) { const d=db(); const result=fn(d); save(d); return result; }
function id() {return crypto.randomUUID();}
function randomToken(bytes=32) {return crypto.randomBytes(bytes).toString('base64url');}
function sha(s) {return crypto.createHash('sha256').update(String(s)).digest('hex');}
function hashPassword(p) {const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');}
function verifyPassword(p,stored) { if(!stored || !stored.includes(':'))return false; const [salt,digest]=stored.split(':'); const expected=Buffer.from(digest,'hex'); const actual=crypto.scryptSync(p,salt,64); return expected.length===actual.length && crypto.timingSafeEqual(expected,actual); }
function encrypt(data) {
  const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',secretKey(),iv);
  const payload=Buffer.concat([cipher.update(String(data),'utf8'),cipher.final()]);
  return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),payload.toString('hex')].join('.');
}
function decrypt(value) {
  const [iv,tag,payload]=String(value).split('.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',secretKey(),Buffer.from(iv,'hex'));
  decipher.setAuthTag(Buffer.from(tag,'hex'));
  return Buffer.concat([decipher.update(Buffer.from(payload,'hex')),decipher.final()]).toString('utf8');
}
function hashCode(code,tradeId) {return crypto.createHmac('sha256',secretKey()).update(tradeId+'\0'+String(code).trim().toUpperCase()).digest('hex');}
function safeCompare(a,b) {if(!a||!b)return false; const x=Buffer.from(String(a),'hex');const y=Buffer.from(String(b),'hex'); return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function maskContact(raw) {
  const v=String(raw||'').trim();
  if(v.includes('@')) {
    if(v.length>200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('Enter a valid email address.');
    const [name,domain]=v.split('@');
    return {kind:'Email',masked:name.slice(0,Math.min(2,name.length))+'***@'+domain};
  }
  const digits=v.replace(/\D/g,'');
  if(!/^[+()\d\s-]+$/.test(v)||digits.length<7||digits.length>15) throw new Error('Enter a valid international phone number.');
  return {kind:'Phone',masked:(v.startsWith('+')?'+':'')+digits.slice(0,Math.min(3,digits.length-3))+'***'+digits.slice(-3)};
}
function escapeHtml(s) {return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function iso() {return new Date().toISOString();}
function currencies() {
  const arr=Intl.supportedValuesOf('currency');
  return [...new Set([...arr,'USDT','USDC','BTC','ETH','BNB'])].sort();
}
module.exports={ROOT,DATA,DB_FILE,db,save,modify,id,randomToken,sha,hashPassword,verifyPassword,encrypt,decrypt,hashCode,safeCompare,maskContact,escapeHtml,iso,currencies,secretKey};
