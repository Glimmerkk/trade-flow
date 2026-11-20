'use strict';

const { modify, id, hashPassword, iso } = require('./lib');

const username = String(process.env.TF_ADMIN_USERNAME || '')
  .trim()
  .toLowerCase();

const password = process.env.TF_ADMIN_PASSWORD || '';

if (!username && !password) {
  console.log('Admin bootstrap not configured.');
} else {
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    throw new Error('Invalid admin username.');
  }

  if (password.length < 14) {
    throw new Error('Password must contain at least 14 characters.');
  }

  const result = modify(data => {
    const admin = data.admins.find(
      a => a.username === username
    );

    if (admin) {
      admin.passwordHash = hashPassword(password);
      admin.active = true;
      data.sessions = data.sessions.filter(
        s => s.adminId !== admin.id
      );
      return 'updated';
    }

    data.admins.push({
      id: id(),
      username,
      passwordHash: hashPassword(password),
      botTokenEnc: null,
      chatIdEnc: null,
      createdAt: iso(),
      active: true
    });

    return 'created';
  });

  console.log('TradeFlow admin account ' + result + ': ' + username);
}
