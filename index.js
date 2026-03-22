require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, createBotDb, getAllBots, getActiveBots, getBotRowById, createBotRow, updateBotRow, deleteBotRow } = require('./lib/db');
const { verifyInitData, parseAmountFromText } = require('./lib/telegram-initdata');
const { verifySpinToken } = require('./lib/spin-token');
const createBotInstance = require('./lib/bot-instance');
const { createApiClient, signIn: ichancySignIn, apiRequest: ichancyApiRequest } = require('./lib/ichancy-api');

// ── Admin credentials from .env ──────────────────────────────────────
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'admin').trim();
const WEB_PORT = parseInt(process.env.WEB_PORT || process.env.WEBHOOK_PORT || '3000', 10) || 3000;
const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true' || process.env.USE_WEBHOOK === '1';
// WEBHOOK_DOMAIN = bare hostname, e.g. "yourdomain.com"
// SPIN_SITE_URL  = full URL,   e.g. "https://yourdomain.com"
// Either one is enough — the other is derived automatically.
const _spinSiteRaw = (process.env.SPIN_SITE_URL || '').trim().replace(/\/$/, '');
const _webhookDomainRaw = (process.env.WEBHOOK_DOMAIN || '').trim().replace(/\/$/, '');
// Derive WEBHOOK_DOMAIN from SPIN_SITE_URL if not explicitly set
const WEBHOOK_DOMAIN = _webhookDomainRaw || (_spinSiteRaw ? _spinSiteRaw.replace(/^https?:\/\//, '') : '');
// Derive the canonical public base URL (always https in production)
const PUBLIC_BASE_URL = _spinSiteRaw || (WEBHOOK_DOMAIN ? `https://${WEBHOOK_DOMAIN}` : '');

// ── Session store ────────────────────────────────────────────────────
const sessions = new Map();
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}
function isValidSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() - s.createdAt > 24 * 60 * 60 * 1000) { sessions.delete(token); return false; }
  return true;
}
function authMiddleware(req, res, next) {
  const token = req.cookies?.session;
  if (!isValidSession(token)) return res.redirect('/admin/login');
  next();
}

// ── Running bot instances ────────────────────────────────────────────
const runningBots = new Map();

async function startBot(botRow) {
  if (runningBots.has(botRow.bot_id)) return { ok: true, msg: 'Already running' };
  const db = createBotDb(botRow.bot_id);
  const instance = createBotInstance(botRow, db, createApiClient);
  const options = {};
  if (USE_WEBHOOK && WEBHOOK_DOMAIN) {
    options.webhookDomain = WEBHOOK_DOMAIN;
    options.webhookPath = `/webhook/${encodeURIComponent(botRow.bot_id)}`;
  }
  options.spinBaseUrl = (PUBLIC_BASE_URL || `http://localhost:${WEB_PORT}`).replace(/\/$/, '');
  try {
    const ok = await instance.start(options);
    if (ok) {
      runningBots.set(botRow.bot_id, instance);
      return { ok: true, msg: 'Started' };
    }
    return { ok: false, msg: 'start() returned false (check logs)' };
  } catch (err) {
    console.error(`[Launcher] Failed to start bot ${botRow.bot_id}:`, err.message);
    return { ok: false, msg: err.message };
  }
}

async function stopBot(botId) {
  const instance = runningBots.get(botId);
  if (!instance) return false;
  await instance.stop();
  runningBots.delete(botId);
  console.log(`[Launcher] Stopped bot: ${botId}`);
  return true;
}

// ── Cookie parser (minimal) ──────────────────────────────────────────
function cookieParser(req, _res, next) {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
}

// ── HTML helpers ─────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function flashCookie(msg) { return `flash=${encodeURIComponent(msg)}; Path=/; HttpOnly; Max-Age=5`; }

