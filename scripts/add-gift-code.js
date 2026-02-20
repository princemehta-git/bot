#!/usr/bin/env node
/**
 * Add a gift code to the database.
 * Usage: node scripts/add-gift-code.js <code> <amount> [expiry-date] [max-redemptions]
 * Example: node scripts/add-gift-code.js WELCOME 5000
 * Example: node scripts/add-gift-code.js PROMO 10000 2026-12-31 100
 */
require('dotenv').config();
const { initDb, createGiftCode } = require('../lib/db');

async function main() {
  const args = process.argv.slice(2);
  const code = args[0];
  const amount = args[1];
  const expiryDate = args[2] || null;
  const maxRedemptions = args[3] != null ? parseInt(args[3], 10) : null;

  if (!code || !amount) {
    console.error('Usage: node scripts/add-gift-code.js <code> <amount> [expiry-date] [max-redemptions]');
    console.error('Example: node scripts/add-gift-code.js WELCOME 5000');
    console.error('Example: node scripts/add-gift-code.js PROMO 10000 2026-12-31 100');
    process.exit(1);
  }

  const amt = parseInt(amount, 10);
  if (!Number.isFinite(amt) || amt <= 0) {
    console.error('Amount must be a positive number');
    process.exit(1);
  }

  try {
    await initDb();
    const { row, created } = await createGiftCode({
      code,
      amount: amt,
      expiryDate: expiryDate || null,
      maxRedemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : null,
    });
    console.log(created ? 'Gift code created:' : 'Gift code updated:', row);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
