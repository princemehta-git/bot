/**
 * Migration script: reads output.xlsx and generates SQL for phpMyAdmin import.
 *
 * Migrates:
 *  1. Users (user_accounts + referral_relationships → users table)
 *  2. Transactions (transaction_logs → transactions table, only deposit/withdrawal)
 *
 * Usage: node generate-migration.js
 * Output: migration.sql (run in phpMyAdmin)
 */

const XLSX = require('xlsx');
const fs = require('fs');

const BOT_ID = 'raphael_bot';
const INPUT_FILE = 'output.xlsx';
const OUTPUT_FILE = 'migration.sql';
const PLAYER_FILES = ['players1.json', 'players2.json', 'players3.json', 'players4.json'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  return "'" + String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function unixToDatetime(ts) {
  if (!ts || isNaN(ts)) return 'NULL';
  const d = new Date(Number(ts) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `'${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}'`;
}

// ── Load Excel ───────────────────────────────────────────────────────────────

const wb = XLSX.readFile(INPUT_FILE);
function sheet(name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name] || {});
}

const rawUsers = sheet('user_accounts');
const referrals = sheet('referral_relationships');
const txLogs = sheet('transaction_logs');
const referralEarnings = sheet('referral_earnings');

// ── Load Ichancy player ID map from JSON files ──────────────────────────────

const playerIdMap = {};       // exact username → playerId
const playerIdMapLower = {};  // lowercase username → playerId
for (const file of PLAYER_FILES) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of data.result.records) {
    playerIdMap[p.username] = p.playerId;
    playerIdMapLower[p.username.toLowerCase()] = p.playerId;
  }
}

function resolvePlayerId(ichancyLogin) {
  if (!ichancyLogin) return null;
  return playerIdMap[ichancyLogin] || playerIdMapLower[ichancyLogin.toLowerCase()] || null;
}

const totalPlayers = Object.keys(playerIdMap).length;
const matchedCount = rawUsers.filter(u => resolvePlayerId(u.username)).length;
console.log(`Player ID map: ${totalPlayers} players loaded, ${matchedCount}/${rawUsers.length} users matched`);

console.log(`Loaded: ${rawUsers.length} users, ${referrals.length} referrals, ${txLogs.length} transactions`);

// ── Deduplicate users by telegram_user_id (keep the one with higher balance/activity) ──

const userMap = {};
let dupeCount = 0;
for (const u of rawUsers) {
  const id = String(u.user_id);
  if (userMap[id]) {
    dupeCount++;
    const existing = userMap[id];
    // Keep whichever has more balance + total_deposited (more active account)
    const existingScore = Number(existing.balance || 0) + Number(existing.total_deposited || 0);
    const newScore = Number(u.balance || 0) + Number(u.total_deposited || 0);
    if (newScore > existingScore) {
      userMap[id] = u;
    }
  } else {
    userMap[id] = u;
  }
}
const users = Object.values(userMap);
if (dupeCount > 0) {
  console.log(`Deduplicated: ${dupeCount} duplicate user_ids removed, keeping ${users.length} unique users`);
}

// ── Build referral map: invited_id → referrer_id ─────────────────────────────

const referralMap = {};
for (const r of referrals) {
  if (r.invited_id && r.referrer_id) {
    referralMap[String(r.invited_id)] = String(r.referrer_id);
  }
}
console.log(`Referral map: ${Object.keys(referralMap).length} entries`);

// ── SQL output ───────────────────────────────────────────────────────────────

const lines = [];

lines.push('-- ============================================================');
lines.push('-- Migration: old bot (output.xlsx) → ichancy bot DB');
lines.push(`-- Bot ID: ${BOT_ID}`);
lines.push(`-- Generated: ${new Date().toISOString()}`);
lines.push('-- ============================================================');
lines.push('');
lines.push('SET NAMES utf8mb4;');
lines.push('SET FOREIGN_KEY_CHECKS = 0;');
lines.push('SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";');
lines.push('');

// ── 1. USERS ─────────────────────────────────────────────────────────────────

lines.push('-- ============================================================');
lines.push(`-- 1. USERS (${users.length} rows)`);
lines.push('-- ============================================================');
lines.push('');

