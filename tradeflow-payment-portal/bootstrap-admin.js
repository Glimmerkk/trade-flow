
'use strict';

const {
  modify, id, hashPassword, iso, encrypt, secretKey
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

if (!username && !password) {
  console.log('Admin bootstrap not configured.');
} else {
  secretKey();

  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error('Invalid admin username.');
  }

  if (password.length < 14) {
    throw new Error('Password must be at least 14 characters.');
  }

  if (Boolean(botToken) !== Boolean(chatId)) {
    throw new Error('Set both Telegram environment variables.');
  }

  if (
    botToken &&
    !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)
  ) {
    throw new Error('Invalid Telegram bot token.');
  }

  if (
    chatId &&
    !/^\d{1,20}$/.test(chatId)
  ) {
    throw new Error('Invalid private Telegram chat ID.');
  }

  const result = modify(data => {
    let admin = data.admins.find(
      a => a.username === username
    );

    let action;

    if (admin) {
      admin.passwordHash = hashPassword(password);
      admin.active = true;

      data.sessions = data.sessions.filter(
        s => s.adminId !== admin.id
      );

      action = 'updated';
    } else {
      admin = {
        id: id(),
        username,
        passwordHash: hashPassword(password),
        botTokenEnc: null,
        chatIdEnc: null,
        createdAt: iso(),
        active: true
      };

      data.admins.push(admin);
      action = 'created';
    }

    if (botToken) {
      admin.botTokenEnc = encrypt(botToken);
      admin.chatIdEnc = encrypt(chatId);
    }

    return action;
  });

  console.log('TradeFlow admin account ' + result);

  console.log(
    botToken
      ? 'Telegram configured for this admin.'
      : 'Telegram credentials not provided.'
  );
}
