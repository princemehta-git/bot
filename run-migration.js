/**
 * Safe migration runner — executes migration.sql inside a single transaction.
 * If anything fails, the entire migration is rolled back. Nothing is half-committed.
 *
 * Usage:
 *   node run-migration.js --dry-run    Preview without committing
 *   node run-migration.js              Run for real (prompts for confirmation)
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const readline = require('readline');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'ichancy_bot';
const SQL_FILE = 'migration.sql';
const DRY_RUN = process.argv.includes('--dry-run');
const USERS_ONLY = process.argv.includes('--users-only');
const REFERRALS_ONLY = process.argv.includes('--referrals-only');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function run() {
  console.log(DRY_RUN ? '\n=== DRY RUN MODE (no changes will be saved) ===\n' : '');
  console.log(`Connecting to MySQL ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME} ...`);

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    charset: 'utf8mb4',
  });

  console.log('Connected.\n');

  // ── Pre-flight checks ──────────────────────────────────────────────────────

  console.log('--- Pre-flight checks ---');

  // 1. Verify tables exist
  const [tables] = await conn.query('SHOW TABLES');
  const tableNames = tables.map(r => Object.values(r)[0]);
  const required = ['users', 'transactions'];
  for (const t of required) {
    if (!tableNames.includes(t)) {
      console.error(`ABORT: Required table '${t}' does not exist. Run the bot once first to create schema.`);
      await conn.end();
      process.exit(1);
    }
  }
  console.log('  Tables exist: users ✓, transactions ✓');

  // 2. Check for existing migrated data
  const [[{ userCount }]] = await conn.query(
    "SELECT COUNT(*) AS userCount FROM users WHERE bot_id = 'raphael_bot'"
  );
  const [[{ txCount }]] = await conn.query(
    "SELECT COUNT(*) AS txCount FROM transactions WHERE bot_id = 'raphael_bot'"
  );
  console.log(`  Existing data for raphael_bot: ${userCount} users, ${txCount} transactions`);

  if (userCount > 0 || txCount > 0) {
    console.log('\n  ⚠️  WARNING: There is already data for bot_id=raphael_bot.');
    console.log('  Users use INSERT IGNORE (duplicates will be skipped).');
    console.log('  Transactions use plain INSERT (duplicates will be added again).');
    if (!DRY_RUN) {
      const answer = await ask('\n  Continue anyway? (yes/no): ');
      if (answer !== 'yes') {
        console.log('Aborted.');
        await conn.end();
        process.exit(0);
      }
    }
  }

  // 3. Verify bot row exists
  const [[{ botExists }]] = await conn.query(
    "SELECT COUNT(*) AS botExists FROM bots WHERE bot_id = 'raphael_bot'"
  );
  if (!botExists) {
    console.log('  ⚠️  WARNING: No bot config row for raphael_bot in bots table.');
    console.log('  The migration will still work, but the bot won\'t function until configured.');
  } else {
    console.log('  Bot config row exists ✓');
  }

  // ── Parse SQL ──────────────────────────────────────────────────────────────

  console.log('\nReading SQL file...');
  const sql = fs.readFileSync(SQL_FILE, 'utf8');

  const statements = sql
    .split(';\n')
    .map(s => {
      // Remove leading comment lines from each chunk so we don't
      // accidentally discard an INSERT that follows a comment block.
      return s.replace(/^(\s*--.*\n)*/g, '').trim();
    })
    .filter(s => s.length > 0 && !s.startsWith('--'));

  // Separate SET statements from data statements
  const setStatements = statements.filter(s => s.toUpperCase().startsWith('SET '));
  const dataStatements = statements.filter(s => s.toUpperCase().startsWith('INSERT '));
  const updateStatements = statements.filter(s => s.toUpperCase().startsWith('UPDATE '));

  const userBatches = dataStatements.filter(s => s.includes('INSERT IGNORE INTO `users`'));
  const txBatches = dataStatements.filter(s => s.includes('INSERT INTO `transactions`'));
  const netDetailBatches = dataStatements.filter(s => s.includes('INSERT IGNORE INTO `referral_net_details`'));
  const distBatches = dataStatements.filter(s => s.includes('INSERT INTO `referral_distributions`'));
  const userNetUpdates = updateStatements.filter(s => s.includes('`referral_net_l1`'));

  console.log(`  ${userBatches.length} user batches, ${txBatches.length} transaction batches, ${setStatements.length} SET commands`);
  console.log(`  ${netDetailBatches.length} referral net detail batches, ${userNetUpdates.length} user net updates, ${distBatches.length} distribution batches\n`);

  if (!DRY_RUN) {
    const answer = await ask('Ready to execute. Proceed? (yes/no): ');
    if (answer !== 'yes') {
      console.log('Aborted.');
      await conn.end();
      process.exit(0);
    }
  }

  // ── Execute inside transaction ─────────────────────────────────────────────

  console.log('\n--- Executing migration ---');

  // Run SET statements outside transaction (they're session-level)
  for (const stmt of setStatements) {
    const clean = stmt.endsWith(';') ? stmt.slice(0, -1) : stmt;
    await conn.query(clean);
  }
  console.log(`  SET commands: ${setStatements.length} executed`);

  // Start transaction for all data
  await conn.query('START TRANSACTION');
  console.log('  Transaction started\n');

  let usersInserted = 0;
  let usersSkipped = 0;
  let txInserted = 0;
  let netDetailsInserted = 0;
  let userNetsUpdated = 0;
  let distInserted = 0;

  try {
    // Insert users
    if (REFERRALS_ONLY) {
      console.log('  Skipping users (--referrals-only mode)');
    } else {
      for (let i = 0; i < userBatches.length; i++) {
        const stmt = userBatches[i].endsWith(';') ? userBatches[i].slice(0, -1) : userBatches[i];
        const [result] = await conn.query(stmt);
        const rows = result.affectedRows || 0;
        const warnings = result.warningCount || 0;
        usersInserted += rows;
        usersSkipped += warnings;
        console.log(`  [Users ${i + 1}/${userBatches.length}] ${rows} inserted${warnings > 0 ? `, ${warnings} skipped (duplicate)` : ''}`);
      }
      console.log(`\n  Users total: ${usersInserted} inserted, ${usersSkipped} skipped\n`);
    }

    // Insert transactions
    if (USERS_ONLY || REFERRALS_ONLY) {
      console.log('  Skipping transactions\n');
    } else {
      for (let i = 0; i < txBatches.length; i++) {
        const stmt = txBatches[i].endsWith(';') ? txBatches[i].slice(0, -1) : txBatches[i];
        const [result] = await conn.query(stmt);
        const rows = result.affectedRows || 0;
        txInserted += rows;
        console.log(`  [Transactions ${i + 1}/${txBatches.length}] ${rows} inserted`);
      }
      console.log(`\n  Transactions total: ${txInserted} inserted\n`);
    }

    // Insert referral net details (pending earnings)
    if (!USERS_ONLY && netDetailBatches.length > 0) {
      for (let i = 0; i < netDetailBatches.length; i++) {
        const stmt = netDetailBatches[i].endsWith(';') ? netDetailBatches[i].slice(0, -1) : netDetailBatches[i];
        const [result] = await conn.query(stmt);
        const rows = result.affectedRows || 0;
        netDetailsInserted += rows;
        console.log(`  [Referral net details ${i + 1}/${netDetailBatches.length}] ${rows} inserted`);
      }
      console.log(`\n  Referral net details total: ${netDetailsInserted} inserted\n`);
    } else if (USERS_ONLY) {
      console.log('  Skipping referral net details\n');
    }

    // Update users referral_net_l1/l2/l3
    if (!USERS_ONLY && userNetUpdates.length > 0) {
      for (let i = 0; i < userNetUpdates.length; i++) {
        const stmt = userNetUpdates[i].endsWith(';') ? userNetUpdates[i].slice(0, -1) : userNetUpdates[i];
        const [result] = await conn.query(stmt);
        if (result.affectedRows > 0) userNetsUpdated++;
      }
      console.log(`  User referral_net updates: ${userNetsUpdated}/${userNetUpdates.length} users updated\n`);
    } else if (USERS_ONLY) {
      console.log('  Skipping user referral_net updates\n');
    }

    // Insert referral distributions (history)
    if (!USERS_ONLY && distBatches.length > 0) {
      for (let i = 0; i < distBatches.length; i++) {
        const stmt = distBatches[i].endsWith(';') ? distBatches[i].slice(0, -1) : distBatches[i];
        const [result] = await conn.query(stmt);
        const rows = result.affectedRows || 0;
        distInserted += rows;
        console.log(`  [Referral distributions ${i + 1}/${distBatches.length}] ${rows} inserted`);
      }
      console.log(`\n  Referral distributions total: ${distInserted} inserted\n`);
    } else if (USERS_ONLY) {
      console.log('  Skipping referral distributions\n');
    }

    // ── Verify counts before committing ────────────────────────────────────

    console.log('\n--- Post-insert verification ---');

    const [[{ newUserCount }]] = await conn.query(
      "SELECT COUNT(*) AS newUserCount FROM users WHERE bot_id = 'raphael_bot'"
    );
    const [[{ newTxCount }]] = await conn.query(
      "SELECT COUNT(*) AS newTxCount FROM transactions WHERE bot_id = 'raphael_bot'"
    );
    const [[{ netDetailCount }]] = await conn.query(
      "SELECT COUNT(*) AS netDetailCount FROM referral_net_details WHERE bot_id = 'raphael_bot'"
    );
    const [[{ distCount }]] = await conn.query(
      "SELECT COUNT(*) AS distCount FROM referral_distributions WHERE bot_id = 'raphael_bot'"
    );

    console.log(`  Users in DB now: ${newUserCount}`);
    console.log(`  Transactions in DB now: ${newTxCount}`);
    console.log(`  Referral net details in DB now: ${netDetailCount}`);
    console.log(`  Referral distributions in DB now: ${distCount}`);

    // Sanity check
    const totalChanges = usersInserted + txInserted + netDetailsInserted + userNetsUpdated + distInserted;
    if (totalChanges === 0) {
      console.log('\n  ⚠️  Nothing was changed. Rolling back empty transaction.');
      await conn.query('ROLLBACK');
      console.log('  Rolled back.');
      await conn.end();
      process.exit(0);
    }

    // ── Commit or rollback ─────────────────────────────────────────────────

    if (DRY_RUN) {
      console.log('\n--- DRY RUN — Rolling back all changes ---');
      await conn.query('ROLLBACK');
      console.log('  Rolled back. No data was changed.');
    } else {
      const answer = await ask('\nEverything looks good. COMMIT to save permanently? (yes/no): ');
      if (answer === 'yes') {
        await conn.query('COMMIT');
        console.log('\n  ✅ COMMITTED — Migration saved permanently.');
      } else {
        await conn.query('ROLLBACK');
        console.log('\n  Rolled back. No data was changed.');
      }
    }

  } catch (err) {
    console.error(`\n  ❌ ERROR: ${err.message}`);
    console.log('  Rolling back all changes...');
    await conn.query('ROLLBACK');
    console.log('  ✅ Rolled back. Database is unchanged.');
    await conn.end();
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Summary:');
  console.log(`  Users inserted:      ${usersInserted}`);
  console.log(`  Users skipped (dup): ${usersSkipped}`);
  console.log(`  Transactions:        ${txInserted}`);
  console.log(`  Net details:         ${netDetailsInserted}`);
  console.log(`  User net updates:    ${userNetsUpdated}`);
  console.log(`  Distributions:       ${distInserted}`);
  console.log('========================================\n');

  await conn.end();
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
