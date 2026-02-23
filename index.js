require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initDb, createBotDb, getAllBots, getActiveBots, getBotRowById, createBotRow, updateBotRow, deleteBotRow } = require('./lib/db');
const { verifyInitData, parseAmountFromText } = require('./lib/telegram-initdata');
const createBotInstance = require('./lib/bot-instance');
const { createApiClient } = require('./lib/ichancy-api');

// ── Admin credentials from .env ──────────────────────────────────────
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || 'admin').trim();
const WEB_PORT = parseInt(process.env.WEB_PORT || process.env.WEBHOOK_PORT || '3000', 10) || 3000;
const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true' || process.env.USE_WEBHOOK === '1';
const WEBHOOK_DOMAIN = (process.env.WEBHOOK_DOMAIN || '').trim().replace(/\/$/, '');

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
  options.spinBaseUrl = (process.env.SPIN_BASE_URL || (WEBHOOK_DOMAIN ? `https://${WEBHOOK_DOMAIN}` : `http://localhost:${WEB_PORT}`)).replace(/\/$/, '');
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
.container{max-width:960px;margin:0 auto;padding:24px}
.card{background:#1e293b;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #334155}
h1{font-size:1.8rem;margin-bottom:16px;color:#f8fafc}
h2{font-size:1.3rem;margin-bottom:12px;color:#f1f5f9}
.btn{display:inline-block;padding:8px 20px;border-radius:8px;border:none;font-size:.9rem;cursor:pointer;font-weight:600;transition:all .15s}
.btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
.btn-success{background:#22c55e;color:#fff}.btn-success:hover{background:#16a34a}
.btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
.btn-warning{background:#f59e0b;color:#000}.btn-warning:hover{background:#d97706}
.btn-sm{padding:5px 12px;font-size:.8rem}
input,select,textarea{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:.95rem;margin-bottom:12px}
input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6}
label{display:block;margin-bottom:4px;font-weight:600;color:#94a3b8;font-size:.85rem}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700}
.badge-green{background:#166534;color:#4ade80}.badge-red{background:#7f1d1d;color:#fca5a5}
.badge-yellow{background:#713f12;color:#fbbf24}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #334155}
th{color:#94a3b8;font-size:.8rem;text-transform:uppercase}
.flash{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600}
.flash-ok{background:#14532d;color:#86efac;border:1px solid #166534}
.flash-err{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{width:360px}
.actions{display:flex;gap:6px;flex-wrap:wrap}
</style></head><body>${body}</body></html>`;
}

// ── Bot form fields ──────────────────────────────────────────────────
const BOT_FIELDS = [
  { key: 'bot_id', label: 'Bot ID (unique identifier)', type: 'text', required: true, editDisabled: true },
  { key: 'bot_token', label: 'Bot Token', type: 'text', required: true },
  { key: 'bot_username', label: 'Bot Username', type: 'text' },
  { key: 'bot_display_name', label: 'Display Name', type: 'text' },
  { key: 'username_prefix', label: 'Username Prefix (for new Ichancy accounts, e.g. Bot-)', type: 'text' },
  { key: 'channel_username', label: 'Channel Username (e.g. @channel)', type: 'text' },
  { key: 'admin_username', label: 'Admin Username(s) (comma-separated)', type: 'text' },
  { key: 'support_username', label: 'Support Username', type: 'text' },
  { key: 'ichancy_agent_username', label: 'Ichancy Agent Username', type: 'text' },
  { key: 'ichancy_agent_password', label: 'Ichancy Agent Password', type: 'password' },
  { key: 'ichancy_parent_id', label: 'Ichancy Parent ID', type: 'text' },
  { key: 'ichancy_site_url', label: 'Ichancy Site URL', type: 'text' },
  { key: 'golden_tree_url', label: 'Golden Tree URL', type: 'text' },
  { key: 'is_active', label: 'Active', type: 'checkbox' },
  { key: 'debug_mode', label: 'Debug Mode', type: 'checkbox' },
  { key: 'debug_logs', label: 'Debug Logs', type: 'checkbox' },
];

function renderBotForm(bot, isEdit) {
  let html = '';
  for (const f of BOT_FIELDS) {
    const val = bot[f.key] ?? '';
    if (f.type === 'checkbox') {
      const checked = val ? 'checked' : '';
      html += `<label><input type="checkbox" name="${f.key}" value="1" ${checked} style="width:auto;margin-right:8px"> ${esc(f.label)}</label><br><br>`;
    } else {
      const disabled = isEdit && f.editDisabled ? 'disabled' : '';
      const req = f.required && !isEdit ? 'required' : '';
      html += `<label>${esc(f.label)}</label><input type="${f.type}" name="${f.key}" value="${esc(val)}" ${disabled} ${req}>`;
      if (isEdit && f.editDisabled) html += `<input type="hidden" name="${f.key}" value="${esc(val)}">`;
    }
  }
  return html;
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('[Launcher] Initializing database...');
    await initDb();
    console.log('[Launcher] Database ready.');

    const app = express();
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
      if (!botId || !initData) {
        return res.status(400).json({ error: 'bot_id and init_data required' });
      }
      const bot = await getBotRowById(botId);
      if (!bot || !bot.bot_token) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      const result = verifyInitData(initData, bot.bot_token);
      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid initData' });
      }
      const userId = result.payload?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not in initData' });
      }
      const db = createBotDb(botId);
      const user = await db.getUserByTelegramId(userId);
      if (!user) {
        return res.status(403).json({ error: 'User not found' });
      }
      await db.ensureDailySpinEligibility(userId);
      const userAfter = await db.getUserByTelegramId(userId);
      const spinsAvailable = Math.min(1, Number(userAfter?.wheel_spins_available_today ?? 0));
      if (spinsAvailable <= 0) {
        return res.status(403).json({ error: 'No spins available' });
      }
      const prizes = Array.isArray(bot.spin_prizes) && bot.spin_prizes.length > 0
        ? bot.spin_prizes
        : [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
      const baseUrl = WEBHOOK_DOMAIN ? `https://${WEBHOOK_DOMAIN}` : `http://localhost:${WEB_PORT}`;
      res.json({
        prizes,
        user_id: userId,
        bot_id: botId,
        logo_url: `${baseUrl}/logo/${encodeURIComponent(botId)}.png`,
        spins_available: spinsAvailable,
      });
    });

    app.post('/api/spin/result', async (req, res) => {
      const { init_data, bot_id, prize_index, text } = req.body || {};
      const initData = (init_data || '').trim();
      const botId = (bot_id || '').trim();
      const idx = parseInt(prize_index, 10);
      if (!initData || !botId || !Number.isFinite(idx) || typeof text !== 'string') {
        return res.status(400).json({ error: 'Invalid request' });
      }
      const bot = await getBotRowById(botId);
      if (!bot || !bot.bot_token) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      const result = verifyInitData(initData, bot.bot_token);
      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid initData' });
      }
      const userId = result.payload?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not in initData' });
      }
      const prizes = Array.isArray(bot.spin_prizes) && bot.spin_prizes.length > 0
        ? bot.spin_prizes
        : [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
      const prize = prizes[idx];
      if (!prize || prize.text !== text) {
        return res.status(400).json({ error: 'Prize mismatch' });
      }
      const amount = parseAmountFromText(text);
      const db = createBotDb(botId);
      const user = await db.getUserByTelegramId(userId);
      if (!user) {
        return res.status(403).json({ error: 'User not found' });
      }
      const spinsAvailable = Number(user.wheel_spins_available_today ?? 0);
      if (spinsAvailable <= 0) {
        return res.status(403).json({ error: 'No spins available' });
      }
      try {
        const applied = await db.useSpinCredit(userId, amount);
        if (!applied) {
          return res.status(403).json({ error: 'No spins available or already used' });
        }
        res.json({ ok: true, amount });
      } catch (err) {
        res.status(500).json({ error: 'Failed to credit' });
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
      let rows = '';
      for (const b of bots) {
        const isRunning = runningBots.has(b.bot_id);
        const statusBadge = !b.is_active
          ? '<span class="badge badge-red">Inactive</span>'
          : isRunning
            ? '<span class="badge badge-green">Running</span>'
            : '<span class="badge badge-yellow">Stopped</span>';
        const webhookInfo = USE_WEBHOOK && isRunning ? `<br><small style="color:#64748b">/webhook/${esc(b.bot_id)}</small>` : '';
        rows += `<tr>
          <td><strong>${esc(b.bot_display_name || b.bot_id)}</strong><br><small style="color:#64748b">${esc(b.bot_id)}</small>${webhookInfo}</td>
          <td>${esc(b.bot_username || '—')}</td>
          <td>${statusBadge}</td>
          <td class="actions">
            <a href="/admin/bots/${encodeURIComponent(b.bot_id)}" class="btn btn-primary btn-sm">Edit</a>
            ${b.is_active && !isRunning ? `<form method="POST" action="/admin/bots/${encodeURIComponent(b.bot_id)}/start" style="display:inline"><button class="btn btn-success btn-sm">Start</button></form>` : ''}
            ${isRunning ? `<form method="POST" action="/admin/bots/${encodeURIComponent(b.bot_id)}/stop" style="display:inline"><button class="btn btn-warning btn-sm">Stop</button></form>` : ''}
          </td>
        </tr>`;
      }
      res.send(layout('Dashboard', `<div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h1>🤖 Bot Manager</h1>
          <div><a href="/admin/bots/new" class="btn btn-success">+ Add Bot</a> <a href="/admin/logout" class="btn btn-danger btn-sm" style="margin-left:8px">Logout</a></div>
        </div>
        ${flash ? `<div class="flash ${flash.startsWith('Error') ? 'flash-err' : 'flash-ok'}">${esc(flash)}</div>` : ''}
        <div class="card">
          <h2>All Bots (${bots.length})</h2>
          <table><thead><tr><th>Bot</th><th>Username</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#64748b">No bots yet. Click "Add Bot" to create one.</td></tr>'}</tbody></table>
        </div>
        ${USE_WEBHOOK ? `<div class="card"><h2>Webhook Mode</h2><p style="color:#94a3b8">Domain: <code>${esc(WEBHOOK_DOMAIN)}</code> — Each bot receives updates at <code>/webhook/&lt;bot_id&gt;</code></p></div>` : '<div class="card"><h2>Polling Mode</h2><p style="color:#94a3b8">Each bot uses long-polling to receive updates from Telegram.</p></div>'}
      </div>`));
    });

    // ── New bot ──
    app.get('/admin/bots/new', authMiddleware, (_req, res) => {
      const defaults = { is_active: true, debug_logs: true, bot_display_name: 'New Bot', username_prefix: 'Bot-' };
      res.send(layout('Add Bot', `<div class="container">
        <h1>Add New Bot</h1>
        <div class="card" style="margin-top:16px">
          <form method="POST" action="/admin/bots">
            ${renderBotForm(defaults, false)}
            <button type="submit" class="btn btn-success" style="margin-top:12px">Create Bot</button>
            <a href="/admin" class="btn btn-danger" style="margin-left:8px">Cancel</a>
          </form>
        </div>
      </div>`));
    });

    app.post('/admin/bots', authMiddleware, async (req, res) => {
      try {
        const data = {};
        for (const f of BOT_FIELDS) {
          if (f.type === 'checkbox') data[f.key] = req.body[f.key] === '1';
          else if (req.body[f.key] !== undefined) data[f.key] = req.body[f.key];
        }
        if (!data.bot_id) throw new Error('Bot ID is required');
        if (!/^[a-zA-Z0-9_\-]+$/.test(data.bot_id)) throw new Error('Bot ID must contain only letters, numbers, hyphens, or underscores');
        const existing = await getBotRowById(data.bot_id);
        if (existing) throw new Error('Bot ID already exists');
        await createBotRow(data);
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
      if (!bot) return res.status(404).send(layout('Not Found', '<div class="container"><h1>Bot not found</h1><a href="/admin">Back</a></div>'));
      const isRunning = runningBots.has(bot.bot_id);
      const spinPrizesVal = Array.isArray(bot.spin_prizes) ? JSON.stringify(bot.spin_prizes, null, 2) : '[{"text":"حظ أوفر","weight":80},{"text":"💰 5000","weight":5}]';
      const luckBoxPrizesVal = Array.isArray(bot.luck_box_prizes) ? JSON.stringify(bot.luck_box_prizes, null, 2) : '[{"amount":0,"weight":0},{"amount":0,"weight":0},{"amount":0,"weight":0}]';
      res.send(layout('Edit Bot', `<div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h1>Edit: ${esc(bot.bot_display_name || bot.bot_id)}</h1>
          <span>${isRunning ? '<span class="badge badge-green">Running</span>' : '<span class="badge badge-yellow">Stopped</span>'}</span>
        </div>
        <div class="card" style="margin-top:16px">
          <form method="POST" action="/admin/bots/${encodeURIComponent(bot.bot_id)}">
            ${renderBotForm(bot, true)}
            <label>Spin Prizes (JSON) — text and weight only</label>
            <textarea name="spin_prizes" rows="8" placeholder='[{"text":"حظ أوفر","weight":80},{"text":"💰 5000","weight":5}]'>${esc(spinPrizesVal)}</textarea>
            <label>Luck Box Prizes (JSON) — 3 boxes: amount (LS) and weight (%). Default all 0</label>
            <textarea name="luck_box_prizes" rows="6" placeholder='[{"amount":0,"weight":0},{"amount":0,"weight":0},{"amount":0,"weight":0}]'>${esc(luckBoxPrizesVal)}</textarea>
            <div style="display:flex;gap:8px;margin-top:16px">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              <a href="/admin" class="btn btn-danger">Cancel</a>
            </div>
          </form>
        </div>
        <div class="card">
          <h2>Danger Zone</h2>
          <form method="POST" action="/admin/bots/${encodeURIComponent(bot.bot_id)}/delete" onsubmit="return confirm('Delete this bot permanently? This cannot be undone.')">
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
          if (f.type === 'checkbox') fields[f.key] = req.body[f.key] === '1';
          else if (req.body[f.key] !== undefined) fields[f.key] = req.body[f.key];
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
        const instance = runningBots.get(req.params.id);
        if (instance && typeof instance.reloadConfig === 'function') {
          await instance.reloadConfig();
        }
        res.setHeader('Set-Cookie', flashCookie(`Bot "${req.params.id}" updated`));
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
