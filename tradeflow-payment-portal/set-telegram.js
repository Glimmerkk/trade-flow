'use strict';
const readline=require('node:readline/promises');
const {stdin:input,stdout:output}=require('node:process');
const {db,modify,encrypt,secretKey}=require('./lib');
async function run(){
  secretKey();const rl=readline.createInterface({input,output});
  try {
    const username=(await rl.question('Admin username: ')).trim().toLowerCase();
    if(!db().admins.find(a=>a.username===username)) throw new Error('Unknown admin');
    const token=(await rl.question('Bot token: ')).trim();const chat=(await rl.question('Chat ID: ')).trim();
    if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)|| !/^\d{1,20}$/.test(chat))throw new Error('Invalid token or chat ID. For approval use your private Telegram chat ID (positive number)');
    modify(d=>{const a=d.admins.find(x=>x.username===username);a.botTokenEnc=encrypt(token);a.chatIdEnc=encrypt(chat);});
    console.log('Telegram configuration updated for',username);
  }finally{rl.close();}
}
run().catch(e=>{console.error('Error:',e.message);process.exitCode=1;});