const USERS_BATCH = 200;
for (let i = 0; i < users.length; i += USERS_BATCH) {
  const batch = users.slice(i, i + USERS_BATCH);

  lines.push('INSERT IGNORE INTO `users` (`bot_id`, `telegram_user_id`, `telegram_username`, `first_name`, `last_name`, `ichancy_login`, `password`, `balance`, `gifts`, `ichancy_user_id`, `wheel_spins_available_today`, `spins_granted_today`, `last_spin_grant_date`, `last_box_game_at`, `referred_by`, `referral_net_l1`, `referral_net_l2`, `referral_net_l3`, `custom_referral_percent`, `created_at`) VALUES');

  const values = batch.map((u) => {
    const telegramUserId = String(u.user_id);
    const ichancyLogin = u.username || null;
    const password = u.password || null;
    const balance = Number(u.balance || 0);
    const gifts = Number(u.bonus_balance || 0);
    const referredBy = referralMap[telegramUserId] || null;
    const customRefPercent = (u.custom_referral_percent && u.custom_referral_percent > 0)
      ? u.custom_referral_percent
      : null;

    const ichancyUserId = resolvePlayerId(ichancyLogin);

    return `(${esc(BOT_ID)}, ${telegramUserId}, NULL, NULL, NULL, ${esc(ichancyLogin)}, ${esc(password)}, ${balance.toFixed(2)}, ${gifts.toFixed(2)}, ${esc(ichancyUserId)}, 0, 0, NULL, NULL, ${referredBy ? referredBy : 'NULL'}, 0.00, 0.00, 0.00, ${customRefPercent !== null ? customRefPercent : 'NULL'}, NOW())`;
  });

  lines.push(values.join(',\n') + ';');
  lines.push('');
}

// ── 2. TRANSACTIONS (only deposit/withdrawal that map cleanly) ───────────────

// Type mapping from old → new
const TYPE_MAP = {
  'deposit': 'deposit',
  'withdraw': 'withdrawal',
  'withdraw_confirmed': 'withdrawal',
  'website_deposit': 'deposit',      // balance_to_site = deposit TO ichancy site (matches bot code)
  'website_withdraw': 'withdrawal',  // site_to_balance = withdrawal FROM ichancy site (matches bot code)
  'wheel_win': 'deposit',
};

// Method normalization
function normalizeMethod(oldMethod, oldType) {
  if (!oldMethod) return null;
  const m = oldMethod.toLowerCase();

  if (m === 'syriatel' || m === 'syriatel_cash' || m === 'syriatel_pending') return 'syriatel';
  if (m === 'chamcash_syp' || m === 'cham_cash' || m === 'chamcash_syp_pending') return 'sham_syp';
  if (m === 'chamcash_usd' || m === 'chamcash_usd_pending') return 'sham_usd';
  if (m === 'balance_to_site') return 'balance_to_site';
  if (m === 'site_to_balance') return 'site_to_balance';
  if (m === 'spin_wheel') return 'spin_wheel';
  if (m === 'box_game') return 'box_game';
  if (m === 'usdt (arab pay)') return 'oxapay';

  return null; // skip unmappable methods (promo_*, gift, level_*, etc.)
}

// Status mapping
function normalizeStatus(oldStatus) {
  if (!oldStatus) return 'confirmed';
  const s = oldStatus.toLowerCase();
  if (s === 'success') return 'confirmed';
  if (s === 'pending' || s === 'processing') return 'pending';
  if (s === 'failed') return 'rejected';
  return 'confirmed';
}

// Filter and transform transactions
const mappedTx = [];
for (const tx of txLogs) {
  const newType = TYPE_MAP[tx.type];
  if (!newType) continue; // skip bonus, refund, gift_send, etc.

  const method = normalizeMethod(tx.method, tx.type);
  if (!method) continue; // skip unmappable methods (promo_*, _rejected, etc.)

  // Skip rejected method variants (these are refund entries)
  const mLower = (tx.method || '').toLowerCase();
  if (mLower.includes('_rejected')) continue;

  mappedTx.push({
    telegram_user_id: String(tx.user_id),
    type: newType,
    amount: Math.abs(Number(tx.amount || 0)),
    method: method,
    transfer_id: tx.transaction_id || null,
    status: normalizeStatus(tx.status),
    created_at: tx.timestamp,
  });
}

console.log(`Transactions: ${txLogs.length} total → ${mappedTx.length} mapped (${txLogs.length - mappedTx.length} skipped)`);

lines.push('-- ============================================================');
lines.push(`-- 2. TRANSACTIONS (${mappedTx.length} rows)`);
lines.push('-- ============================================================');
lines.push('');

