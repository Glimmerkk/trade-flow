'use strict';
const readline=require('node:readline/promises');
const {stdin:input,stdout:output}=require('node:process');
const {db,modify,id,hashPassword,encrypt,secretKey,iso}=require('./lib');
async function run(){
  secretKey();
  const rl=readline.createInterface({input,output});
  try {
    const username=(await rl.question('Admin username (3-32 letters, numbers, underscore): ')).trim().toLowerCase();
    if(!/^[a-z0-9_]{3,32}$/.test(username))throw new Error('Invalid username');
    if(db().admins.some(a=>a.username===username))throw new Error('That username already exists');
    const password=await rl.question('Unique admin password (14+ characters): ');
    if(password.length<14)throw new Error('Password must have at least 14 characters');
    const botToken=(await rl.question('Telegram bot token from BotFather (blank to configure later): ')).trim();
    const chatId=(await rl.question('Telegram chat ID (blank to configure later): ')).trim();
    if(Boolean(botToken)!==Boolean(chatId))throw new Error('Set both Telegram fields, or leave both blank');
    if(botToken && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken))throw new Error('Telegram bot token format is invalid');
    if(chatId && !/^\d{1,20}$/.test(chatId))throw new Error('Use the positive numeric ID of your PRIVATE Telegram chat for approval buttons');
    modify(d=>d.admins.push({id:id(),username,passwordHash:hashPassword(password),botTokenEnc:botToken?encrypt(botToken):null,chatIdEnc:chatId?encrypt(chatId):null,createdAt:iso(),active:true}));
    console.log('\nAdmin created:',username,'\nAdmins only see their own transactions.');
    if(!botToken)console.log('Telegram not configured for this admin; you can run npm run set-telegram later.');
  }finally{rl.close();}
}
run().catch(e=>{console.error('Error:',e.message);process.exitCode=1;});
