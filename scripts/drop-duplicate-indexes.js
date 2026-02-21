#!/usr/bin/env node
/**
 * One-time fix for "Too many keys specified; max 64 keys allowed".
 * Sequelize sync({ alter: true }) with unique: true creates duplicate indexes
 * (e.g. telegram_user_id_1, telegram_user_id_2). This script drops those
 * duplicate indexes so the app can start again.
 *
 * Usage: node scripts/drop-duplicate-indexes.js
 * Run from project root. Requires .env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ichancy_bot';

async function main() {
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    charset: 'utf8mb4',
  });

  const [rows] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ?
     AND TABLE_NAME IN ('users', 'gift_codes', 'bots', 'gift_code_redemptions', 'payment_providers', 'referral_earnings', 'transactions', 'deleted_users')
     AND INDEX_NAME != 'PRIMARY'
     GROUP BY TABLE_NAME, INDEX_NAME`,
    [database]
  );

  // Duplicate indexes created by Sequelize have names ending with _1, _2, _3, ...
  const toDrop = rows.filter((r) => /_\d+$/.test(r.INDEX_NAME));
  if (toDrop.length === 0) {
    console.log('No duplicate indexes (e.g. *_1, *_2) found. You may still need to drop excess indexes manually.');
    await conn.end();
    return;
  }

  console.log(`Dropping ${toDrop.length} duplicate index(es):`);
  for (const { TABLE_NAME, INDEX_NAME } of toDrop) {
    try {
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` DROP INDEX \`${INDEX_NAME}\``);
      console.log(`  Dropped ${TABLE_NAME}.${INDEX_NAME}`);
    } catch (err) {
      console.warn(`  Skip ${TABLE_NAME}.${INDEX_NAME}: ${err.message}`);
    }
  }
  await conn.end();
  console.log('Done. Start the app again (npm start).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