const TX_BATCH = 200;
for (let i = 0; i < mappedTx.length; i += TX_BATCH) {
  const batch = mappedTx.slice(i, i + TX_BATCH);

  lines.push("INSERT INTO `transactions` (`bot_id`, `telegram_user_id`, `type`, `amount`, `method`, `transfer_id`, `status`, `bonus_amount`, `tax_amount`, `created_at`) VALUES");

  const values = batch.map((tx) => {
    return `(${esc(BOT_ID)}, ${tx.telegram_user_id}, ${esc(tx.type)}, ${tx.amount.toFixed(2)}, ${esc(tx.method)}, ${esc(tx.transfer_id)}, ${esc(tx.status)}, 0.00, 0.00, ${unixToDatetime(tx.created_at)})`;
  });

  lines.push(values.join(',\n') + ';');
  lines.push('');
}

// ── 3. REFERRAL NET DETAILS (pending referral earnings) ─────────────────────

// Build custom_referral_percent map from user_accounts
const customPctMap = {};
for (const u of rawUsers) {
  if (u.custom_referral_percent && u.custom_referral_percent > 0) {
    customPctMap[String(u.user_id)] = u.custom_referral_percent;
  }
}

// Default referral percents: L1=5, L2=3, L3=2
const DEFAULT_PCTS = [5, 3, 2];

function getPercent(referrerId, level) {
  if (level === 1 && customPctMap[referrerId]) return customPctMap[referrerId];
  return DEFAULT_PCTS[level - 1];
}

const pendingEarnings = referralEarnings.filter(r => r.status === 'pending');
const distributedEarnings = referralEarnings.filter(r => r.status === 'distributed');

// Aggregate pending per (referrer, invited, level) → compute net_balance
const pendingAgg = {};
for (const r of pendingEarnings) {
  const key = `${r.referrer_id}|${r.invited_id}|${r.level}`;
  if (!pendingAgg[key]) pendingAgg[key] = { referrer_id: String(r.referrer_id), invited_id: String(r.invited_id), level: r.level, totalCommission: 0 };
  pendingAgg[key].totalCommission += r.amount;
}

const netDetails = Object.values(pendingAgg).map(r => {
  const pct = getPercent(r.referrer_id, r.level);
  r.net_balance = Math.round(r.totalCommission * 100 / pct * 100) / 100;
  return r;
});

console.log(`Referral net details: ${netDetails.length} rows (from ${pendingEarnings.length} pending earnings)`);

lines.push('-- ============================================================');
lines.push(`-- 3. REFERRAL NET DETAILS (${netDetails.length} rows from pending earnings)`);
lines.push('-- ============================================================');
lines.push('');

const NET_DETAIL_BATCH = 200;
for (let i = 0; i < netDetails.length; i += NET_DETAIL_BATCH) {
  const batch = netDetails.slice(i, i + NET_DETAIL_BATCH);
  lines.push('INSERT IGNORE INTO `referral_net_details` (`bot_id`, `referrer_id`, `referred_user_id`, `level`, `net_balance`) VALUES');
  const values = batch.map(r =>
    `(${esc(BOT_ID)}, ${r.referrer_id}, ${r.invited_id}, ${r.level}, ${r.net_balance.toFixed(2)})`
  );
  lines.push(values.join(',\n') + ';');
  lines.push('');
}

// ── 4. UPDATE USERS referral_net_l1/l2/l3 (aggregate pending net balances) ──

const userNets = {};
for (const r of netDetails) {
  if (!userNets[r.referrer_id]) userNets[r.referrer_id] = { l1: 0, l2: 0, l3: 0 };
  userNets[r.referrer_id][`l${r.level}`] += r.net_balance;
}

// Round aggregates
for (const uid of Object.keys(userNets)) {
  userNets[uid].l1 = Math.round(userNets[uid].l1 * 100) / 100;
  userNets[uid].l2 = Math.round(userNets[uid].l2 * 100) / 100;
  userNets[uid].l3 = Math.round(userNets[uid].l3 * 100) / 100;
}

const userNetUpdates = Object.entries(userNets);
console.log(`User referral_net updates: ${userNetUpdates.length} users`);

lines.push('-- ============================================================');
lines.push(`-- 4. USER REFERRAL NET UPDATES (${userNetUpdates.length} users)`);
lines.push('-- ============================================================');
lines.push('');

