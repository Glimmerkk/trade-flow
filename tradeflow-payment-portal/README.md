# TradeFlow — trade payment confirmation website

A small, independent payment **instruction-confirmation portal**. It does **not** transfer funds, connect to exchanges, prove that a payment has settled, or sign into Binance, Bybit, or Skrill.

## Features

- Admin login with individually assigned passwords and **transaction isolation per admin**.
- Create a request using platform (Skrill / Binance / Bybit), bank, trade ID, transaction ID, amount, and currency.
- Supports currencies listed in Node's `Intl.supportedValuesOf('currency')`, plus USDT, USDC, BTC, ETH, and BNB.
- Generates a random private URL. The client enters the separately agreed trade-chat reference; there is **no generated or pre-matched promo code** in the admin panel.
- Client flow: **open → accept/reject → email or phone → enter your trade-chat reference → WAIT for administrator review → report 2FA enabled/disabled → confirm**. A rejected reference may be resubmitted.
- Separate client-page color themes: **Skrill-inspired purple; Binance-inspired black/yellow; Bybit-inspired navy/orange**. Distinct TradeFlow branding prevents misrepresentation as an official platform.
- **Telegram notification on every completed step**, including opening the link, selecting a decision, entering contact, submitting the trade reference, the admin approval/rejection decision, reporting 2FA status, and final confirmation. Pending references include working Approve / Reject inline buttons.
- Client contact is masked before saving and notifying. The client-submitted **trade reference** is encrypted at rest and shown in the assigned admin’s private Telegram chat for manual comparison with the original trade conversation. Third-party passwords, login 2FA codes, and recovery codes must **never** be entered in this portal.
- Admin dashboard showing activity and delivery statuses, print / Save PDF through the browser, per-admin Telegram bot configuration, plus a backup Approve / Reject control for pending references.
- Single-node, zero-NPM-dependency Node.js server (Node.js **20+**).

## Get started on Windows (PowerShell)

1. Install Node.js 20 or newer, if not already installed. Unzip the project.
2. **Easiest on Windows:** double-click `FIRST_TIME_SETUP_WINDOWS.bat` in the extracted folder. This creates the secret, helps you create an administrator, and starts the server.

   **Or use PowerShell** in the folder containing `package.json`:

   ```powershell
   cd "C:\Users\YOURNAME\Downloads\tradeflow-payment-portal"
   npm run setup
   npm run add-admin
   npm start
   ```

3. Open **http://localhost:3000/admin** and sign in using the admin username/password created in the previous step.
4. Enter the transaction details and click **Generate payment link**.
5. Share the **private client link** with the intended client. Agree a **trade reference** through the official trade chat (not a login OTP or account credential). Do **not** enter the reference in the admin panel.
6. When a client submits the reference, the assigned admin receives **Approve / Reject buttons in Telegram**. The client must wait for approval before the 2FA-status question. Rejecting lets the client submit again. Admin dashboard approval is a backup if Telegram is unavailable. Each step triggers an alert.

For later launches, double-click `START_WEBSITE_WINDOWS.bat`.

To add another admin, leave the server running or stop it, and execute this in a **second** PowerShell window:

```powershell
npm run add-admin
```

Each admin has a unique username/password, independent transactions, and a private Telegram bot destination.

## Telegram bot setup

1. In Telegram, start a conversation with the verified `@BotFather` and create a new bot using `/newbot`.
2. Copy the bot token. **Do not put the token in customer-facing pages or share it publicly.**
3. Open the bot you created and send it `/start` in the Telegram chat where you want notifications.
4. Get your **personal private chat ID**. Send `/start` to your bot first. For **Approve / Reject**, the bot must send the request to your own private Telegram chat. Group chat IDs are *not* authorized to make approval decisions, because other group members could press the buttons. If using a shared bot, each admin must have a different private chat ID.
5. When `npm run add-admin` asks for a bot token and chat ID, enter them. If you skipped them when creating the admin, run:

   ```powershell
   npm run set-telegram
   ```

6. Create your first trade and press **Send test Telegram alert** in the admin dashboard. Telegram delivery status will show `sent`, `failed`, or `unconfigured` in the activity log.

**One bot per admin:** Create one bot/token/private-chat-ID pair per admin for separate destinations. Shared bots with separate private chat IDs are also supported. The server polls Telegram for button responses, so your website can be running on localhost; the Telegram bot does not need a public webhook.

