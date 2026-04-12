/**
 * One-time migration script: import users from JSON files into the database.
 *
 * - Reads botname.json (Telegram channel export) for telegram_id, ichancy_login, password
 * - Reads botname_ichancy.json + botname_ichancy2.json for playerId -> ichancy_user_id mapping
 * - If same telegram_id appears twice, keeps the LATER message (user updated account)
 * - Runs everything in a single transaction — rolls back on any error
 * - Logs per-bot expected vs actual counts into migration_log table
 *
 *
 * Usage:  node migrate_users.js [--dry-run]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BOT_MAP = {
  ultra: 'Ultra909_bot',
  leen: 'leen789_bot',
  chucky: 'Chucky9393_bot',
  berlin: 'Berlin8889_bot',
};

const USERS_DIR = path.join(__dirname, 'users');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseUsersJson(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const messages = data.messages.filter(m => m.type === 'message');

  // Map: telegram_id -> { ichancy_login, password, date }
  // Later messages overwrite earlier ones (user updated account)
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
      // Edge case: password is plain text instead of code element (e.g. leen msg 171)
      [telegramId, ichancyLogin] = codeElements;
      // Find password: plain text after the password bold label "كلمة المرور:"
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
      console.warn(`  [WARN] Message id=${msg.id} has ${codeElements.length} code elements, skipping`);
      continue;
    }

    // Validate telegram_id is numeric
    if (!/^\d+$/.test(telegramId)) {
      console.warn(`  [WARN] Message id=${msg.id} has non-numeric telegram_id "${telegramId}", skipping`);
      continue;
    }

    if (userMap.has(telegramId)) duplicates++;
    userMap.set(telegramId, {
      telegram_user_id: telegramId,
      ichancy_login: ichancyLogin,
      password: pwd,
      created_at: msg.date.replace('T', ' '),  // ISO -> MySQL datetime
    });
  }

  return { userMap, totalMessages: messages.length, duplicates };
}

function parseIchancyJson(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.result.records;
}

function buildIchancyLookup(botName) {
  const records = [
    ...parseIchancyJson(path.join(USERS_DIR, `${botName}_ichancy.json`)),
    ...parseIchancyJson(path.join(USERS_DIR, `${botName}_ichancy2.json`)),
  ];

  // Map: lowercase username -> playerId
  const lookup = new Map();
  for (const r of records) {
    lookup.set(r.username.toLowerCase(), r.playerId);
  }
  return lookup;
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

  // Create migration_log table if it doesn't exist (outside transaction — DDL auto-commits in MySQL)
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

  const botStats = []; // collect stats for each bot

  try {
    let grandExpected = 0;
    let grandInserted = 0;
    let grandSkipped = 0;
    let grandIchancyMatched = 0;
    let grandIchancyNotMatched = 0;

    for (const [botName, botId] of Object.entries(BOT_MAP)) {
      console.log(`\n${'━'.repeat(55)}`);
      console.log(`Processing: ${botName.toUpperCase()} (bot_id: ${botId})`);
      console.log('━'.repeat(55));

      // 1. Parse user data from Telegram export
      const { userMap, totalMessages, duplicates } = parseUsersJson(path.join(USERS_DIR, `${botName}.json`));
      console.log(`  ${botName}.json total messages:       ${totalMessages}`);
      console.log(`  Duplicates (later wins):              ${duplicates}`);
      console.log(`  Unique users after dedup:             ${userMap.size}`);

      // 2. Build ichancy playerId lookup
      const ichancyLookup = buildIchancyLookup(botName);
      console.log(`  Ichancy records loaded:               ${ichancyLookup.size}`);

      // 3. Check which telegram_user_ids already exist in DB for this bot
      const telegramIds = Array.from(userMap.keys());
      const existingSet = new Set();
      const BATCH = 500;
      for (let i = 0; i < telegramIds.length; i += BATCH) {
        const chunk = telegramIds.slice(i, i + BATCH);
        const placeholders = chunk.map(() => '?').join(',');
        const [rows] = await connection.execute(
          `SELECT telegram_user_id FROM users WHERE bot_id = ? AND telegram_user_id IN (${placeholders})`,
          [botId, ...chunk]
        );
        for (const r of rows) existingSet.add(String(r.telegram_user_id));
      }
      console.log(`  Already in DB (will skip):            ${existingSet.size}`);

      const expectedToInsert = userMap.size - existingSet.size;
      console.log(`  Expected to insert:                   ${expectedToInsert}`);

      // 4. Insert new users
      let inserted = 0;
      let skipped = existingSet.size;
      let ichancyMatched = 0;
      let ichancyNotMatched = 0;

      for (const [telegramId, userData] of userMap) {
        if (existingSet.has(telegramId)) {
          continue;
        }

        // Lookup ichancy_user_id by matching ichancy_login (case-insensitive)
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
            [
              botId,
              telegramId,
              userData.ichancy_login,
              userData.password,
              ichancyUserId,
              userData.created_at,
            ]
          );
        }

        inserted++;
      }

      // 5. Verify count in DB after insert
      let dbCountAfter = inserted; // for dry run, assume all would succeed
      if (!DRY_RUN) {
        const [countRows] = await connection.execute(
          `SELECT COUNT(*) as cnt FROM users WHERE bot_id = ?`,
          [botId]
        );
        dbCountAfter = countRows[0].cnt;
      }

      const status = DRY_RUN ? 'DRY_RUN' : (inserted === expectedToInsert ? 'SUCCESS' : 'FAILED');
      const mismatchMsg = inserted !== expectedToInsert
        ? `MISMATCH! expected ${expectedToInsert} but inserted ${inserted}`
        : null;

      if (mismatchMsg && !DRY_RUN) {
        throw new Error(`${botName}: ${mismatchMsg}`);
      }

      console.log(`  Actually inserted:                    ${inserted}`);
      console.log(`  Ichancy matched:                      ${ichancyMatched}`);
      console.log(`  Ichancy NOT matched:                  ${ichancyNotMatched}`);
      if (!DRY_RUN) {
        console.log(`  Total rows in DB for this bot:        ${dbCountAfter}`);
      }
      console.log(`  Status:                               ${status === 'SUCCESS' ? '✓ SUCCESS' : status}`);

      // Collect stats for migration_log
      botStats.push({
        botId, botName, totalMessages, duplicates,
        expectedToMigrate: userMap.size,
        alreadyInDb: existingSet.size,
        inserted, ichancyMatched, ichancyNotMatched, status,
        errorMessage: mismatchMsg,
      });

      grandExpected += expectedToInsert;
      grandInserted += inserted;
      grandSkipped += skipped;
      grandIchancyMatched += ichancyMatched;
      grandIchancyNotMatched += ichancyNotMatched;
    }

    // 6. Write migration_log entries
    for (const s of botStats) {
      if (!DRY_RUN) {
        await connection.execute(
          `INSERT INTO migration_log
           (bot_id, bot_name, total_messages, duplicates_overwritten, expected_to_migrate,
            already_in_db, actually_inserted, ichancy_matched, ichancy_not_matched, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.botId, s.botName, s.totalMessages, s.duplicates,
            s.expectedToMigrate, s.alreadyInDb, s.inserted,
            s.ichancyMatched, s.ichancyNotMatched, s.status,
            s.errorMessage,
          ]
        );
      }
    }

    // 7. Commit or rollback
    if (DRY_RUN) {
      console.log('\n*** DRY RUN complete — rolling back ***');
      await connection.rollback();
    } else {
      await connection.commit();
      console.log('\n*** Transaction COMMITTED successfully ***');
    }

    // Final summary
    console.log(`\n${'━'.repeat(55)}`);
    console.log('MIGRATION SUMMARY');
    console.log('━'.repeat(55));
    console.log(`  Expected to insert:   ${grandExpected}`);
    console.log(`  Actually inserted:    ${grandInserted}`);
    console.log(`  Skipped (existing):   ${grandSkipped}`);
    console.log(`  Ichancy matched:      ${grandIchancyMatched}`);
    console.log(`  Ichancy NOT matched:  ${grandIchancyNotMatched}`);
    console.log(`  Match:                ${grandExpected === grandInserted ? '✓ ALL GOOD' : '✗ MISMATCH'}`);
    console.log('━'.repeat(55));

    if (!DRY_RUN) {
      console.log('\nVerify with: SELECT bot_id, bot_name, expected_to_migrate, actually_inserted, status FROM migration_log ORDER BY id;');
    }

  } catch (err) {
    console.error('\n!!! ERROR — rolling back transaction !!!');
    console.error(err.message || err);

    // Try to log the failure
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
