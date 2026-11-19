'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const f=path.join(__dirname,'.env');
if(fs.existsSync(f)) {console.log('Already configured:',f);console.log('Your existing secret has NOT been changed.');process.exit(0);}
const s=crypto.randomBytes(32).toString('hex');
fs.writeFileSync(f,'APP_SECRET='+s+'\nPORT=3000\nPUBLIC_BASE_URL=http://localhost:3000\n',{mode:0o600});
console.log('Created .env safely. Next: npm run add-admin');
