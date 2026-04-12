/**
 * One-time migration script for Paradise bot users.
 *
 * - Reads paradise.json for telegram_id, ichancy_login, password
 * - Reads paradise_ichancy.json for playerId -> ichancy_user_id mapping
 * - If same telegram_id appears twice, keeps the LATER message (user updated account)
 * - Runs everything in a single transaction — rolls back on any error
 * - Logs expected vs actual counts into migration_log table
 *
 * Usage:  node migrate_paradise.js [--dry-run]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BOT_ID = 'paradise';
const BOT_NAME = 'paradise';
const USERS_DIR = path.join(__dirname, 'users');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseUsersJson(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const messages = data.messages.filter(m => m.type === 'message');

  const userMap = new Map();
  let duplicates = 0;

  for (const msg of messages) {
    const codeElements = msg.text
      .filter(t => typeof t === 'object' && t.type === 'code')
      .map(t => t.text);

    let telegramId, ichancyLogin, pwd;

    if (codeElements.length >= 3) {
      [telegramId, ichancyLogin, pwd] = codeElements;
    } else if (codeElements.length === 2) {
      [telegramId, ichancyLogin] = codeElements;
      for (let i = 0; i < msg.text.length; i++) {
        const el = msg.text[i];
        if (typeof el === 'object' && el.type === 'bold' && el.text.includes('كلمة المرور')) {
          for (let j = i + 1; j < msg.text.length; j++) {
            const next = msg.text[j];
            if (typeof next === 'string' && next.trim()) {
              pwd = next.trim();
              break;
            }
          }
          break;
        }
      }
      if (!pwd) {
        console.warn(`  [WARN] Message id=${msg.id} has 2 code elements and no plain-text password, skipping`);
        continue;
      }
      console.log(`  [INFO] Message id=${msg.id} password recovered from plain text`);
    } else {
      if (codeElements.length > 0) {
        console.warn(`  [WARN] Message id=${msg.id} has ${codeElements.length} code elements, skipping`);
      }
      continue;
    }

    if (!/^\d+$/.test(telegramId)) {
      console.warn(`  [WARN] Message id=${msg.id} has non-numeric telegram_id "${telegramId}", skipping`);
      continue;
    }

    if (userMap.has(telegramId)) duplicates++;
    userMap.set(telegramId, {
      telegram_user_id: telegramId,
      ichancy_login: ichancyLogin,
      password: pwd,
      created_at: msg.date.replace('T', ' '),
    });
  }

  return { userMap, totalMessages: messages.length, duplicates };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'ichancy_bot';

  console.log(`Connecting to ${host}:${port}/${database} as ${user}`);
  if (DRY_RUN) console.log('*** DRY RUN — no data will be written ***\n');

  const connection = await mysql.createConnection({
    host, port, user, password, database,
    charset: 'utf8mb4',
    multipleStatements: false,
  });

  // Create migration_log table if it doesn't exist
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS migration_log (
      id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      bot_id                 VARCHAR(128) NOT NULL,
      bot_name               VARCHAR(64)  NOT NULL,
      total_messages         INT UNSIGNED NOT NULL DEFAULT 0,
      duplicates_overwritten INT UNSIGNED NOT NULL DEFAULT 0,
      expected_to_migrate    INT UNSIGNED NOT NULL DEFAULT 0,
      already_in_db          INT UNSIGNED NOT NULL DEFAULT 0,
      actually_inserted      INT UNSIGNED NOT NULL DEFAULT 0,
      ichancy_matched        INT UNSIGNED NOT NULL DEFAULT 0,
      ichancy_not_matched    INT UNSIGNED NOT NULL DEFAULT 0,
      status                 ENUM('SUCCESS','FAILED','DRY_RUN') NOT NULL DEFAULT 'SUCCESS',
      error_message          TEXT NULL,
      migrated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.beginTransaction();

  try {
    console.log(`\n${'━'.repeat(55)}`);
    console.log(`Processing: PARADISE (bot_id: ${BOT_ID})`);
    console.log('━'.repeat(55));

    // 1. Parse user data
    const { userMap, totalMessages, duplicates } = parseUsersJson(path.join(USERS_DIR, 'paradise.json'));
    console.log(`  paradise.json total messages:         ${totalMessages}`);
    console.log(`  Duplicates (later wins):              ${duplicates}`);
    console.log(`  Unique users after dedup:             ${userMap.size}`);

    // 2. Build ichancy lookup (single file)
    const ichData = JSON.parse(fs.readFileSync(path.join(USERS_DIR, 'paradise_ichancy.json'), 'utf8'));
    const ichancyLookup = new Map();
    for (const r of ichData.result.records) {
      ichancyLookup.set(r.username.toLowerCase(), r.playerId);
    }
    console.log(`  Ichancy records loaded:               ${ichancyLookup.size}`);

    // 3. Check existing users in DB
    const telegramIds = Array.from(userMap.keys());
    const existingSet = new Set();
    const BATCH = 500;
    for (let i = 0; i < telegramIds.length; i += BATCH) {
      const chunk = telegramIds.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT telegram_user_id FROM users WHERE bot_id = ? AND telegram_user_id IN (${placeholders})`,
        [BOT_ID, ...chunk]
      );
      for (const r of rows) existingSet.add(String(r.telegram_user_id));
    }
    console.log(`  Already in DB (will skip):            ${existingSet.size}`);

    const expectedToInsert = userMap.size - existingSet.size;
    console.log(`  Expected to insert:                   ${expectedToInsert}`);

    // 4. Insert new users
    let inserted = 0;
    let ichancyMatched = 0;
    let ichancyNotMatched = 0;

    for (const [telegramId, userData] of userMap) {
      if (existingSet.has(telegramId)) continue;

      const ichancyUserId = ichancyLookup.get(userData.ichancy_login.toLowerCase()) || null;
      if (ichancyUserId) {
        ichancyMatched++;
      } else {
        ichancyNotMatched++;
      }

      if (!DRY_RUN) {
        await connection.execute(
          `INSERT INTO users (bot_id, telegram_user_id, telegram_username, ichancy_login, password, ichancy_user_id, balance, gifts, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, 0.00, 0.00, ?, NOW())`,
          [BOT_ID, telegramId, userData.ichancy_login, userData.password, ichancyUserId, userData.created_at]
        );
      }

      inserted++;
    }

    // 5. Verify
    let dbCountAfter = inserted;
    if (!DRY_RUN) {
      const [countRows] = await connection.execute(
        `SELECT COUNT(*) as cnt FROM users WHERE bot_id = ?`,
        [BOT_ID]
      );
      dbCountAfter = countRows[0].cnt;
    }

    const status = DRY_RUN ? 'DRY_RUN' : (inserted === expectedToInsert ? 'SUCCESS' : 'FAILED');
    const mismatchMsg = inserted !== expectedToInsert
      ? `MISMATCH! expected ${expectedToInsert} but inserted ${inserted}`
      : null;

    if (mismatchMsg && !DRY_RUN) {
      throw new Error(`paradise: ${mismatchMsg}`);
    }

    console.log(`  Actually inserted:                    ${inserted}`);
    console.log(`  Ichancy matched:                      ${ichancyMatched}`);
    console.log(`  Ichancy NOT matched:                  ${ichancyNotMatched}`);
    if (!DRY_RUN) {
      console.log(`  Total rows in DB for this bot:        ${dbCountAfter}`);
    }
    console.log(`  Status:                               ${status === 'SUCCESS' ? '✓ SUCCESS' : status}`);

    // 6. Log to migration_log
    if (!DRY_RUN) {
      await connection.execute(
        `INSERT INTO migration_log
         (bot_id, bot_name, total_messages, duplicates_overwritten, expected_to_migrate,
          already_in_db, actually_inserted, ichancy_matched, ichancy_not_matched, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [BOT_ID, BOT_NAME, totalMessages, duplicates, userMap.size,
         existingSet.size, inserted, ichancyMatched, ichancyNotMatched, status, mismatchMsg]
      );
    }

    // 7. Commit or rollback
    if (DRY_RUN) {
      console.log('\n*** DRY RUN complete — rolling back ***');
      await connection.rollback();
    } else {
      await connection.commit();
      console.log('\n*** Transaction COMMITTED successfully ***');
    }

    console.log(`\n${'━'.repeat(55)}`);
    console.log('MIGRATION SUMMARY');
    console.log('━'.repeat(55));
    console.log(`  Expected to insert:   ${expectedToInsert}`);
    console.log(`  Actually inserted:    ${inserted}`);
    console.log(`  Skipped (existing):   ${existingSet.size}`);
    console.log(`  Ichancy matched:      ${ichancyMatched}`);
    console.log(`  Ichancy NOT matched:  ${ichancyNotMatched}`);
    console.log(`  Match:                ${expectedToInsert === inserted ? '✓ ALL GOOD' : '✗ MISMATCH'}`);
    console.log('━'.repeat(55));

  } catch (err) {
    console.error('\n!!! ERROR — rolling back transaction !!!');
    console.error(err.message || err);
    try {
      await connection.rollback();
      console.log('Transaction rolled back successfully. 0 rows were inserted.');
    } catch (rbErr) {
      console.error('Rollback also failed:', rbErr.message);
    }
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
