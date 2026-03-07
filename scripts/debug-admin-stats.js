#!/usr/bin/env node
/**
 * Debug script for admin stats (today deposits/withdrawals).
 * Run: node scripts/debug-admin-stats.js  (or: node debug.js)
 * Requires: DB_* env vars and BOT_ID (or uses first bot from DB).
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ichancy_bot';
const botId = process.env.BOT_ID || null;

async function main() {
  const conn = await mysql.createConnection({ host, port, user, password, database });
  try {
    const bid = botId || (await conn.query('SELECT bot_id FROM bots LIMIT 1'))[0][0]?.bot_id;
    if (!bid) {
      console.log('No bot found.');
      return;
    }
    console.log('Bot ID:', bid);

    const timeZone = 'Asia/Damascus';
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(now);
    const get = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
    const year = get('year');
    const month = get('month');
    const day = get('day');

    const todayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 3 * 60 * 60 * 1000);
    const todayStartUtc = todayStart.toISOString().slice(0, 19).replace('T', ' ');

    console.log('Today in', timeZone + ':', `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    console.log('todayStartUtc (midnight Damascus):', todayStartUtc);

    const [depositRows] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM transactions 
       WHERE bot_id = ? AND type = 'deposit' AND status = 'confirmed' 
       AND method IN ('syriatel', 'sham_syp', 'sham_usd') AND created_at >= ?`,
      [bid, todayStartUtc]
    );
    const [withdrawRows] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM transactions 
       WHERE bot_id = ? AND type = 'withdrawal' AND status = 'confirmed' 
       AND method IN ('syriatel', 'sham_syp', 'sham_usd') AND created_at >= ?`,
      [bid, todayStartUtc]
    );

    const dep = depositRows[0];
    const wth = withdrawRows[0];
    console.log('\nToday deposits (sum):', dep?.total ?? 0, '| count:', dep?.cnt ?? 0);
    console.log('Today withdrawals (sum):', wth?.total ?? 0, '| count:', wth?.cnt ?? 0);

    const [sample] = await conn.query(
      `SELECT id, type, method, amount, created_at FROM transactions 
       WHERE bot_id = ? AND type IN ('deposit', 'withdrawal') AND status = 'confirmed' 
       AND method IN ('syriatel', 'sham_syp', 'sham_usd') ORDER BY created_at DESC LIMIT 3`,
      [bid]
    );
    console.log('\nLatest 3 real transactions:');
    for (const r of sample || []) {
      console.log(' ', r.created_at, r.type, r.method, r.amount);
    }
  } finally {
    await conn.end();
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