for (const [uid, nets] of userNetUpdates) {
  lines.push(`UPDATE \`users\` SET \`referral_net_l1\` = ${nets.l1.toFixed(2)}, \`referral_net_l2\` = ${nets.l2.toFixed(2)}, \`referral_net_l3\` = ${nets.l3.toFixed(2)} WHERE \`bot_id\` = ${esc(BOT_ID)} AND \`telegram_user_id\` = ${uid};`);
}
lines.push('');

// ── 5. REFERRAL DISTRIBUTIONS (distributed history) ─────────────────────────

// Group distributed entries by (referrer_id, distributed_at)
const distGroups = {};
for (const r of distributedEarnings) {
  const key = `${r.referrer_id}|${r.distributed_at}`;
  if (!distGroups[key]) distGroups[key] = { referrer_id: String(r.referrer_id), distributed_at: r.distributed_at, total: 0, details: [] };
  distGroups[key].total += r.amount;
  distGroups[key].details.push({ referred_user_id: String(r.invited_id), level: r.level, amount: r.amount });
}

const distRecords = Object.values(distGroups);

// Build details_json: aggregate per (invited, level) and compute net_balance snapshot
for (const rec of distRecords) {
  const agg = {};
  for (const d of rec.details) {
    const key = `${d.referred_user_id}|${d.level}`;
    if (!agg[key]) agg[key] = { referred_user_id: d.referred_user_id, level: d.level, totalCommission: 0 };
    agg[key].totalCommission += d.amount;
  }
  const detailRows = Object.values(agg).map(d => {
    const pct = getPercent(rec.referrer_id, d.level);
    return { referred_user_id: Number(d.referred_user_id), level: d.level, net_balance: Math.round(d.totalCommission * 100 / pct * 100) / 100 };
  });
  rec.details_json = detailRows;

  // Compute net_lN_snapshots
  rec.net_l1 = 0; rec.net_l2 = 0; rec.net_l3 = 0;
  for (const d of detailRows) {
    rec[`net_l${d.level}`] += d.net_balance;
  }
  rec.net_l1 = Math.round(rec.net_l1 * 100) / 100;
  rec.net_l2 = Math.round(rec.net_l2 * 100) / 100;
  rec.net_l3 = Math.round(rec.net_l3 * 100) / 100;
  rec.total = Math.round(rec.total * 100) / 100;
}

console.log(`Referral distributions: ${distRecords.length} records (from ${distributedEarnings.length} distributed earnings)`);

lines.push('-- ============================================================');
lines.push(`-- 5. REFERRAL DISTRIBUTIONS (${distRecords.length} rows)`);
lines.push('-- ============================================================');
lines.push('');

function escDatetime(isoStr) {
  if (!isoStr) return 'NOW()';
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `'${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}'`;
}

const DIST_BATCH = 50;
for (let i = 0; i < distRecords.length; i += DIST_BATCH) {
  const batch = distRecords.slice(i, i + DIST_BATCH);
  lines.push('INSERT INTO `referral_distributions` (`bot_id`, `referrer_id`, `commission_amount`, `net_l1_snapshot`, `net_l2_snapshot`, `net_l3_snapshot`, `details_json`, `distributed_at`) VALUES');
  const values = batch.map(r =>
    `(${esc(BOT_ID)}, ${r.referrer_id}, ${r.total.toFixed(2)}, ${r.net_l1.toFixed(2)}, ${r.net_l2.toFixed(2)}, ${r.net_l3.toFixed(2)}, ${esc(JSON.stringify(r.details_json))}, ${escDatetime(r.distributed_at)})`
  );
  lines.push(values.join(',\n') + ';');
  lines.push('');
}

// ── Footer ───────────────────────────────────────────────────────────────────

lines.push('');
lines.push('SET FOREIGN_KEY_CHECKS = 1;');
lines.push('');
lines.push('-- ============================================================');
lines.push('-- Migration complete.');
lines.push(`-- Users inserted: ${users.length}`);
lines.push(`-- Transactions inserted: ${mappedTx.length}`);
lines.push(`-- Referral relationships set via referred_by: ${Object.keys(referralMap).length}`);
lines.push(`-- Referral net details: ${netDetails.length}`);
lines.push(`-- User referral_net updates: ${userNetUpdates.length}`);
lines.push(`-- Referral distributions: ${distRecords.length}`);
lines.push('-- ============================================================');

// ── Write file ───────────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
console.log(`\nDone! Written to ${OUTPUT_FILE}`);
console.log(`  Users: ${users.length}`);
console.log(`  Transactions: ${mappedTx.length}`);
console.log(`  Referrals (referred_by set): ${Object.keys(referralMap).length}`);