function layout(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Bot Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:1000px;margin:0 auto;padding:24px}
.card{background:#1e293b;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #334155}
h1{font-size:1.8rem;margin-bottom:16px;color:#f8fafc}
h2{font-size:1.3rem;margin-bottom:12px;color:#f1f5f9}
h3{font-size:1rem;margin-bottom:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
.btn{display:inline-block;padding:8px 20px;border-radius:8px;border:none;font-size:.9rem;cursor:pointer;font-weight:600;transition:all .15s}
.btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
.btn-success{background:#22c55e;color:#fff}.btn-success:hover{background:#16a34a}
.btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
.btn-warning{background:#f59e0b;color:#000}.btn-warning:hover{background:#d97706}
.btn-secondary{background:#475569;color:#e2e8f0}.btn-secondary:hover{background:#334155}
.btn-sm{padding:5px 12px;font-size:.8rem}
input,select,textarea{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:.95rem;margin-bottom:12px}
input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6}
label{display:block;margin-bottom:4px;font-weight:600;color:#94a3b8;font-size:.85rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700}
.badge-green{background:#166534;color:#4ade80}.badge-red{background:#7f1d1d;color:#fca5a5}
.badge-yellow{background:#713f12;color:#fbbf24}.badge-blue{background:#1e3a5f;color:#60a5fa}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #334155}
th{color:#94a3b8;font-size:.8rem;text-transform:uppercase}
tr:last-child td{border-bottom:none}
.flash{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600}
.flash-ok{background:#14532d;color:#86efac;border:1px solid #166534}
.flash-err{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{width:380px}
.actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.section-divider{border:none;border-top:1px solid #334155;margin:20px 0}
.pw-wrap{position:relative}
.pw-wrap input{padding-right:42px;margin-bottom:12px}
.pw-toggle{position:absolute;right:12px;top:10px;background:none;border:none;color:#64748b;cursor:pointer;font-size:.85rem;padding:0}
.pw-toggle:hover{color:#94a3b8}
.stat-card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 20px;text-align:center}
.stat-num{font-size:2rem;font-weight:700;color:#f8fafc}
.stat-lbl{font-size:.8rem;color:#64748b;text-transform:uppercase;margin-top:2px}
.info-box{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 14px;font-family:monospace;font-size:.85rem;color:#94a3b8;margin-bottom:12px;word-break:break-all}
nav{display:flex;align-items:center;gap:8px;margin-bottom:20px;font-size:.9rem;color:#64748b}
nav a{color:#60a5fa}nav span{color:#475569}
</style>
<script>
function confirmAction(msg,form){if(confirm(msg)){form.submit();}return false;}
function togglePw(btn){var inp=btn.previousElementSibling;inp.type=inp.type==='password'?'text':'password';btn.textContent=inp.type==='password'?'Show':'Hide';}
</script>
</head><body>${body}</body></html>`;
}

// ── Bot form fields ──────────────────────────────────────────────────
const BOT_FIELDS = [
  // Identity
  { key: 'bot_id', label: 'Bot ID', type: 'text', editDisabled: true, createHidden: true },
  { key: 'bot_token', label: 'Bot Token', type: 'text', required: true },
  { key: 'bot_username', label: 'Bot Username (e.g. @mybot)', type: 'text', required: true },
  { key: 'bot_display_name', label: 'Display Name', type: 'text' },
  { key: 'username_prefix', label: 'Username Prefix (for new Ichancy accounts, e.g. Bot-)', type: 'text' },
  // Telegram
  { key: 'channel_username', label: 'Channel Username (e.g. @channel)', type: 'text' },
  { key: 'admin_username', label: 'Admin Username(s) (comma-separated, without @)', type: 'text' },
  { key: 'alert_channel_accounts', label: 'Alert User Accounts Create Channel ID', type: 'text', hint: 'Must start with -100. Will be auto-prefixed if needed.' },
  { key: 'alert_channel_transactions', label: 'Alert Transaction Channel ID', type: 'text', hint: 'Must start with -100. Will be auto-prefixed if needed.' },
  // Ichancy API
  { key: 'ichancy_agent_username', label: 'Ichancy Agent Username', type: 'text' },
  { key: 'ichancy_agent_password', label: 'Ichancy Agent Password', type: 'password' },
  { key: 'ichancy_parent_id', label: 'Ichancy Parent ID', type: 'text' },
  // Support
  { key: 'support_username', label: 'Support Telegram Username', type: 'text', editOnly: true },
  { key: 'support_whatsapp_number', label: 'Support WhatsApp Number', type: 'text', editOnly: true },
  { key: 'support_telegram_enabled', label: 'Support Telegram Enabled', type: 'stringCheckbox', editOnly: true },
  { key: 'support_whatsapp_enabled', label: 'Support WhatsApp Enabled', type: 'stringCheckbox', editOnly: true },
  // Settings
  { key: 'exchange_rate_syp_per_usd', label: 'Exchange Rate (SYP per USD)', type: 'number', editOnly: true },
  { key: 'timezone', label: 'Timezone', type: 'text', editOnly: true },
  { key: 'deposit_required_ls', label: 'Minimum Deposit (LS)', type: 'number', editOnly: true },
  { key: 'active_referrals_required', label: 'Active Referrals Required', type: 'number', editOnly: true },
  { key: 'referral_level1_percent', label: 'Referral Level 1 %', type: 'number', editOnly: true },
  { key: 'referral_level2_percent', label: 'Referral Level 2 %', type: 'number', editOnly: true },
  { key: 'referral_level3_percent', label: 'Referral Level 3 %', type: 'number', editOnly: true },
  // Payment - Syriatel
  { key: 'syriatel_api_key', label: 'Syriatel API Key', type: 'password' },
  { key: 'syriatel_pin', label: 'Syriatel PIN', type: 'password', editOnly: true },
  { key: 'deposit_syriatel_enabled', label: 'Deposit Syriatel', type: 'checkbox', editOnly: true },
  { key: 'withdraw_syriatel_enabled', label: 'Withdraw Syriatel', type: 'checkbox', editOnly: true },
  { key: 'syriatel_low_balance_alert_enabled', label: 'Low Balance Alert', type: 'checkbox', editOnly: true },
  { key: 'syriatel_low_balance_threshold', label: 'Low Balance Threshold', type: 'number', editOnly: true },
  { key: 'syriatel_tx_fail_balance_alert_enabled', label: 'TX Fail Balance Alert', type: 'checkbox', editOnly: true },
  // iChancy Alert
  { key: 'ichancy_low_balance_alert_enabled', label: 'iChancy Low Balance Alert', type: 'checkbox', editOnly: true },
  { key: 'ichancy_low_balance_threshold', label: 'iChancy Low Balance Threshold', type: 'number', editOnly: true },
  // Payment - ShamCash
  { key: 'sham_cash_deposit_code', label: 'ShamCash Deposit Code', type: 'text' },
  { key: 'deposit_shamcash_enabled', label: 'Deposit ShamCash', type: 'checkbox', editOnly: true },
  { key: 'withdraw_shamcash_enabled', label: 'Withdraw ShamCash', type: 'checkbox', editOnly: true },
  // Payment - OxaPay
  { key: 'oxapay_merchant_api_key', label: 'OxaPay Merchant API Key', type: 'password' },
  { key: 'deposit_oxapay_enabled', label: 'Deposit OxaPay', type: 'checkbox', editOnly: true },
  { key: 'withdraw_oxapay_enabled', label: 'Withdraw OxaPay', type: 'checkbox', editOnly: true },
  // Options
  { key: 'is_active', label: 'Active', type: 'checkbox', hint: 'When enabled, the bot process will start and respond to users. When disabled, the bot will not run at all.' },
  { key: 'bot_off', label: 'Bot Off', type: 'checkbox', hint: 'When enabled, the bot stays running but responds with "Bot is temporarily paused" to all non-admin users. Admins can still use the bot normally.' },
  { key: 'debug_mode', label: 'Debug Mode', type: 'checkbox' },
  { key: 'debug_logs', label: 'Debug Logs', type: 'checkbox' },
];

function renderBotForm(bot, isEdit) {
  let html = '';
  const groups = [
    { label: 'Identity', keys: ['bot_id', 'bot_token', 'bot_username', 'bot_display_name', 'username_prefix'] },
    { label: 'Telegram', keys: ['channel_username', 'admin_username', 'alert_channel_accounts', 'alert_channel_transactions'] },
    { label: 'Ichancy API', keys: ['ichancy_agent_username', 'ichancy_agent_password', 'ichancy_parent_id'] },
    { label: 'Support', keys: ['support_username', 'support_whatsapp_number', 'support_telegram_enabled', 'support_whatsapp_enabled'] },
    { label: 'Settings', keys: ['exchange_rate_syp_per_usd', 'timezone', 'deposit_required_ls', 'active_referrals_required', 'referral_level1_percent', 'referral_level2_percent', 'referral_level3_percent'] },
    { label: 'Syriatel Payment', keys: ['syriatel_api_key', 'syriatel_pin', 'deposit_syriatel_enabled', 'withdraw_syriatel_enabled', 'syriatel_low_balance_alert_enabled', 'syriatel_low_balance_threshold', 'syriatel_tx_fail_balance_alert_enabled'] },
    { label: 'ShamCash Payment', keys: ['sham_cash_deposit_code', 'deposit_shamcash_enabled', 'withdraw_shamcash_enabled'] },
    { label: 'OxaPay (Crypto)', keys: ['oxapay_merchant_api_key', 'deposit_oxapay_enabled', 'withdraw_oxapay_enabled'] },
    { label: 'Options', keys: ['is_active', 'bot_off', 'debug_mode', 'debug_logs'] },
  ];

  const fieldMap = Object.fromEntries(BOT_FIELDS.map(f => [f.key, f]));
  let first = true;
  for (const group of groups) {
    // Check if any field in this group is visible
    const visibleKeys = group.keys.filter(key => {
      const f = fieldMap[key];
      if (!f) return false;
      if (f.createHidden && !isEdit) return false;
      if (f.editOnly && !isEdit) return false;
      return true;
    });
    if (visibleKeys.length === 0) continue;
    if (!first) html += '<hr class="section-divider">';
    first = false;
    html += `<h3>${group.label}</h3>`;
    for (const key of visibleKeys) {
      const f = fieldMap[key];
      const val = bot[f.key] ?? '';
      if (f.type === 'checkbox') {
        const checked = val ? 'checked' : '';
        html += `<label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer"><input type="checkbox" name="${f.key}" value="1" ${checked} style="width:auto;margin:0"> <span style="color:#e2e8f0;font-size:.95rem;font-weight:500">${esc(f.label)}</span></label>`;
        if (f.hint) html += `<p style="color:#64748b;font-size:.8rem;margin:0 0 14px 28px">${esc(f.hint)}</p>`;
      } else if (f.type === 'stringCheckbox') {
        const checked = String(val) === 'true' ? 'checked' : '';
        html += `<label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer"><input type="checkbox" name="${f.key}" value="1" ${checked} style="width:auto;margin:0"> <span style="color:#e2e8f0;font-size:.95rem;font-weight:500">${esc(f.label)}</span></label>`;
        if (f.hint) html += `<p style="color:#64748b;font-size:.8rem;margin:0 0 14px 28px">${esc(f.hint)}</p>`;
      } else if (f.type === 'password') {
        const disabled = isEdit && f.editDisabled ? 'disabled' : '';
        const req = f.required && !isEdit ? 'required' : '';
        html += `<label>${esc(f.label)}</label><div class="pw-wrap"><input type="password" name="${f.key}" value="${esc(val)}" ${disabled} ${req} autocomplete="new-password"><button type="button" class="pw-toggle" onclick="togglePw(this)">Show</button></div>`;
        if (isEdit && f.editDisabled) html += `<input type="hidden" name="${f.key}" value="${esc(val)}">`;
      } else if (f.type === 'number') {
        html += `<label>${esc(f.label)}</label><input type="number" step="any" name="${f.key}" value="${esc(String(val))}">`;
        if (f.hint) html += `<p style="color:#64748b;font-size:.8rem;margin:-8px 0 12px 0">${esc(f.hint)}</p>`;
      } else {
        const disabled = isEdit && f.editDisabled ? 'disabled' : '';
        const req = f.required && !isEdit ? 'required' : '';
        html += `<label>${esc(f.label)}</label><input type="${f.type}" name="${f.key}" value="${esc(val)}" ${disabled} ${req}>`;
        if (isEdit && f.editDisabled) html += `<input type="hidden" name="${f.key}" value="${esc(val)}">`;
        if (f.hint) html += `<p style="color:#64748b;font-size:.8rem;margin:-8px 0 12px 0">${esc(f.hint)}</p>`;
      }
      // Add Fetch ID button after ichancy_parent_id field
      if (key === 'ichancy_parent_id') {
        html += `<button type="button" class="btn btn-secondary btn-sm" id="fetchParentIdBtn" onclick="fetchParentId(this)" style="margin:-4px 0 12px 0">Fetch ID</button>`;
      }
    }
  }

  // Client-side JS for auto-formatting
  html += `<script>
(function() {
  var usernameInput = document.querySelector('input[name="bot_username"]');
  var displayInput = document.querySelector('input[name="bot_display_name"]');
  if (usernameInput && displayInput) {
    // In edit mode, mark display name as user-edited if it already has a value
    if (displayInput.value.trim()) { displayInput.dataset.userEdited = '1'; }
    usernameInput.addEventListener('blur', function() {
      var val = usernameInput.value.trim();
      if (val && !val.startsWith('@')) { usernameInput.value = '@' + val; val = '@' + val; }
      if (!displayInput.dataset.userEdited) {
        displayInput.value = val.replace(/^@/, '').replace(/-/g, ' ').replace(/_/g, ' ');
      }
    });
    displayInput.addEventListener('input', function() { displayInput.dataset.userEdited = '1'; });
  }
  var channelInput = document.querySelector('input[name="channel_username"]');
  if (channelInput) {
    channelInput.addEventListener('blur', function() {
      var val = channelInput.value.trim();
      if (val && !val.startsWith('@')) { channelInput.value = '@' + val; }
    });
  }
  ['alert_channel_accounts','alert_channel_transactions'].forEach(function(name) {
    var input = document.querySelector('input[name="' + name + '"]');
    if (input) {
      input.addEventListener('blur', function() {
        var val = input.value.trim();
        if (!val) return;
        val = val.replace(/[^0-9]/g, '');
        if (!val) { input.value = ''; return; }
        if (val.startsWith('100')) { input.value = '-' + val; }
        else { input.value = '-100' + val; }
      });
    }
  });
})();
async function fetchParentId(btn) {
  var username = document.querySelector('input[name="ichancy_agent_username"]').value.trim();
  var pwInput = document.querySelector('input[name="ichancy_agent_password"]');
  var password = pwInput ? pwInput.value.trim() : '';
  if (!username || !password) { alert('Please enter Agent Username and Password first'); return; }
  btn.disabled = true; btn.textContent = 'Fetching...';
  try {
    var res = await fetch('/admin/api/fetch-parent-id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    var data = await res.json();
    if (data.success) {
      document.querySelector('input[name="ichancy_parent_id"]').value = data.parentId;
    } else { alert('Failed: ' + (data.error || 'Unknown error')); }
  } catch (err) { alert('Error: ' + err.message); }
  btn.disabled = false; btn.textContent = 'Fetch ID';
}
</script>`;
  return html;
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('[Launcher] Initializing database...');
    await initDb();
    console.log('[Launcher] Database ready.');

    const app = express();

    // ── OxaPay webhook (must be BEFORE express.json() to capture raw body for HMAC) ──
    const { verifyWebhookSignature: verifyOxapaySignature } = require('./lib/oxapay-api');
    app.post('/oxapay-webhook/:botId',
      express.raw({ type: 'application/json' }),
      async (req, res) => {
        try {
          const botId = req.params.botId;
          const rawBody = req.body; // Buffer (from express.raw)
          const hmacHeader = (req.headers['hmac'] || '').toLowerCase();

          const botRow = await getBotRowById(botId);
          if (!botRow || !botRow.oxapay_merchant_api_key) {
            return res.status(200).send('ok');
          }

          const isValid = verifyOxapaySignature(rawBody, hmacHeader, botRow.oxapay_merchant_api_key);
          if (!isValid) {
            console.warn(`[OxaPay Webhook] Invalid signature for bot ${botId}`);
            return res.status(400).send('invalid signature');
          }

          let data;
          try { data = JSON.parse(rawBody.toString()); } catch (_) {
            return res.status(400).send('invalid json');
          }

          const status = (data.status || data.Status || '').toLowerCase();
          const trackId = data.track_id || data.trackId;
          if (!trackId || status !== 'paid') {
            return res.status(200).send('ok');
          }

          const instance = runningBots.get(botId);
          if (instance && typeof instance.handleOxapayWebhook === 'function') {
            instance.handleOxapayWebhook(trackId, data).catch(err =>
              console.warn(`[OxaPay Webhook] handleOxapayWebhook error for bot ${botId}:`, err.message)
            );
          }

          res.status(200).send('ok');
        } catch (err) {
          console.error('[OxaPay Webhook] Error:', err.message);
          res.status(200).send('ok'); // always 200 to prevent OxaPay retries on our errors
        }
      }
    );

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser);

    // ── Static: logo, public (Winwheel, gsap) ──
    const logoDir = path.join(__dirname, 'logo');
    if (fs.existsSync(logoDir)) app.use('/logo', express.static(logoDir));
    const publicDir = path.join(__dirname, 'public');
    if (fs.existsSync(publicDir)) app.use('/static', express.static(publicDir));

    // ── Health ──
    app.get('/health', (_req, res) => res.send('ok'));

    // ── Spin API ──
    app.get('/api/spin/config', async (req, res) => {
      const botId = (req.query.bot_id || '').trim();
      const initData = (req.headers['x-telegram-init-data'] || req.query.init_data || '').trim();
      const spinToken = (req.query.spin_token || '').trim();
      if (!botId) {
        return res.status(400).json({ error: 'معرّف البوت مطلوب' });
      }
      const bot = await getBotRowById(botId);
      if (!bot || !bot.bot_token) {
        return res.status(404).json({ error: 'البوت غير موجود' });
      }
      let userId;
      if (spinToken) {
        const parsed = verifySpinToken(spinToken, bot.bot_token);
        if (!parsed) {
          return res.status(401).json({ error: 'رابط العجلة غير صالح أو منتهي. افتح من البوت مرة أخرى.' });
        }
        if (parsed.botId !== botId) {
          return res.status(401).json({ error: 'عدم تطابق الرابط مع البوت' });
        }
        userId = parsed.userId;
      } else if (initData) {
        const result = verifyInitData(initData, bot.bot_token);
        if (!result.valid) {
          return res.status(401).json({ error: 'بيانات التحقق غير صالحة' });
        }
        userId = result.payload?.user?.id;
        if (!userId) {
          return res.status(401).json({ error: 'المستخدم غير موجود في بيانات التحقق' });
        }
      } else {
        return res.status(400).json({ error: 'مطلوب رابط من البوت أو بيانات التحقق' });
      }
      const db = createBotDb(botId);
      const user = await db.getUserByTelegramId(userId);
      if (!user) {
        return res.status(403).json({ error: 'المستخدم غير موجود' });
      }
      await db.ensureDailySpinEligibility(userId);
      const userAfter = await db.getUserByTelegramId(userId);
      const spinsAvailable = Math.min(1, Number(userAfter?.wheel_spins_available_today ?? 0));
      if (spinsAvailable <= 0) {
        return res.status(403).json({ error: 'لا توجد لفات متاحة' });
      }
      const prizes = Array.isArray(bot.spin_prizes) && bot.spin_prizes.length > 0
        ? bot.spin_prizes
        : [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
      const baseUrl = PUBLIC_BASE_URL || `http://localhost:${WEB_PORT}`;
      res.json({
        prizes,
        user_id: userId,
        bot_id: botId,
        logo_url: `${baseUrl}/logo/${encodeURIComponent(botId)}.png`,
        spins_available: spinsAvailable,
      });
    });

    app.post('/api/spin/result', async (req, res) => {
      const { init_data, spin_token, bot_id, prize_index, text } = req.body || {};
      const initData = (init_data || '').trim();
      const spinToken = (spin_token || '').trim();
      const botId = (bot_id || '').trim();
      const idx = parseInt(prize_index, 10);
      if ((!initData && !spinToken) || !botId || !Number.isFinite(idx) || typeof text !== 'string') {
        return res.status(400).json({ error: 'طلب غير صالح' });
      }
      const bot = await getBotRowById(botId);
      if (!bot || !bot.bot_token) {
        return res.status(404).json({ error: 'البوت غير موجود' });
      }
      let userId;
      if (spinToken) {
        const parsed = verifySpinToken(spinToken, bot.bot_token);
        if (!parsed || parsed.botId !== botId) {
          return res.status(401).json({ error: 'رابط العجلة غير صالح أو منتهي' });
        }
        userId = parsed.userId;
      } else {
        const result = verifyInitData(initData, bot.bot_token);
        if (!result.valid) {
          return res.status(401).json({ error: 'بيانات التحقق غير صالحة' });
        }
        userId = result.payload?.user?.id;
        if (!userId) {
          return res.status(401).json({ error: 'المستخدم غير موجود في بيانات التحقق' });
        }
      }
      const prizes = Array.isArray(bot.spin_prizes) && bot.spin_prizes.length > 0
        ? bot.spin_prizes
        : [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
      const prize = prizes[idx];
      if (!prize || prize.text !== text) {
        return res.status(400).json({ error: 'الجائزة غير متطابقة' });
      }
      const amount = parseAmountFromText(text);
      const db = createBotDb(botId);
      const user = await db.getUserByTelegramId(userId);
      if (!user) {
        return res.status(403).json({ error: 'المستخدم غير موجود' });
      }
      const spinsAvailable = Number(user.wheel_spins_available_today ?? 0);
      if (spinsAvailable <= 0) {
        return res.status(403).json({ error: 'لا توجد لفات متاحة' });
      }
      try {
        const applied = await db.useSpinCredit(userId, amount);
        if (!applied) {
          return res.status(403).json({ error: 'لا توجد لفات متاحة أو تم استهلاكها' });
        }
        res.json({ ok: true, amount });
      } catch (err) {
        res.status(500).json({ error: 'فشل إضافة الرصيد' });
      }
    });

    // ── Centralized webhook routing (one route, delegates to running bot) ──
    app.post('/webhook/:botId', (req, res) => {
      const instance = runningBots.get(req.params.botId);
      if (!instance) return res.sendStatus(404);
      if (!req.body || typeof req.body !== 'object') return res.sendStatus(400);
      try { instance.processUpdate(req.body); } catch (err) { console.error(`[Webhook:${req.params.botId}]`, err.message); }
      res.sendStatus(200);
    });

    // ── Syriatel GSMS helper ──
    const SYRIATEL_API_BASE_URL = (process.env.SYRIATEL_API_BASE_URL || 'http://31.97.205.230:3009').replace(/\/$/, '');
    async function fetchSyriatelGsmsForBot(apiKey) {
      if (!apiKey) return { success: false };
      const url = `${SYRIATEL_API_BASE_URL}/gsms?apiKey=${encodeURIComponent(apiKey.trim())}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.success === true && Array.isArray(data.gsms)) return { success: true, gsms: data.gsms };
        return { success: false };
      } catch (err) {
        console.warn('[Launcher] fetchSyriatelGsms error:', err.message);
        return { success: false };
      }
    }

    // ── Sanitize helpers for form data ──
    function sanitizeChannelId(val) {
      val = String(val || '').trim();
      if (!val) return '';
      // Strip everything except digits
      val = val.replace(/[^0-9]/g, '');
      if (!val) return '';
      if (val.startsWith('100')) return '-' + val;
      return '-100' + val;
    }

    function sanitizeAdminUsernames(val) {
      return String(val || '').split(',').map(u => u.trim().replace(/^@/, '')).filter(Boolean).join(',');
    }

    function ensureAt(val) {
      val = String(val || '').trim();
      if (val && !val.startsWith('@')) return '@' + val;
      return val;
    }

    // ── Fetch Ichancy Parent ID API ──
    app.post('/admin/api/fetch-parent-id', authMiddleware, async (req, res) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.json({ success: false, error: 'Username and password required' });
        const login = await ichancySignIn(username.trim(), password.trim());
        if (!login.success) return res.json({ success: false, error: 'Login to Ichancy failed. Check credentials.' });
        // Try getChildren first
        try {
          const childrenRes = await ichancyApiRequest('Agent/getChildren', {
            start: 0, limit: 20,
            filter: { self: { action: '=', value: true, valueLabel: true } },
            isNextPage: false, searchBy: { agentChildrenList: '' }
          }, { cookies: login.cookies, referer: 'https://agents.ichancy.com/dashboard' });
          if (childrenRes.data && childrenRes.data.status === true && childrenRes.data.result &&
              Array.isArray(childrenRes.data.result.records) && childrenRes.data.result.records.length > 0) {
            const affiliateId = childrenRes.data.result.records[0].affiliateId;
            if (affiliateId) return res.json({ success: true, parentId: String(affiliateId) });
          }
        } catch (_) {}
        // Fallback: getData
        try {
          const dataRes = await ichancyApiRequest('core/getData', {}, {
            cookies: login.cookies, referer: 'https://agents.ichancy.com/'
          });
          if (dataRes.data && dataRes.data.status === true && dataRes.data.result && dataRes.data.result.app) {
            const app = dataRes.data.result.app;
            const parentId = (app.currentUser && app.currentUser.affiliateId) || app.currentUserId;
            if (parentId) return res.json({ success: true, parentId: String(parentId) });
          }
        } catch (_) {}
        return res.json({ success: false, error: 'Could not find parent ID from Ichancy API' });
      } catch (err) {
        return res.json({ success: false, error: err.message });
      }
    });

    // ── Login ──
    app.get('/admin/login', (_req, res) => {
      res.send(layout('Login', `
        <div class="login-wrap"><div class="login-box card">
          <h1 style="text-align:center">🤖 Bot Manager</h1>
          <form method="POST" action="/admin/login" style="margin-top:20px">
            <label>Username</label><input type="text" name="username" required autofocus>
            <label>Password</label><input type="password" name="password" required>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px">Login</button>
          </form>
        </div></div>`));
    });

    app.post('/admin/login', (req, res) => {
      if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
        const token = createSession();
        res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        return res.redirect('/admin');
      }
      res.send(layout('Login', `
        <div class="login-wrap"><div class="login-box card">
          <h1 style="text-align:center">🤖 Bot Manager</h1>
          <div class="flash flash-err">Invalid username or password</div>
          <form method="POST" action="/admin/login" style="margin-top:12px">
            <label>Username</label><input type="text" name="username" required autofocus>
            <label>Password</label><input type="password" name="password" required>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px">Login</button>
          </form>
        </div></div>`));
    });

    app.get('/admin/logout', (_req, res) => {
      res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
      res.redirect('/admin/login');
    });

    // ── Dashboard ──
    app.get('/admin', authMiddleware, async (_req, res) => {
      const flash = _req.cookies?.flash || '';
      res.setHeader('Set-Cookie', 'flash=; Path=/; HttpOnly; Max-Age=0');
      const bots = await getAllBots();
      const totalBots = bots.length;
      const runningCount = bots.filter(b => runningBots.has(b.bot_id)).length;
      const activeCount = bots.filter(b => b.is_active).length;
      let rows = '';
      for (const b of bots) {
        const isRunning = runningBots.has(b.bot_id);
        const statusBadge = !b.is_active
          ? '<span class="badge badge-red">Inactive</span>'
          : isRunning
            ? '<span class="badge badge-green">Running</span>'
            : '<span class="badge badge-yellow">Stopped</span>';
        const botOffBadge = b.bot_off ? '<span class="badge" style="background:#713f12;color:#fbbf24;font-size:.7rem">Bot Off</span>' : '';
        const modeBadge = USE_WEBHOOK
          ? '<span class="badge badge-blue" style="font-size:.7rem">Webhook</span>'
          : '<span class="badge" style="background:#1e3a2f;color:#4ade80;font-size:.7rem">Polling</span>';
        const webhookPath = USE_WEBHOOK && isRunning ? `<br><small style="color:#475569;font-family:monospace">/webhook/${esc(b.bot_id)}</small>` : '';
        rows += `<tr>
          <td><strong>${esc(b.bot_display_name || b.bot_id)}</strong><br><small style="color:#64748b">${esc(b.bot_id)}</small>${webhookPath}</td>
          <td style="color:#94a3b8">${esc(b.bot_username || '—')}</td>
          <td>${statusBadge} ${botOffBadge} ${modeBadge}</td>
          <td class="actions">
            <a href="/admin/bots/${encodeURIComponent(b.bot_id)}" class="btn btn-primary btn-sm">Edit</a>
            ${b.is_active && !isRunning ? `<form method="POST" action="/admin/bots/${encodeURIComponent(b.bot_id)}/start" style="display:inline"><button class="btn btn-success btn-sm">Start</button></form>` : ''}
            ${isRunning ? `<form method="POST" action="/admin/bots/${encodeURIComponent(b.bot_id)}/restart" style="display:inline"><button class="btn btn-secondary btn-sm">Restart</button></form>` : ''}
            ${isRunning ? `<form method="POST" action="/admin/bots/${encodeURIComponent(b.bot_id)}/stop" style="display:inline" onsubmit="return confirmAction('Stop bot ${esc(b.bot_display_name || b.bot_id)}?',this)"><button class="btn btn-warning btn-sm">Stop</button></form>` : ''}
          </td>
        </tr>`;
      }
      const modeInfo = USE_WEBHOOK
        ? `<div class="card" style="border-color:#1e3a5f"><h3 style="color:#60a5fa">Webhook Mode</h3><p style="color:#94a3b8;margin-bottom:8px">Base URL: <strong style="color:#e2e8f0">${esc(PUBLIC_BASE_URL || WEBHOOK_DOMAIN)}</strong></p><p style="color:#64748b;font-size:.85rem">Each bot receives updates at <code>${esc(PUBLIC_BASE_URL || `https://${WEBHOOK_DOMAIN}`)}/webhook/&lt;bot_id&gt;</code></p></div>`
        : `<div class="card" style="border-color:#1e3a2f"><h3 style="color:#4ade80">Polling Mode</h3><p style="color:#94a3b8">Each bot uses long-polling to receive updates from Telegram.</p></div>`;
      res.send(layout('Dashboard', `<div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h1>Bot Manager</h1>
          <div style="display:flex;gap:8px"><a href="/admin/bots/new" class="btn btn-success">+ Add Bot</a><a href="/admin/logout" class="btn btn-danger btn-sm">Logout</a></div>
        </div>
        ${flash ? `<div class="flash ${flash.startsWith('Error') ? 'flash-err' : 'flash-ok'}">${esc(flash)}</div>` : ''}
        <div class="grid-3" style="margin-bottom:20px">
          <div class="stat-card"><div class="stat-num">${totalBots}</div><div class="stat-lbl">Total Bots</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#4ade80">${runningCount}</div><div class="stat-lbl">Running</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#60a5fa">${activeCount}</div><div class="stat-lbl">Active</div></div>
        </div>
        <div class="card">
          <h2>All Bots</h2>
          <table><thead><tr><th>Bot</th><th>Username</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:32px">No bots yet. Click "+ Add Bot" to create one.</td></tr>'}</tbody></table>
        </div>
        ${modeInfo}
      </div>`));
    });

    // ── New bot ──
    app.get('/admin/bots/new', authMiddleware, (_req, res) => {
      const defaults = { is_active: true, debug_logs: true, bot_display_name: '', username_prefix: 'Bot-' };
      res.send(layout('Add Bot', `<div class="container">
        <nav><a href="/admin">Dashboard</a><span>/</span><span>Add Bot</span></nav>
        <h1>Add New Bot</h1>
        <div class="card" style="margin-top:16px">
          <form method="POST" action="/admin/bots">
            ${renderBotForm(defaults, false)}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button type="submit" class="btn btn-success">Create Bot</button>
              <a href="/admin" class="btn btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
      </div>`));
    });

    app.post('/admin/bots', authMiddleware, async (req, res) => {
      try {
        const data = {};
        for (const f of BOT_FIELDS) {
          if (f.createHidden || f.editOnly) continue;
          if (f.type === 'checkbox') data[f.key] = req.body[f.key] === '1';
          else if (req.body[f.key] !== undefined) data[f.key] = req.body[f.key];
        }

        // Auto-add @ to bot_username if missing
        if (data.bot_username) data.bot_username = ensureAt(data.bot_username);
        if (!data.bot_username) throw new Error('Bot Username is required');

        // Derive bot_id from bot_username (without @)
        data.bot_id = data.bot_username.replace(/^@/, '');
        if (!/^[a-zA-Z0-9_\-]+$/.test(data.bot_id)) throw new Error('Bot Username must contain only letters, numbers, hyphens, or underscores');

        const existing = await getBotRowById(data.bot_id);
        if (existing) throw new Error('A bot with this username already exists');

        // Auto-add @ to channel_username if missing
        if (data.channel_username) data.channel_username = ensureAt(data.channel_username);

        // Remove @ from admin usernames
        if (data.admin_username) data.admin_username = sanitizeAdminUsernames(data.admin_username);

        // Sanitize alert channel IDs (add -100 prefix if needed)
        if (data.alert_channel_accounts) data.alert_channel_accounts = sanitizeChannelId(data.alert_channel_accounts);
        if (data.alert_channel_transactions) data.alert_channel_transactions = sanitizeChannelId(data.alert_channel_transactions);

        // Set defaults for new bot
        data.exchange_rate_syp_per_usd = 11500;
        data.timezone = 'Asia/Damascus';
        data.referral_level1_percent = 5;
        data.referral_level2_percent = 3;
        data.referral_level3_percent = 2;
        data.deposit_required_ls = 50000;
        data.spin_prizes = [{"text": "حظ أوفر", "weight": 83}, {"text": "💰 50000", "weight": 1}, {"text": "💎 10000", "weight": 8}, {"text": "💲 5000", "weight": 8}];
        data.luck_box_prizes = [{"amount": 0, "weight": 0}, {"amount": 0, "weight": 0}, {"amount": 0, "weight": 0}];
        data.deposit_oxapay_enabled = false;
        data.withdraw_oxapay_enabled = false;
        data.syriatel_low_balance_alert_enabled = false;
        data.syriatel_low_balance_threshold = 1500;
        data.syriatel_tx_fail_balance_alert_enabled = true;
        data.ichancy_low_balance_alert_enabled = true;
        data.ichancy_low_balance_threshold = 20000;

        // Enable deposit/withdraw based on whether keys were entered
        const hasSyriatelKey = !!(data.syriatel_api_key && data.syriatel_api_key.trim());
        const hasShamcashCode = !!(data.sham_cash_deposit_code && data.sham_cash_deposit_code.trim());
        data.deposit_syriatel_enabled = hasSyriatelKey;
        data.withdraw_syriatel_enabled = hasSyriatelKey;
        data.deposit_shamcash_enabled = hasShamcashCode;
        data.withdraw_shamcash_enabled = hasShamcashCode;

        await createBotRow(data);

        // Refresh syriatel deposit numbers via GSMS API if api key was provided
        if (hasSyriatelKey) {
          try {
            const gsmsResult = await fetchSyriatelGsmsForBot(data.syriatel_api_key);
            if (gsmsResult.success && gsmsResult.gsms && gsmsResult.gsms.length > 0) {
              const syriatelNumbers = gsmsResult.gsms.map(g => ({
                number: (g.secretCode != null ? String(g.secretCode).trim() : '') || String(g.gsm || '').trim(),
                secretCode: g.secretCode != null ? String(g.secretCode).trim() : undefined,
                gsm: String(g.gsm || '').trim(),
                enabled: true,
              })).filter(e => e.number);
              await updateBotRow(data.bot_id, { syriatel_deposit_numbers: JSON.stringify(syriatelNumbers) });
              console.log(`[Launcher] Refreshed ${syriatelNumbers.length} Syriatel number(s) for new bot ${data.bot_id}`);
            }
          } catch (err) {
            console.warn(`[Launcher] Syriatel refresh for new bot ${data.bot_id}:`, err.message);
          }
        }

        // Start bot if active
        if (data.is_active) {
          const freshRow = await getBotRowById(data.bot_id);
          if (freshRow) {
            const r = await startBot(freshRow);
            res.setHeader('Set-Cookie', flashCookie(`Bot "${data.bot_id}" created` + (r.ok ? ' and launched!' : ` (launch failed: ${r.msg})`)));
          } else {
            res.setHeader('Set-Cookie', flashCookie(`Bot "${data.bot_id}" created`));
          }
        } else {
          res.setHeader('Set-Cookie', flashCookie(`Bot "${data.bot_id}" created (inactive)`));
        }
        res.redirect('/admin');
      } catch (err) {
        res.send(layout('Error', `<div class="container"><div class="flash flash-err">${esc(err.message)}</div><a href="/admin/bots/new" class="btn btn-primary">Back</a></div>`));
      }
    });

    // ── Edit bot ──
    app.get('/admin/bots/:id', authMiddleware, async (req, res) => {
      const bot = await getBotRowById(req.params.id);
      if (!bot) return res.status(404).send(layout('Not Found', '<div class="container"><nav><a href="/admin">Dashboard</a></nav><h1>Bot not found</h1><a href="/admin" class="btn btn-primary">Back</a></div>'));
      const isRunning = runningBots.has(bot.bot_id);
      const spinPrizesVal = Array.isArray(bot.spin_prizes) ? JSON.stringify(bot.spin_prizes, null, 2) : '[{"text":"حظ أوفر","weight":83},{"text":"💰 50000","weight":1},{"text":"💎 10000","weight":8},{"text":"💲 5000","weight":8}]';
      const luckBoxPrizesVal = Array.isArray(bot.luck_box_prizes) ? JSON.stringify(bot.luck_box_prizes, null, 2) : '[{"amount":0,"weight":0},{"amount":0,"weight":0},{"amount":0,"weight":0}]';
      let syriatelNumbersVal = '';
      if (bot.syriatel_deposit_numbers) {
        try { syriatelNumbersVal = JSON.stringify(JSON.parse(bot.syriatel_deposit_numbers), null, 2); }
        catch { syriatelNumbersVal = String(bot.syriatel_deposit_numbers); }
      }
      const blockedUsersVal = Array.isArray(bot.blocked_users) && bot.blocked_users.length > 0 ? JSON.stringify(bot.blocked_users, null, 2) : '';
      const webhookUrl = USE_WEBHOOK ? `https://${WEBHOOK_DOMAIN}/webhook/${encodeURIComponent(bot.bot_id)}` : null;
      const statusBadge = isRunning ? '<span class="badge badge-green">Running</span>' : '<span class="badge badge-yellow">Stopped</span>';
      const modeBadge = USE_WEBHOOK ? '<span class="badge badge-blue">Webhook</span>' : '<span class="badge" style="background:#1e3a2f;color:#4ade80">Polling</span>';
      const webhookInfoHtml = webhookUrl ? `
        <div class="card" style="border-color:#1e3a5f;padding:16px">
          <h3 style="color:#60a5fa;margin-bottom:8px">Webhook URL</h3>
          <div class="info-box">${esc(webhookUrl)}</div>
          <p style="color:#64748b;font-size:.82rem">Telegram will send updates to this URL. Make sure it is publicly accessible via HTTPS.</p>
        </div>` : '';
      res.send(layout('Edit Bot', `<div class="container">
        <nav><a href="/admin">Dashboard</a><span>/</span><span>${esc(bot.bot_display_name || bot.bot_id)}</span></nav>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h1>${esc(bot.bot_display_name || bot.bot_id)}</h1>
          <div style="display:flex;gap:6px;align-items:center">${statusBadge} ${modeBadge}</div>
        </div>
        ${webhookInfoHtml}
        <div class="card">
          <form method="POST" action="/admin/bots/${encodeURIComponent(bot.bot_id)}">
            ${renderBotForm(bot, true)}
            <hr class="section-divider">
            <h3>Spin & Games</h3>
            <label>Spin Prizes (JSON) — text and weight only</label>
            <textarea name="spin_prizes" rows="8" placeholder='[{"text":"حظ أوفر","weight":83},{"text":"💰 50000","weight":1}]'>${esc(spinPrizesVal)}</textarea>
            <label>Luck Box Prizes (JSON) — 3 boxes: amount (LS) and weight (%)</label>
            <textarea name="luck_box_prizes" rows="5" placeholder='[{"amount":0,"weight":0},{"amount":0,"weight":0},{"amount":0,"weight":0}]'>${esc(luckBoxPrizesVal)}</textarea>
            <hr class="section-divider">
            <h3>Data (JSON)</h3>
            <label>Syriatel Deposit Numbers (JSON) — auto-fetched from GSMS</label>
            <textarea name="syriatel_deposit_numbers" rows="6" placeholder='[{"number":"...","gsm":"...","enabled":true}]'>${esc(syriatelNumbersVal)}</textarea>
            <label>Blocked Users (JSON array of Telegram user IDs)</label>
            <textarea name="blocked_users" rows="4" placeholder='[123456789, 987654321]'>${esc(blockedUsersVal)}</textarea>
            <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              ${isRunning ? `<button type="submit" name="_restart" value="1" class="btn btn-secondary">Save & Restart</button>` : ''}
              <a href="/admin" class="btn btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
        <div class="card" style="border-color:#7f1d1d">
          <h2 style="color:#f87171">Danger Zone</h2>
          <p style="color:#94a3b8;font-size:.9rem;margin-bottom:16px">Permanently delete this bot and all its data. This cannot be undone.</p>
          <form method="POST" action="/admin/bots/${encodeURIComponent(bot.bot_id)}/delete" onsubmit="return confirmAction('Delete bot \\'${esc(bot.bot_display_name || bot.bot_id)}\\' permanently?',this)">
            <button type="submit" class="btn btn-danger">Delete Bot</button>
          </form>
        </div>
      </div>`));
    });

    app.post('/admin/bots/:id', authMiddleware, async (req, res) => {
      try {
        const fields = {};
        for (const f of BOT_FIELDS) {
          if (f.editDisabled) continue;
          if (f.type === 'checkbox') {
            fields[f.key] = req.body[f.key] === '1';
          } else if (f.type === 'stringCheckbox') {
            fields[f.key] = req.body[f.key] === '1' ? 'true' : 'false';
          } else if (f.type === 'number') {
            if (req.body[f.key] !== undefined && req.body[f.key] !== '') {
              const num = Number(req.body[f.key]);
              if (Number.isFinite(num)) fields[f.key] = num;
            }
          } else if (req.body[f.key] !== undefined) {
            fields[f.key] = req.body[f.key];
          }
        }
        // Sanitize fields
        if (fields.bot_username) fields.bot_username = ensureAt(fields.bot_username);
        if (fields.channel_username) fields.channel_username = ensureAt(fields.channel_username);
        if (fields.admin_username) fields.admin_username = sanitizeAdminUsernames(fields.admin_username);
        if (fields.alert_channel_accounts) fields.alert_channel_accounts = sanitizeChannelId(fields.alert_channel_accounts);
        if (fields.alert_channel_transactions) fields.alert_channel_transactions = sanitizeChannelId(fields.alert_channel_transactions);
        if (fields.support_username) fields.support_username = fields.support_username.trim().replace(/^@/, '');
        // Parse syriatel_deposit_numbers JSON
        if (req.body.syriatel_deposit_numbers !== undefined) {
          const raw = req.body.syriatel_deposit_numbers.trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed)) throw new Error('Must be array');
              fields.syriatel_deposit_numbers = JSON.stringify(parsed);
            } catch (e) {
              throw new Error('Invalid Syriatel deposit numbers JSON: ' + (e.message || 'parse error'));
            }
          } else {
            fields.syriatel_deposit_numbers = null;
          }
        }
        // Parse blocked_users JSON
        if (req.body.blocked_users !== undefined) {
          const raw = req.body.blocked_users.trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed)) throw new Error('Must be array');
              fields.blocked_users = parsed;
            } catch (e) {
              throw new Error('Invalid blocked users JSON: ' + (e.message || 'parse error'));
            }
          } else {
            fields.blocked_users = [];
          }
        }
        if (req.body.spin_prizes !== undefined) {
          const raw = req.body.spin_prizes.trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed)) throw new Error('Must be array');
              const normalized = parsed.map((p) => {
                const w = Number(p.weight);
                if (typeof p.text !== 'string' || !Number.isFinite(w) || w <= 0) {
                  throw new Error('Each prize must have text (string) and weight (positive number)');
                }
                return { text: p.text, weight: w };
              });
              fields.spin_prizes = normalized;
            } catch (e) {
              throw new Error('Invalid spin prizes JSON: ' + (e.message || 'parse error'));
            }
          } else {
            fields.spin_prizes = null;
          }
        }
        if (req.body.luck_box_prizes !== undefined) {
          const raw = req.body.luck_box_prizes.trim();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (!Array.isArray(parsed)) throw new Error('Must be array');
              const normalized = parsed.slice(0, 3).map((p) => {
                const amount = Number(p.amount);
                const weight = Number(p.weight);
                if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(weight) || weight < 0) {
                  throw new Error('Each box must have amount and weight (non-negative numbers)');
                }
                return { amount: Math.round(amount * 100) / 100, weight: Math.round(weight) };
              });
              while (normalized.length < 3) normalized.push({ amount: 0, weight: 0 });
              fields.luck_box_prizes = normalized;
            } catch (e) {
              throw new Error('Invalid luck box prizes JSON: ' + (e.message || 'parse error'));
            }
          } else {
            fields.luck_box_prizes = null;
          }
        }
        await updateBotRow(req.params.id, fields);

        // Auto-fetch Syriatel deposit numbers if null in DB and bot has an API key
        try {
          const row = await getBotRowById(req.params.id);
          if (row && row.syriatel_api_key && row.syriatel_api_key.trim() && !row.syriatel_deposit_numbers) {
            const gsmsResult = await fetchSyriatelGsmsForBot(row.syriatel_api_key);
            if (gsmsResult.success && gsmsResult.gsms && gsmsResult.gsms.length > 0) {
              const syriatelNumbers = gsmsResult.gsms.map(g => ({
                number: (g.secretCode != null ? String(g.secretCode).trim() : '') || String(g.gsm || '').trim(),
                secretCode: g.secretCode != null ? String(g.secretCode).trim() : undefined,
                gsm: String(g.gsm || '').trim(),
                enabled: true,
              })).filter(e => e.number);
              await updateBotRow(req.params.id, { syriatel_deposit_numbers: JSON.stringify(syriatelNumbers) });
              console.log(`[Admin] Auto-fetched ${syriatelNumbers.length} Syriatel number(s) for bot ${req.params.id}`);
            }
          }
        } catch (err) {
          console.warn(`[Admin] Syriatel auto-fetch for bot ${req.params.id}:`, err.message);
        }

        const shouldRestart = req.body._restart === '1';
        if (shouldRestart) {
          await stopBot(req.params.id);
          const freshRow = await getBotRowById(req.params.id);
          if (freshRow) {
            const r = await startBot(freshRow);
            res.setHeader('Set-Cookie', flashCookie(r.ok ? `Bot "${req.params.id}" updated and restarted` : `Bot "${req.params.id}" updated (restart failed: ${r.msg})`));
          } else {
            res.setHeader('Set-Cookie', flashCookie(`Bot "${req.params.id}" updated`));
          }
        } else {
          const instance = runningBots.get(req.params.id);
          if (instance && typeof instance.reloadConfig === 'function') {
            await instance.reloadConfig();
          }
          res.setHeader('Set-Cookie', flashCookie(`Bot "${req.params.id}" updated`));
        }
        res.redirect('/admin');
      } catch (err) {
        res.send(layout('Error', `<div class="container"><div class="flash flash-err">${esc(err.message)}</div><a href="/admin/bots/${encodeURIComponent(req.params.id)}">Back</a></div>`));
      }
    });

    // ── Start / Stop / Delete ──
    app.post('/admin/bots/:id/start', authMiddleware, async (req, res) => {
      const botRow = await getBotRowById(req.params.id);
      if (!botRow) { res.setHeader('Set-Cookie', flashCookie('Error: Bot not found')); return res.redirect('/admin'); }
      const result = await startBot(botRow);
      res.setHeader('Set-Cookie', flashCookie(result.ok ? `Started ${req.params.id}` : `Error: ${result.msg}`));
      res.redirect('/admin');
    });

    app.post('/admin/bots/:id/stop', authMiddleware, async (req, res) => {
      await stopBot(req.params.id);
      res.setHeader('Set-Cookie', flashCookie(`Stopped ${req.params.id}`));
      res.redirect('/admin');
    });

    app.post('/admin/bots/:id/restart', authMiddleware, async (req, res) => {
      await stopBot(req.params.id);
      const botRow = await getBotRowById(req.params.id);
      if (!botRow) { res.setHeader('Set-Cookie', flashCookie('Error: Bot not found')); return res.redirect('/admin'); }
      const result = await startBot(botRow);
      res.setHeader('Set-Cookie', flashCookie(result.ok ? `Restarted ${req.params.id}` : `Error restarting: ${result.msg}`));
      res.redirect('/admin');
    });

    app.post('/admin/bots/:id/delete', authMiddleware, async (req, res) => {
      await stopBot(req.params.id);
      await deleteBotRow(req.params.id);
      res.setHeader('Set-Cookie', flashCookie(`Deleted ${req.params.id}`));
      res.redirect('/admin');
    });

    // ── Root: serve spin Mini App ──
    app.get('/', (req, res) => {
      const spinPath = path.join(__dirname, 'spin.html');
      if (fs.existsSync(spinPath)) {
        res.sendFile(spinPath);
      } else {
        res.redirect('/admin');
      }
    });

    // ── Start HTTP(S) server ──
    const sslCert = (process.env.WEBHOOK_SSL_CERT_PATH || '').trim();
    const sslKey = (process.env.WEBHOOK_SSL_KEY_PATH || '').trim();
    let server;
    if (sslCert && sslKey) {
      try {
        server = https.createServer({ cert: fs.readFileSync(sslCert), key: fs.readFileSync(sslKey) }, app);
      } catch (err) {
        console.error('[Launcher] SSL cert/key error:', err.message);
        process.exit(1);
      }
    } else {
      server = http.createServer(app);
    }

    server.listen(WEB_PORT, () => {
      console.log(`[Launcher] Web admin running on port ${WEB_PORT} — http://localhost:${WEB_PORT}/admin`);
    });

    // ── Auto-start all active bots ──
    const activeBots = await getActiveBots();
    console.log(`[Launcher] Found ${activeBots.length} active bot(s). Starting...`);
    for (const botRow of activeBots) {
      const result = await startBot(botRow);
      if (!result.ok) console.warn(`[Launcher] Bot ${botRow.bot_id}: ${result.msg}`);
    }
    console.log(`[Launcher] ${runningBots.size} bot(s) running.`);

  } catch (err) {
    console.error('[Launcher] Fatal error:', err);
    process.exit(1);
  }
})();
