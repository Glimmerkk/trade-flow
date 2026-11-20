
'use strict';

const {
  modify,
  id,
  hashPassword,
  iso,
  encrypt,
  secretKey
} = require('./lib');

const username = String(
  process.env.TF_ADMIN_USERNAME || ''
).trim().toLowerCase();

const password = process.env.TF_ADMIN_PASSWORD || '';

const botToken = String(
  process.env.TELEGRAM_BOT_TOKEN || ''
).trim();

const chatId = String(
  process.env.TELEGRAM_CHAT_ID || ''
).trim();

// Validate configuration
secretKey();

if (!/^[a-z0-9_]{3,32}$/.test(username)) {
  throw new Error('Invalid admin username.');
}

if (password.length < 14) {
  throw new Error('Admin password must have 14+ characters.');
}

if (!botToken || !chatId) {
  throw new Error('Telegram bot token and chat ID are required.');
}

if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
  throw new Error('Invalid Telegram bot token format.');
}

if (!/^\d{1,20}$/.test(chatId)) {
  throw new Error('Invalid private Telegram chat ID.');
}

// Create or update administrator
const result = modify(data => {

  let admin = data.admins.find(
    a => a.username === username
  );

  if (!admin) {
    admin = {
      id: id(),
      username,
      createdAt: iso(),
      active: true
    };

    data.admins.push(admin);
  }

  admin.passwordHash = hashPassword(password);
  admin.botTokenEnc = encrypt(botToken);
  admin.chatIdEnc = encrypt(chatId);
  admin.active = true;

  // Expire previous sessions
  data.sessions = data.sessions.filter(
    s => s.adminId !== admin.id
  );

  return admin.username;
});

console.log('Admin configured:', result);
console.log('Telegram bot configured successfully.');