## Make the links work for clients outside your computer

`localhost` URLs only work on the computer running the site. Before giving links to clients, you must deploy to a public server with an HTTPS domain and persistent disk. Set these in `.env`:

```ini
PORT=3000
PUBLIC_BASE_URL=https://your-own-domain.example
APP_SECRET=your_generated_64_hex_character_secret
```

**Do not replace APP_SECRET** after creating accounts or trades or encrypted bot tokens, private links, and pending trade references will no longer decrypt. The APP_SECRET is created automatically by setup and should be backed up securely.

Use a reverse proxy such as Caddy or Nginx for HTTPS. Host the app as **one Node.js process** with the `data/` directory on persistent storage. Restrict access to `.env` and `data/`, maintain backups, and keep the Node runtime patched. This JSON-file database is for a small single-server deployment; if you scale to multiple Node instances, move to a proper database with row-level admin authorization and durable notification jobs.

## Data and security

- **Admins authenticate to TradeFlow**, not to a financial service.
- **Clients do not enter a Skrill, Binance or Bybit password or 2FA code.** The 2FA step only records the client's own statement that 2FA is enabled or disabled; it is **not independently verified**.
- Client email/phone is validated, **masked**, and only the masked value is stored or sent to Telegram.
- The trade reference is chosen outside this portal. There is no admin-code match. When a client submits one, it is encrypted at rest and shown to the assigned administrator through Telegram for manual review. The encrypted reference is erased after approval or rejection. Only a partial reference is shown on the dashboard and client waiting screen.
- Client links are secret, high-entropy, and expire after the chosen period. Avoid publishing them publicly.
- Admin credentials use salted scrypt hashes. Bot tokens and pending trade references are encrypted at rest with the `.env` secret.
- There are login and reference-submission rate limits and secure session cookies (with Secure flag for HTTPS). A reference cannot reach the 2FA-status screen until its current submission has been approved by the assigned administrator.
- Event notifications are attempted immediately. The dashboard retains delivery statuses. If Telegram delivery fails, the client waits at the pending review screen until the assigned admin approves/rejects from the dashboard. The starter does not retry failed Telegram messages automatically. For Telegram button authorization, configure the numeric private chat ID matching the admin who clicks the buttons.
- All third-party platform names describe the **user-selected trade platform**. This is not a provider-branded login, payment guarantee, bank receipt or proof of settlement.

## Payment statuses

`Accept` means **the client accepted the instruction**; `Reject` means **the client rejected it**. Neither action sends, receives, authorizes, cancels or confirms a real transfer. Actual payment settlement must be verified separately via the corresponding official payment provider or authorized API integration.

## Troubleshooting

- **Cannot log in?** Run `npm run add-admin`, remember the unique admin password, and use the matching username.
- **Telegram not delivering?** Verify the bot token, chat ID, that you sent `/start` to your bot, the server's internet access, and the delivery status in the activity log.
- **Client cannot open the link?** `http://localhost:3000/` is accessible only from the host computer. Use public HTTPS hosting and update `PUBLIC_BASE_URL`.
- **PowerShell says scripts are disabled?** Run `node setup.js`, `node add-admin.js`, and `node server.js` directly; no `npm install` is needed.
- **Run automated local checks:** `npm test`.

## Updating an existing installation (keep your settings and transactions)

1. Extract the **new** ZIP into a separate folder on your Desktop. **Do not extract over the original installation.**
2. Stop the original website with **Ctrl+C** in its terminal.
3. In the new extracted folder, double-click **`UPDATE_EXISTING_WINDOWS.bat`**. It locates the previous TradeFlow installation on your Desktop, asks you to confirm the target, creates a dated backup, and copies only application source files. Your original `.env` and `data/` directory remain untouched.
4. Start your original website again using `node server.js`. If you have not yet configured Telegram for your admin, run `node set-telegram.js` in the website folder before starting.

If you prefer PowerShell, execute `powershell -ExecutionPolicy Bypass -File .\UPDATE_EXISTING_WINDOWS.ps1` from the new extracted folder. Never share your `.env`, private Telegram token, or `data/` directory.

Existing links and transactions are retained. A transaction that previously passed the **old automatic promo-code check** but has not yet reached the 2FA-status step is reset to reference submission, ensuring manual approval happens before that step. Completed transactions remain unchanged.

© TradeFlow — Independent trade payment instruction confirmation tool.
