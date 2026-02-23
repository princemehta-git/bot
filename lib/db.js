/**
 * Sequelize-based DB layer with multi-bot support.
 *
 * - initDb(): creates database, syncs schema (call once at startup)
 * - createBotDb(botId): returns all query/config functions scoped to a specific bot
 * - Admin helpers: getAllBots(), createBotRow(), updateBotRow(), deleteBotRow()
 */

const { Sequelize, DataTypes, Op } = require('sequelize');
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ichancy_bot';

let sequelize;
let User;
let DeletedUser;
let GiftCode;
let GiftCodeRedemption;
let ReferralEarning;
let Transaction;
let SyriatelUsedTransaction;
let ShamcashUsedTransaction;
let Bot;
let PaymentProvider;
let ShamcashPendingWithdrawal;

async function initDb() {
  const conn = await mysql.createConnection({ host, port, user, password, charset: 'utf8mb4' });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();

  sequelize = new Sequelize(database, user, password, {
    host,
    port,
    dialect: 'mysql',
    dialectModule: require('mysql2'),
    logging: false,
    define: { underscored: true, timestamps: true, updatedAt: 'updated_at', createdAt: 'created_at' },
    pool: { max: 20, min: 0, acquire: 10000 },
  });

  // ── Models ──────────────────────────────────────────────────────────

  User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
    telegram_username: { type: DataTypes.STRING(255) },
    first_name: { type: DataTypes.STRING(255) },
    last_name: { type: DataTypes.STRING(255) },
    ichancy_login: { type: DataTypes.STRING(255) },
    password: { type: DataTypes.STRING(255) },
    balance: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    gifts: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    ichancy_user_id: { type: DataTypes.STRING(64), allowNull: true },
    wheel_spins_available_today: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    last_spin_grant_date: { type: DataTypes.DATEONLY, allowNull: true },
    last_box_game_at: { type: DataTypes.DATE, allowNull: true },
    referred_by: { type: DataTypes.BIGINT, allowNull: true },
    referral_balance: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'users',
    indexes: [{ unique: true, fields: ['bot_id', 'telegram_user_id'] }],
  });

  DeletedUser = sequelize.define('DeletedUser', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
    telegram_username: { type: DataTypes.STRING(255) },
    first_name: { type: DataTypes.STRING(255) },
    last_name: { type: DataTypes.STRING(255) },
    ichancy_login: { type: DataTypes.STRING(255) },
    password: { type: DataTypes.STRING(255) },
    balance: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    gifts: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    ichancy_user_id: { type: DataTypes.STRING(64) },
    wheel_spins_available_today: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
    last_spin_grant_date: { type: DataTypes.DATEONLY, allowNull: true },
    last_box_game_at: { type: DataTypes.DATE, allowNull: true },
    deleted_at: { type: DataTypes.DATE, allowNull: false },
  }, { tableName: 'deleted_users', timestamps: false });

  GiftCode = sequelize.define('GiftCode', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    code: { type: DataTypes.STRING(64), allowNull: false },
    amount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    expiry_date: { type: DataTypes.DATE, allowNull: true },
    max_redemptions: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'gift_codes',
    indexes: [{ unique: true, fields: ['bot_id', 'code'] }],
  });

  GiftCodeRedemption = sequelize.define('GiftCodeRedemption', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    gift_code_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, references: { model: 'gift_codes', key: 'id', onDelete: 'CASCADE' } },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
  }, {
    tableName: 'gift_code_redemptions',
    timestamps: true,
    updatedAt: false,
    createdAt: 'redeemed_at',
    indexes: [{ unique: true, fields: ['gift_code_id', 'telegram_user_id'] }],
  });

  GiftCode.hasMany(GiftCodeRedemption, { foreignKey: 'gift_code_id' });
  GiftCodeRedemption.belongsTo(GiftCode, { foreignKey: 'gift_code_id' });

  ReferralEarning = sequelize.define('ReferralEarning', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
    from_user_id: { type: DataTypes.BIGINT, allowNull: false },
    level: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    source_amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    commission: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    distributed_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'referral_earnings',
    timestamps: true,
    updatedAt: false,
    createdAt: 'created_at',
    indexes: [{ fields: ['bot_id', 'telegram_user_id'] }],
  });

  Transaction = sequelize.define('Transaction', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
    type: { type: DataTypes.ENUM('deposit', 'withdrawal'), allowNull: false },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    method: { type: DataTypes.STRING(64), allowNull: false },
    transfer_id: { type: DataTypes.STRING(128), allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'confirmed', 'rejected'), allowNull: false, defaultValue: 'pending' },
  }, {
    tableName: 'transactions',
    timestamps: true,
    updatedAt: false,
    createdAt: 'created_at',
    indexes: [{ fields: ['bot_id', 'telegram_user_id', 'type'] }],
  });

  SyriatelUsedTransaction = sequelize.define('SyriatelUsedTransaction', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    transaction_no: { type: DataTypes.STRING(128), allowNull: false },
    used_at: { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'syriatel_used_transactions',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['bot_id', 'transaction_no'] },
      { fields: ['bot_id', 'used_at'] },
    ],
  });

  ShamcashUsedTransaction = sequelize.define('ShamcashUsedTransaction', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    transaction_no: { type: DataTypes.STRING(128), allowNull: false },
    used_at: { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'shamcash_used_transactions',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['bot_id', 'transaction_no'] },
      { fields: ['bot_id', 'used_at'] },
    ],
  });

  PaymentProvider = sequelize.define('PaymentProvider', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false },
    provider_name: { type: DataTypes.ENUM('syriatel', 'shamcash'), allowNull: false },
    min_deposit_syp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    min_cashout_syp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 25000 },
    max_cashout_syp: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 250000 },
    cashout_tax_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    deposit_bonus_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'payment_providers',
    indexes: [{ unique: true, fields: ['bot_id', 'provider_name'] }],
    timestamps: true,
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  });

  ShamcashPendingWithdrawal = sequelize.define('ShamcashPendingWithdrawal', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false },
    telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
    amount_syp: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    currency: { type: DataTypes.ENUM('usd', 'syp'), allowNull: false },
    amount_display: { type: DataTypes.STRING(64), allowNull: false },
    client_code: { type: DataTypes.STRING(128), allowNull: false },
    transaction_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'accepted', 'rejected'), allowNull: false, defaultValue: 'pending' },
    resolved_at: { type: DataTypes.DATE, allowNull: true },
    resolved_by: { type: DataTypes.STRING(64), allowNull: true },
  }, {
    tableName: 'shamcash_pending_withdrawals',
    timestamps: true,
    updatedAt: false,
    createdAt: 'created_at',
    indexes: [
      { fields: ['bot_id', 'status'] },
      { fields: ['bot_id', 'telegram_user_id'] },
    ],
  });

  Bot = sequelize.define('Bot', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    bot_off: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    bot_token: { type: DataTypes.STRING(255), allowNull: true },
    bot_username: { type: DataTypes.STRING(128), allowNull: true },
    bot_display_name: { type: DataTypes.STRING(255), allowNull: true, defaultValue: 'Bot' },
    username_prefix: { type: DataTypes.STRING(64), allowNull: true, defaultValue: 'Bot-' },
    channel_username: { type: DataTypes.STRING(255), allowNull: true },
    debug_mode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    debug_logs: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    cookie_refresh_interval_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    ichancy_agent_username: { type: DataTypes.STRING(255), allowNull: true },
    ichancy_agent_password: { type: DataTypes.STRING(255), allowNull: true },
    ichancy_parent_id: { type: DataTypes.STRING(64), allowNull: true },
    golden_tree_url: { type: DataTypes.TEXT, allowNull: true },
    ichancy_site_url: { type: DataTypes.STRING(512), allowNull: true },
    exchange_rate_syp_per_usd: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 15000 },
    syriatel_deposit_numbers: { type: DataTypes.TEXT, allowNull: true },
    sham_cash_deposit_code: { type: DataTypes.STRING(255), allowNull: true },
    alert_channel_accounts: { type: DataTypes.STRING(255), allowNull: true },
    alert_channel_transactions: { type: DataTypes.STRING(255), allowNull: true },
    support_username: { type: DataTypes.STRING(128), allowNull: true },
    admin_username: { type: DataTypes.STRING(128), allowNull: true },
    timezone: { type: DataTypes.STRING(64), allowNull: true, defaultValue: 'Asia/Damascus' },
    referral_level1_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 5 },
    referral_level2_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 3 },
    referral_level3_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 2 },
    deposit_required_ls: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50000 },
    active_referrals_required: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    deposit_syriatel_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    deposit_shamcash_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    withdraw_syriatel_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    withdraw_shamcash_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    syriatel_api_key: { type: DataTypes.STRING(255), allowNull: true },
    syriatel_pin: { type: DataTypes.STRING(64), allowNull: true },
    blocked_users: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
    spin_prizes: { type: DataTypes.JSON, allowNull: true, defaultValue: [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }] },
    luck_box_prizes: { type: DataTypes.JSON, allowNull: true, defaultValue: [{ amount: 0, weight: 0 }, { amount: 0, weight: 0 }, { amount: 0, weight: 0 }] },
  }, { tableName: 'bots', indexes: [{ unique: true, fields: ['bot_id'] }] });

  // ── Migrations ──────────────────────────────────────────────────────

  await migratePaymentProvidersFromBotsIfNeeded();

  // Drop the old unique index on telegram_user_id alone (if it still exists) before sync
  try {
    const [idxRows] = await sequelize.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'telegram_user_id' AND INDEX_NAME != 'PRIMARY'",
      { replacements: [database] }
    );
    for (const r of (idxRows || [])) {
      const idxName = r.INDEX_NAME;
      // Check if this index is ONLY on telegram_user_id (no bot_id)
      const [idxCols] = await sequelize.query(
        "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = ?",
        { replacements: [database, idxName] }
      );
      if (idxCols[0] && idxCols[0].cols === 'telegram_user_id') {
        await sequelize.query(`ALTER TABLE users DROP INDEX \`${idxName}\``).catch(() => {});
      }
    }
  } catch (_) {}

  // Same for gift_codes: drop old unique on code alone
  try {
    const [idxRows] = await sequelize.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_codes' AND COLUMN_NAME = 'code' AND INDEX_NAME != 'PRIMARY'",
      { replacements: [database] }
    );
    for (const r of (idxRows || [])) {
      const idxName = r.INDEX_NAME;
      const [idxCols] = await sequelize.query(
        "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_codes' AND INDEX_NAME = ?",
        { replacements: [database, idxName] }
      );
      if (idxCols[0] && idxCols[0].cols === 'code') {
        await sequelize.query(`ALTER TABLE gift_codes DROP INDEX \`${idxName}\``).catch(() => {});
      }
    }
  } catch (_) {}

  await sequelize.sync({ alter: true });
  await migrateFromBotConfigTable();
  await migrateExistingDataBotId();

  return sequelize;
}

/**
 * One-time: migrate payment provider limits from old bots columns to payment_providers table.
 */
async function migratePaymentProvidersFromBotsIfNeeded() {
  try {
    const [cols] = await sequelize.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'sham_syp_per_usd'",
      { replacements: [database] }
    );
    if (!cols || cols.length === 0) return;

    const [botRows] = await sequelize.query('SELECT id, bot_id, sham_syp_per_usd, charge_syriatel_min, charge_syriatel_max, syriatel_min, syriatel_max, charge_sham_syp_min, charge_sham_syp_max, sham_syp_min, sham_syp_max FROM bots');
    for (const row of (botRows || [])) {
      const bid = row.bot_id;
      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS payment_providers (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT, bot_id VARCHAR(128) NOT NULL,
          provider_name ENUM('syriatel','shamcash') NOT NULL,
          min_deposit_syp INT NOT NULL DEFAULT 50, min_cashout_syp INT NOT NULL DEFAULT 25000,
          max_cashout_syp INT NOT NULL DEFAULT 250000, cashout_tax_percent FLOAT NOT NULL DEFAULT 0,
          deposit_bonus_percent FLOAT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id), UNIQUE KEY bot_provider (bot_id, provider_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      await sequelize.query(
        `INSERT IGNORE INTO payment_providers (bot_id, provider_name, min_deposit_syp, min_cashout_syp, max_cashout_syp)
         VALUES (?, 'syriatel', ?, ?, ?), (?, 'shamcash', ?, ?, ?)`,
        { replacements: [
          bid, row.charge_syriatel_min ?? 50, row.syriatel_min ?? 1000, row.syriatel_max ?? 500000,
          bid, row.charge_sham_syp_min ?? 0, row.sham_syp_min ?? 100000, row.sham_syp_max ?? 2500000,
        ] }
      );
      const [hasNewCol] = await sequelize.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'exchange_rate_syp_per_usd'",
        { replacements: [database] }
      );
      if (!hasNewCol || hasNewCol.length === 0) {
        await sequelize.query('ALTER TABLE bots ADD COLUMN exchange_rate_syp_per_usd FLOAT NOT NULL DEFAULT 15000');
      }
      await sequelize.query('UPDATE bots SET exchange_rate_syp_per_usd = sham_syp_per_usd WHERE bot_id = ?', { replacements: [bid] });
    }
    const drops = [
      'sham_syp_per_usd', 'sham_usd_min', 'sham_usd_max', 'sham_syp_min', 'sham_syp_max',
      'syriatel_min', 'syriatel_max', 'charge_syriatel_min', 'charge_syriatel_max',
      'charge_sham_usd_min', 'charge_sham_usd_max', 'charge_sham_syp_min', 'charge_sham_syp_max',
    ];
    for (const col of drops) {
      await sequelize.query(`ALTER TABLE bots DROP COLUMN \`${col}\``).catch(() => {});
    }
    console.log('Migrated payment provider limits to payment_providers table.');
  } catch (err) {
    console.warn('migratePaymentProvidersFromBotsIfNeeded:', err.message);
  }
}

async function migrateFromBotConfigTable() {
  try {
    const [tables] = await sequelize.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bot_config'",
      { replacements: [database] }
    );
    if (!tables || tables.length === 0) return;

    const [rows] = await sequelize.query('SELECT DISTINCT bot_id FROM bot_config WHERE bot_id IS NOT NULL AND bot_id != ""');
    const botIds = rows.map(r => r.bot_id);
    if (botIds.length === 0) {
      await sequelize.query('DROP TABLE IF EXISTS bot_config');
      return;
    }

    for (const bid of botIds) {
      const existing = await Bot.findOne({ where: { bot_id: bid } });
      if (existing) continue;

      const [cfgRows] = await sequelize.query(
        'SELECT config_key, config_value FROM bot_config WHERE bot_id = ?',
        { replacements: [bid] }
      );
      if (!cfgRows || cfgRows.length === 0) continue;

      const data = { bot_id: bid };
      const boolFields = ['debug_mode', 'debug_logs', 'is_active', 'bot_off'];
      const intFields = ['deposit_required_ls', 'active_referrals_required', 'cookie_refresh_interval_minutes'];
      const floatFields = ['referral_level1_percent', 'referral_level2_percent', 'referral_level3_percent'];
      for (const { config_key, config_value } of cfgRows) {
        const col = config_key.toLowerCase();
        if (boolFields.includes(col)) data[col] = config_value === 'true' || config_value === '1';
        else if (intFields.includes(col)) data[col] = parseInt(config_value, 10) || 0;
        else if (floatFields.includes(col)) data[col] = parseFloat(config_value) || 0;
        else data[col] = config_value;
      }
      await Bot.create(data);
    }
    await sequelize.query('DROP TABLE IF EXISTS bot_config');
    console.log('Migrated bot config from bot_config table to bots table.');
  } catch (err) {
    console.warn('migrateFromBotConfigTable:', err.message);
  }
}

/**
 * One-time: assign bot_id to existing rows that don't have one yet.
 * Uses the first active bot's bot_id as default.
 */
async function migrateExistingDataBotId() {
  try {
    const [bots] = await sequelize.query("SELECT bot_id FROM bots ORDER BY is_active DESC, id ASC LIMIT 1");
    if (!bots || bots.length === 0) return;
    const defaultBid = bots[0].bot_id;
    const tables = ['users', 'deleted_users', 'gift_codes', 'gift_code_redemptions', 'referral_earnings', 'transactions'];
    for (const tbl of tables) {
      try {
        await sequelize.query(`UPDATE \`${tbl}\` SET bot_id = ? WHERE bot_id = '' OR bot_id IS NULL`, { replacements: [defaultBid] });
      } catch (_) {}
    }
  } catch (_) {}
}

// ── Helpers ──────────────────────────────────────────────────────────

function toPlainSnake(row) {
  if (!row) return null;
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    bot_id: p.bot_id,
    telegram_user_id: p.telegram_user_id,
    telegram_username: p.telegram_username,
    first_name: p.first_name,
    last_name: p.last_name,
    ichancy_login: p.ichancy_login,
    password: p.password,
    balance: p.balance,
    gifts: p.gifts,
    ichancy_user_id: p.ichancy_user_id,
    wheel_spins_available_today: p.wheel_spins_available_today ?? 0,
    last_spin_grant_date: p.last_spin_grant_date || null,
    last_box_game_at: p.last_box_game_at || null,
    referred_by: p.referred_by || null,
    referral_balance: p.referral_balance ?? 0,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// ── Per-bot DB context factory ───────────────────────────────────────

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

function createBotDb(bid) {
  let botConfigRow = {};
  let providerConfigCache = {};

  // ── User functions ──

  async function getUserByTelegramId(telegramUserId) {
    if (!User) throw new Error('DB not initialized');
    const row = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    return toPlainSnake(row);
  }

  async function createOrUpdateUser(telegramUserId, fields = {}) {
    if (!User) throw new Error('DB not initialized');
    const existing = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    const plain = existing ? existing.get({ plain: true }) : {};

    const payload = {
      telegram_username: fields.telegram_username !== undefined ? fields.telegram_username : plain.telegram_username,
      first_name: fields.first_name !== undefined ? fields.first_name : plain.first_name,
      last_name: fields.last_name !== undefined ? fields.last_name : plain.last_name,
      ichancy_login: fields.ichancy_login !== undefined ? fields.ichancy_login : plain.ichancy_login,
      password: fields.password !== undefined ? fields.password : plain.password,
      balance: fields.balance !== undefined ? Number(fields.balance) : Number(plain.balance || 0),
      gifts: fields.gifts !== undefined ? Number(fields.gifts) : Number(plain.gifts || 0),
      ichancy_user_id: fields.ichancy_user_id !== undefined ? fields.ichancy_user_id : plain.ichancy_user_id,
      wheel_spins_available_today: fields.wheel_spins_available_today !== undefined ? fields.wheel_spins_available_today : (plain.wheel_spins_available_today ?? 0),
      last_spin_grant_date: fields.last_spin_grant_date !== undefined ? fields.last_spin_grant_date : (plain.last_spin_grant_date || null),
      last_box_game_at: fields.last_box_game_at !== undefined ? fields.last_box_game_at : (plain.last_box_game_at || null),
      referred_by: fields.referred_by !== undefined ? fields.referred_by : (plain.referred_by || null),
      referral_balance: fields.referral_balance !== undefined ? Number(fields.referral_balance) : Number(plain.referral_balance || 0),
    };

    if (existing) {
      await existing.update(payload);
      return toPlainSnake(await existing.reload());
    }
    const created = await User.create({ bot_id: bid, telegram_user_id: telegramUserId, ...payload });
    return toPlainSnake(created);
  }

  /** Atomic spin use: credit amount and decrement wheel_spins_available_today only if > 0. Returns true if applied. */
  async function useSpinCredit(telegramUserId, amount) {
    if (!User) throw new Error('DB not initialized');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return false;
    const [result, metadata] = await sequelize.query(
      'UPDATE users SET balance = balance + ?, wheel_spins_available_today = wheel_spins_available_today - 1 WHERE bot_id = ? AND telegram_user_id = ? AND wheel_spins_available_today > 0',
      { replacements: [amt, bid, telegramUserId] }
    );
    const affected = (result && result.affectedRows) ?? (metadata && metadata.affectedRows) ?? 0;
    return affected > 0;
  }

  /** Sum of confirmed deposits in the last 24 hours for a user (for daily spin eligibility). */
  async function getDepositSumLast24h(telegramUserId) {
    if (!Transaction) return 0;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sum = await Transaction.sum('amount', {
      where: {
        bot_id: bid,
        telegram_user_id: telegramUserId,
        type: 'deposit',
        status: 'confirmed',
        created_at: { [Op.gte]: since },
      },
    });
    return Number(sum) || 0;
  }

  /** Count of direct referrals who had at least one confirmed deposit in the last 24 hours. */
  async function getActiveReferralsCountLast24h(telegramUserId) {
    if (!User || !Transaction) return 0;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [rows] = await sequelize.query(
      `SELECT COUNT(DISTINCT t.telegram_user_id) AS cnt
       FROM transactions t
       INNER JOIN users u ON u.bot_id = t.bot_id AND u.telegram_user_id = t.telegram_user_id AND u.referred_by = ?
       WHERE t.bot_id = ? AND t.type = 'deposit' AND t.status = 'confirmed' AND t.created_at >= ?`,
      { replacements: [telegramUserId, bid, since] }
    );
    return Number(rows?.[0]?.cnt) || 0;
  }

  /**
   * Grant 1 daily spin if user is eligible and not yet granted today.
   * Eligibility: deposit in last 24h >= deposit_required_ls OR active referrals in last 24h >= active_referrals_required.
   * Uses Syria date (Asia/Damascus) for "today". Caps at 1 spin per day.
   * Resets wheel_spins_available_today to 0 when a new day starts (so previous day's unused spin is cleared).
   */
  async function ensureDailySpinEligibility(telegramUserId) {
    if (!User) return;
    const depositRequired = Number(await getConfigValue('deposit_required_ls', 50000)) || 50000;
    const referralsRequired = Number(await getConfigValue('active_referrals_required', 5)) || 5;
    const [depositSum, activeRefs, userRow] = await Promise.all([
      getDepositSumLast24h(telegramUserId),
      getActiveReferralsCountLast24h(telegramUserId),
      User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId }, attributes: ['id', 'wheel_spins_available_today', 'last_spin_grant_date'] }),
    ]);
    if (!userRow) return;
    const plain = userRow.get ? userRow.get({ plain: true }) : userRow;
    const now = new Date();
    const syriaToday = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Damascus' }); // YYYY-MM-DD in Syria
    const lastGrant = plain.last_spin_grant_date ? String(plain.last_spin_grant_date) : null;
    if (lastGrant && lastGrant < syriaToday) {
      await userRow.update({ wheel_spins_available_today: 0, last_spin_grant_date: null });
    }
    const eligible = depositSum >= depositRequired || activeRefs >= referralsRequired;
    if (!eligible) return;
    if (lastGrant && lastGrant >= syriaToday) return;
    const currentRow = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId }, attributes: ['wheel_spins_available_today'] });
    const spinCount = Number(currentRow?.wheel_spins_available_today ?? 0);
    if (spinCount >= 1) return;
    await User.update(
      { wheel_spins_available_today: 1, last_spin_grant_date: syriaToday },
      { where: { bot_id: bid, telegram_user_id: telegramUserId } }
    );
  }

  async function moveUserToDeletedUsers(telegramUserId) {
    if (!User || !DeletedUser) throw new Error('DB not initialized');
    const row = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    if (!row) return null;
    const plain = row.get({ plain: true });
    await DeletedUser.create({
      bot_id: bid,
      telegram_user_id: plain.telegram_user_id,
      telegram_username: plain.telegram_username,
      first_name: plain.first_name,
      last_name: plain.last_name,
      ichancy_login: plain.ichancy_login,
      password: plain.password,
      balance: Number(plain.balance || 0),
      gifts: Number(plain.gifts || 0),
      ichancy_user_id: plain.ichancy_user_id,
      wheel_spins_available_today: plain.wheel_spins_available_today ?? 0,
      last_spin_grant_date: plain.last_spin_grant_date || null,
      last_box_game_at: plain.last_box_game_at || null,
      deleted_at: new Date(),
    });
    await row.destroy();
    return plain;
  }

  // ── Gift code functions ──

  async function redeemGiftCode(code, telegramUserId) {
    if (!GiftCode || !GiftCodeRedemption || !User) throw new Error('DB not initialized');
    const codeUpper = (code || '').trim().toUpperCase();
    if (!codeUpper) return { error: 'empty' };

    const t = await sequelize.transaction();
    try {
      const giftCode = await GiftCode.findOne({ where: { bot_id: bid, code: codeUpper }, lock: true, transaction: t });
      if (!giftCode || !giftCode.is_active) { await t.rollback(); return { error: 'invalid' }; }
      const now = new Date();
      if (giftCode.expiry_date && new Date(giftCode.expiry_date) < now) {
        await giftCode.destroy({ transaction: t });
        await t.commit();
        return { error: 'expired' };
      }
      if (giftCode.max_redemptions != null) {
        const count = await GiftCodeRedemption.count({ where: { gift_code_id: giftCode.id }, transaction: t });
        if (count >= giftCode.max_redemptions) { await t.rollback(); return { error: 'exhausted' }; }
      }
      const alreadyRedeemed = await GiftCodeRedemption.findOne({ where: { gift_code_id: giftCode.id, telegram_user_id: telegramUserId }, transaction: t });
      if (alreadyRedeemed) { await t.rollback(); return { error: 'already_used' }; }
      await GiftCodeRedemption.create({ bot_id: bid, gift_code_id: giftCode.id, telegram_user_id: telegramUserId }, { transaction: t });
      const amount = Number(giftCode.amount);
      const existing = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId }, transaction: t });
      const newBalance = Number(existing?.balance ?? 0) + amount;
      if (existing) {
        await existing.update({ balance: newBalance }, { transaction: t });
      } else {
        await User.create({ bot_id: bid, telegram_user_id: telegramUserId, balance: newBalance, gifts: 0 }, { transaction: t });
      }
      await t.commit();
      return { amount };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  async function deleteExpiredGiftCodes() {
    if (!GiftCode) throw new Error('DB not initialized');
    return GiftCode.destroy({ where: { bot_id: bid, expiry_date: { [Op.lt]: new Date() } } });
  }

  async function createGiftCode(opts) {
    if (!GiftCode) throw new Error('DB not initialized');
    const code = (opts.code || '').trim().toUpperCase();
    if (!code) throw new Error('code is required');
    const amount = parseInt(opts.amount, 10);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive number');
    const expiryDate = opts.expiryDate ? new Date(opts.expiryDate) : null;
    const maxRedemptions = opts.maxRedemptions != null ? parseInt(opts.maxRedemptions, 10) : null;
    const [row, created] = await GiftCode.findOrCreate({
      where: { bot_id: bid, code },
      defaults: { bot_id: bid, code, amount, expiry_date: expiryDate, max_redemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : null, is_active: true },
    });
    if (!created) {
      await row.update({ amount, expiry_date: expiryDate, max_redemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : null, is_active: true });
    }
    return { row: row.get ? row.get({ plain: true }) : row, created };
  }

  async function listGiftCodes(opts = {}) {
    if (!GiftCode || !GiftCodeRedemption) throw new Error('DB not initialized');
    const where = { bot_id: bid };
    if (opts.activeOnly) where.is_active = true;
    const codes = await GiftCode.findAll({ where, order: [['id', 'DESC']], attributes: ['id', 'code', 'amount', 'expiry_date', 'max_redemptions', 'is_active'] });
    const result = [];
    for (const row of codes) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const count = await GiftCodeRedemption.count({ where: { gift_code_id: plain.id } });
      result.push({ ...plain, redemption_count: count });
    }
    return result;
  }

  async function getGiftCodeById(id) {
    if (!GiftCode) throw new Error('DB not initialized');
    const row = await GiftCode.findOne({ where: { id, bot_id: bid } });
    return row ? (row.get ? row.get({ plain: true }) : row) : null;
  }

  async function updateGiftCode(id, opts) {
    if (!GiftCode) throw new Error('DB not initialized');
    const row = await GiftCode.findOne({ where: { id, bot_id: bid } });
    if (!row) throw new Error('Gift code not found');
    const updates = {};
    if (opts.amount != null) updates.amount = parseInt(opts.amount, 10);
    if (opts.expiryDate !== undefined) updates.expiry_date = opts.expiryDate ? new Date(opts.expiryDate) : null;
    if (opts.maxRedemptions !== undefined) updates.max_redemptions = opts.maxRedemptions != null ? parseInt(opts.maxRedemptions, 10) : null;
    if (Object.keys(updates).length) await row.update(updates);
    return row.get ? row.get({ plain: true }) : row;
  }

  async function setGiftCodeActive(id, active) {
    if (!GiftCode) throw new Error('DB not initialized');
    const row = await GiftCode.findOne({ where: { id, bot_id: bid } });
    if (!row) throw new Error('Gift code not found');
    await row.update({ is_active: !!active });
    return row.get ? row.get({ plain: true }) : row;
  }

  async function getRedemptionCount(giftCodeId) {
    if (!GiftCodeRedemption) throw new Error('DB not initialized');
    return GiftCodeRedemption.count({ where: { gift_code_id: giftCodeId } });
  }

  async function deleteGiftCode(id) {
    if (!GiftCode) throw new Error('DB not initialized');
    const row = await GiftCode.findOne({ where: { id, bot_id: bid } });
    if (!row) return false;
    await row.destroy();
    return true;
  }

  // ── Referral functions ──

  async function saveReferral(telegramUserId, referrerTelegramUserId) {
    if (!User) throw new Error('DB not initialized');
    if (String(telegramUserId) === String(referrerTelegramUserId)) return false;
    const row = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    if (!row || row.referred_by) return false;
    const referrerExists = await User.findOne({ where: { bot_id: bid, telegram_user_id: referrerTelegramUserId } });
    if (!referrerExists) return false;
    await row.update({ referred_by: referrerTelegramUserId });
    return true;
  }

  async function distributeReferralCommissions(payerTelegramUserId, paymentAmount, levelPercents) {
    if (!User || !ReferralEarning) throw new Error('DB not initialized');
    const amt = Number(paymentAmount);
    if (!Number.isFinite(amt) || amt <= 0) return [];
    const results = [];
    let currentUserId = payerTelegramUserId;
    for (let level = 1; level <= 3; level++) {
      const currentUser = await User.findOne({ where: { bot_id: bid, telegram_user_id: currentUserId } });
      if (!currentUser || !currentUser.referred_by) break;
      const referrerId = currentUser.referred_by;
      const percent = levelPercents[level - 1] || 0;
      if (percent <= 0) { currentUserId = referrerId; continue; }
      const commission = Math.floor((amt * percent / 100) * 100) / 100;
      if (commission <= 0) { currentUserId = referrerId; continue; }
      const referrer = await User.findOne({ where: { bot_id: bid, telegram_user_id: referrerId } });
      if (!referrer) break;
      await ReferralEarning.create({ bot_id: bid, telegram_user_id: referrerId, from_user_id: payerTelegramUserId, level, source_amount: amt, commission });
      await referrer.update({ referral_balance: Number(referrer.referral_balance || 0) + commission });
      results.push({ telegramUserId: referrerId, level, commission });
      currentUserId = referrerId;
    }
    return results;
  }

  async function getReferralStats(telegramUserId) {
    if (!User || !ReferralEarning) throw new Error('DB not initialized');
    const totalResult = await ReferralEarning.sum('commission', { where: { bot_id: bid, telegram_user_id: telegramUserId } });
    const userRow = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    const referralCount = await User.count({ where: { bot_id: bid, referred_by: telegramUserId } });
    return { totalEarnings: Number(totalResult || 0), referralBalance: Number(userRow?.referral_balance || 0), referralCount };
  }

  async function getPendingReferralStats() {
    if (!ReferralEarning) throw new Error('DB not initialized');
    const now = new Date();
    const readyCutoff = new Date(now.getTime() - TEN_DAYS_MS);
    const pendingWhere = { bot_id: bid, distributed_at: null };
    const readyWhere = { bot_id: bid, distributed_at: null, created_at: { [Op.lte]: readyCutoff } };
    const [pendingCount, pendingTotal, readyCount, readyTotal] = await Promise.all([
      ReferralEarning.count({ where: pendingWhere }),
      ReferralEarning.sum('commission', { where: pendingWhere }),
      ReferralEarning.count({ where: readyWhere }),
      ReferralEarning.sum('commission', { where: readyWhere }),
    ]);
    const lastRow = await ReferralEarning.findOne({ where: { bot_id: bid, distributed_at: { [Op.ne]: null } }, order: [['distributed_at', 'DESC']], attributes: ['distributed_at'] });
    return { pendingCount: pendingCount || 0, pendingTotal: Number(pendingTotal || 0), readyCount: readyCount || 0, readyTotal: Number(readyTotal || 0), lastDistributionAt: lastRow?.distributed_at || null };
  }

  async function distributeReferralEarnings(readyOnly) {
    if (!ReferralEarning || !User) throw new Error('DB not initialized');
    const now = new Date();
    const readyCutoff = new Date(now.getTime() - TEN_DAYS_MS);
    const where = { bot_id: bid, distributed_at: null };
    if (readyOnly) where.created_at = { [Op.lte]: readyCutoff };
    const rows = await ReferralEarning.findAll({ where, order: [['id', 'ASC']] });
    if (rows.length === 0) return { distributedCount: 0, distributedTotal: 0, distributedUserCount: 0 };

    const t = await sequelize.transaction();
    try {
      let distributedTotal = 0;
      const byUser = {};
      for (const row of rows) {
        const plain = row.get ? row.get({ plain: true }) : row;
        byUser[plain.telegram_user_id] = (byUser[plain.telegram_user_id] || 0) + Number(plain.commission);
        distributedTotal += Number(plain.commission);
        await row.update({ distributed_at: now }, { transaction: t });
      }
      const round2 = (n) => Math.round(Number(n) * 100) / 100;
      let distributedUserCount = 0;
      for (const [telegramUserId, addBalance] of Object.entries(byUser)) {
        const u = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId }, lock: true, transaction: t });
        if (!u) continue;
        distributedUserCount += 1;
        await u.update({ balance: round2(Number(u.balance || 0) + addBalance), referral_balance: round2(Math.max(0, Number(u.referral_balance || 0) - addBalance)) }, { transaction: t });
      }
      await t.commit();
      return { distributedCount: rows.length, distributedTotal, distributedUserCount };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  async function getReferralEarningsForAdmin(page = 1, pageSize = 15) {
    if (!ReferralEarning) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await ReferralEarning.findAndCountAll({
      where: { bot_id: bid },
      order: [['created_at', 'DESC']],
      limit: pageSize, offset,
      attributes: ['id', 'telegram_user_id', 'from_user_id', 'level', 'commission', 'source_amount', 'created_at', 'distributed_at'],
    });
    return { rows: rows.map(r => r.get ? r.get({ plain: true }) : r), total: count, page, totalPages: Math.ceil(count / pageSize) || 1 };
  }

  async function getPendingReferralEarnings(page = 1, pageSize = 10) {
    if (!ReferralEarning) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await ReferralEarning.findAndCountAll({
      where: { bot_id: bid, distributed_at: null },
      order: [['created_at', 'DESC']],
      limit: pageSize, offset,
      attributes: ['id', 'telegram_user_id', 'from_user_id', 'level', 'commission', 'source_amount', 'created_at'],
    });
    return { rows: rows.map(r => r.get ? r.get({ plain: true }) : r), total: count, page, totalPages: Math.ceil(count / pageSize) || 1 };
  }

  async function getUsersDisplayMap(telegramUserIds) {
    if (!User) throw new Error('DB not initialized');
    const ids = [...new Set(telegramUserIds)].filter(id => id != null);
    if (ids.length === 0) return {};
    const users = await User.findAll({ where: { bot_id: bid, telegram_user_id: { [Op.in]: ids } }, attributes: ['telegram_user_id', 'ichancy_login', 'telegram_username', 'first_name'] });
    const map = {};
    for (const u of users) {
      const p = u.get ? u.get({ plain: true }) : u;
      const key = String(p.telegram_user_id);
      map[key] = (p.ichancy_login && String(p.ichancy_login).trim()) || (p.telegram_username && String(p.telegram_username).trim()) || (p.first_name && String(p.first_name).trim()) || key;
    }
    for (const id of ids) { const key = String(id); if (!(key in map)) map[key] = key; }
    return map;
  }

  // ── Transaction functions ──

  async function logTransaction(opts) {
    if (!Transaction) throw new Error('DB not initialized');
    const row = await Transaction.create({
      bot_id: bid,
      telegram_user_id: opts.telegramUserId,
      type: opts.type,
      amount: opts.amount,
      method: opts.method,
      transfer_id: opts.transferId || null,
      status: opts.status || 'pending',
    });
    return row.get ? row.get({ plain: true }) : row;
  }

  async function getTransactions(telegramUserId, type, page = 1, pageSize = 5) {
    if (!Transaction) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await Transaction.findAndCountAll({
      where: { bot_id: bid, telegram_user_id: telegramUserId, type },
      order: [['created_at', 'DESC']],
      limit: pageSize, offset,
    });
    return { rows: rows.map(r => r.get ? r.get({ plain: true }) : r), total: count, page, totalPages: Math.ceil(count / pageSize) };
  }

  /** Find an existing deposit transaction by method and transfer_id (e.g. Syriatel transaction no). Used to avoid double-credit. */
  async function getTransactionByTransferId(method, transferId) {
    if (!Transaction) throw new Error('DB not initialized');
    if (!transferId || !String(transferId).trim()) return null;
    const row = await Transaction.findOne({
      where: { bot_id: bid, type: 'deposit', method: String(method), transfer_id: String(transferId).trim() },
    });
    return row ? (row.get ? row.get({ plain: true }) : row) : null;
  }

  /** Update transaction status by id (for ShamCash pending withdrawal resolve). */
  async function updateTransactionStatus(transactionId, status) {
    if (!Transaction) throw new Error('DB not initialized');
    const [n] = await Transaction.update(
      { status },
      { where: { id: transactionId, bot_id: bid } }
    );
    return n > 0;
  }

  /** Create a pending ShamCash withdrawal record (after deducting balance and logging transaction). */
  async function createShamcashPendingWithdrawal(opts) {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const row = await ShamcashPendingWithdrawal.create({
      bot_id: bid,
      telegram_user_id: opts.telegramUserId,
      amount_syp: opts.amountSyp,
      currency: opts.currency,
      amount_display: String(opts.amountDisplay ?? ''),
      client_code: String(opts.clientCode ?? '').trim(),
      transaction_id: opts.transactionId || null,
      status: 'pending',
    });
    return row.get ? row.get({ plain: true }) : row;
  }

  async function getShamcashPendingById(id) {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const row = await ShamcashPendingWithdrawal.findOne({ where: { id, bot_id: bid } });
    return row ? (row.get ? row.get({ plain: true }) : row) : null;
  }

  async function getShamcashPendingByUser(telegramUserId) {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const rows = await ShamcashPendingWithdrawal.findAll({
      where: { bot_id: bid, telegram_user_id: telegramUserId, status: 'pending' },
      order: [['created_at', 'DESC']],
    });
    return rows.map(r => r.get ? r.get({ plain: true }) : r);
  }

  async function getAllShamcashPending() {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const rows = await ShamcashPendingWithdrawal.findAll({
      where: { bot_id: bid, status: 'pending' },
      order: [['created_at', 'ASC']],
    });
    return rows.map(r => r.get ? r.get({ plain: true }) : r);
  }

  async function updateShamcashPendingStatus(id, status, resolvedBy) {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const row = await ShamcashPendingWithdrawal.findOne({ where: { id, bot_id: bid } });
    if (!row) return false;
    await row.update({
      status,
      resolved_at: new Date(),
      resolved_by: resolvedBy || null,
    });
    return true;
  }

  /** Get full ShamCash withdrawal history (all statuses) for admin report, newest first. */
  async function getShamcashWithdrawalHistory(opts = {}) {
    if (!ShamcashPendingWithdrawal) throw new Error('DB not initialized');
    const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 50));
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
    const rows = await ShamcashPendingWithdrawal.findAll({
      where: { bot_id: bid },
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return rows.map(r => r.get ? r.get({ plain: true }) : r);
  }

  /** Claim a Syriatel transaction no (insert if not used). Returns true if newly claimed, false if already used. Use before crediting to prevent double-claim. */
  async function tryClaimSyriatelUsedTransactionNo(transactionNo) {
    if (!SyriatelUsedTransaction) throw new Error('DB not initialized');
    const no = String(transactionNo || '').trim();
    if (!no) return false;
    const [_, created] = await SyriatelUsedTransaction.findOrCreate({
      where: { bot_id: bid, transaction_no: no },
      defaults: { bot_id: bid, transaction_no: no, used_at: new Date() },
    });
    return !!created;
  }

  /** Delete Syriatel used-transaction rows older than the given days (e.g. 3). */
  async function cleanupSyriatelUsedTransactionsOlderThan(days) {
    if (!SyriatelUsedTransaction) return 0;
    const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
    const deleted = await SyriatelUsedTransaction.destroy({
      where: { bot_id: bid, used_at: { [Op.lt]: cutoff } },
    });
    return deleted || 0;
  }

  /** Claim a ShamCash transaction no (insert if not used). Returns true if newly claimed, false if already used. Use before crediting to prevent double-claim. */
  async function tryClaimShamcashUsedTransactionNo(transactionNo) {
    if (!ShamcashUsedTransaction) throw new Error('DB not initialized');
    const no = String(transactionNo || '').trim();
    if (!no) return false;
    const [_, created] = await ShamcashUsedTransaction.findOrCreate({
      where: { bot_id: bid, transaction_no: no },
      defaults: { bot_id: bid, transaction_no: no, used_at: new Date() },
    });
    return !!created;
  }

  /** Delete ShamCash used-transaction rows older than the given days (e.g. 3). */
  async function cleanupShamcashUsedTransactionsOlderThan(days) {
    if (!ShamcashUsedTransaction) return 0;
    const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
    const deleted = await ShamcashUsedTransaction.destroy({
      where: { bot_id: bid, used_at: { [Op.lt]: cutoff } },
    });
    return deleted || 0;
  }

  // ── Admin stats ──

  async function getUsersListForAdmin(opts = {}) {
    if (!User) throw new Error('DB not initialized');
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(opts.pageSize, 10) || 10));
    const searchQuery = typeof opts.searchQuery === 'string' ? opts.searchQuery.trim() : '';
    const where = { bot_id: bid };
    if (searchQuery) {
      const like = `%${searchQuery.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      where[Op.or] = [
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('telegram_username'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('ichancy_login'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('first_name'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('last_name'), ''), { [Op.like]: like }),
      ];
    }
    const offset = (page - 1) * pageSize;
    const { count, rows } = await User.findAndCountAll({ where, order: [['id', 'DESC']], limit: pageSize, offset, attributes: ['id', 'telegram_user_id', 'telegram_username', 'ichancy_login', 'first_name', 'last_name'] });
    const userIds = rows.map(r => r.telegram_user_id);
    let referralCounts = {};
    if (userIds.length > 0) {
      const [refRows] = await sequelize.query(
        'SELECT referred_by AS telegram_user_id, COUNT(*) AS cnt FROM users WHERE bot_id = ? AND referred_by IN (?) GROUP BY referred_by',
        { replacements: [bid, userIds] }
      );
      for (const r of refRows || []) referralCounts[String(r.telegram_user_id)] = Number(r.cnt) || 0;
    }
    const users = rows.map(r => {
      const p = r.get ? r.get({ plain: true }) : r;
      const displayName = (p.ichancy_login && String(p.ichancy_login).trim()) || (p.telegram_username && String(p.telegram_username).trim()) || (p.first_name && String(p.first_name).trim()) || `#${p.id}`;
      return { telegram_user_id: String(p.telegram_user_id), displayName, referralCount: referralCounts[String(p.telegram_user_id)] || 0 };
    });
    return { users, total: count, page, totalPages: Math.ceil(count / pageSize) || 1 };
  }

  async function getAllTelegramUserIds() {
    if (!User) throw new Error('DB not initialized');
    const rows = await User.findAll({ where: { bot_id: bid }, attributes: ['telegram_user_id'] });
    return rows.map(r => (r.get ? r.get({ plain: true }) : r).telegram_user_id);
  }

  async function getGiftRedemptionsCountForUser(telegramUserId) {
    if (!GiftCodeRedemption) throw new Error('DB not initialized');
    return GiftCodeRedemption.count({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
  }

  async function getAdminStats() {
    if (!User || !DeletedUser || !Transaction || !ReferralEarning || !GiftCode || !GiftCodeRedemption) throw new Error('DB not initialized');
    const now = new Date();
    const todayStart = new Date(now.getTime() - ONE_DAY_MS);
    const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
    const activeCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);
    const bw = { bot_id: bid };

    const [usersTotal, usersActive, usersDeleted, totalDeposits, totalWithdrawals, pendingWithdrawalsSum, totalUserBalances, referralProfits, todayDeposits, todayWithdrawals, weekDeposits, weekWithdrawals] = await Promise.all([
      User.count({ where: bw }),
      User.count({ where: { ...bw, updated_at: { [Op.gte]: activeCutoff } } }),
      DeletedUser.count({ where: bw }),
      Transaction.sum('amount', { where: { ...bw, type: 'deposit' } }),
      Transaction.sum('amount', { where: { ...bw, type: 'withdrawal', status: 'confirmed' } }),
      Transaction.sum('amount', { where: { ...bw, type: 'withdrawal', status: 'pending' } }),
      User.sum('balance', { where: bw }),
      ReferralEarning.sum('commission', { where: bw }),
      Transaction.sum('amount', { where: { ...bw, type: 'deposit', created_at: { [Op.gte]: todayStart } } }),
      Transaction.sum('amount', { where: { ...bw, type: 'withdrawal', created_at: { [Op.gte]: todayStart } } }),
      Transaction.sum('amount', { where: { ...bw, type: 'deposit', created_at: { [Op.gte]: weekStart } } }),
      Transaction.sum('amount', { where: { ...bw, type: 'withdrawal', created_at: { [Op.gte]: weekStart } } }),
    ]);

    let codeProfits = 0;
    try {
      const [rows] = await sequelize.query(
        'SELECT COALESCE(SUM(g.amount), 0) AS total FROM gift_code_redemptions r INNER JOIN gift_codes g ON r.gift_code_id = g.id WHERE r.bot_id = ?',
        { replacements: [bid] }
      );
      codeProfits = Number(rows[0]?.total ?? 0);
    } catch (_) {}

    const total = usersTotal || 0;
    const active = usersActive || 0;
    return {
      usersTotal: total, usersActive: active, usersInactive: Math.max(0, total - active), usersDeleted: usersDeleted || 0,
      totalDeposits: Number(totalDeposits || 0), totalWithdrawals: Number(totalWithdrawals || 0),
      pendingWithdrawalsSum: Number(pendingWithdrawalsSum || 0), totalUserBalances: Number(totalUserBalances || 0),
      referralProfits: Number(referralProfits || 0), wheelProfits: 0, boxProfits: 0, codeProfits,
      giftCouponRedeemProfits: codeProfits,
      todayDeposits: Number(todayDeposits || 0), todayWithdrawals: Number(todayWithdrawals || 0),
      weekDeposits: Number(weekDeposits || 0), weekWithdrawals: Number(weekWithdrawals || 0),
      totalBonuses: Number(referralProfits || 0) + codeProfits,
    };
  }

  async function getTopUsersByNetDeposits(opts = {}) {
    if (!Transaction || !User) throw new Error('DB not initialized');
    const startDate = opts.startDate ?? null;
    const endDate = opts.endDate ?? null;
    const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);

    const [rows] = await sequelize.query(
      `SELECT t.telegram_user_id, u.telegram_username, u.first_name, u.balance AS current_balance,
        COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'confirmed' THEN t.amount ELSE 0 END), 0) AS confirmed_deposits,
        COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.status = 'confirmed' THEN t.amount ELSE 0 END), 0) AS confirmed_withdrawals
      FROM transactions t INNER JOIN users u ON u.telegram_user_id = t.telegram_user_id AND u.bot_id = t.bot_id
      WHERE t.bot_id = ? AND (? IS NULL OR t.created_at >= ?) AND (? IS NULL OR t.created_at <= ?)
      GROUP BY t.telegram_user_id, u.telegram_username, u.first_name, u.balance`,
      { replacements: [bid, startDate, startDate, endDate, endDate] }
    );

    const list = (rows || []).map(r => {
      const deposits = Number(r.confirmed_deposits ?? 0);
      const withdrawals = Number(r.confirmed_withdrawals ?? 0);
      return { telegram_user_id: String(r.telegram_user_id), telegram_username: r.telegram_username ?? '', first_name: r.first_name ?? '', current_balance: Number(r.current_balance ?? 0), confirmed_deposits: deposits, confirmed_withdrawals: withdrawals, net: deposits - withdrawals };
    });
    list.sort((a, b) => b.net - a.net);
    return list.slice(0, limit);
  }

  // ── Config functions ──

  async function loadConfig() {
    if (!Bot) throw new Error('DB not initialized');
    const row = await Bot.findOne({ where: { bot_id: bid } });
    botConfigRow = row ? row.get({ plain: true }) : {};
    await loadProviderConfigs();
    return botConfigRow;
  }

  async function loadProviderConfigs() {
    if (!PaymentProvider) return;
    const rows = await PaymentProvider.findAll({ where: { bot_id: bid } });
    providerConfigCache = {};
    for (const r of rows) {
      const p = r.get ? r.get({ plain: true }) : r;
      providerConfigCache[p.provider_name] = p;
    }
  }

  /** Read provider config from DB only. If not found, return defaults. */
  async function getProviderConfig(providerName) {
    if (!PaymentProvider) throw new Error('DB not initialized');
    const defaults = { min_deposit_syp: 50, min_cashout_syp: 25000, max_cashout_syp: 250000, cashout_tax_percent: 0, deposit_bonus_percent: 0 };
    const row = await PaymentProvider.findOne({ where: { bot_id: bid, provider_name: providerName } });
    if (!row) return defaults;
    const p = row.get ? row.get({ plain: true }) : row;
    return {
      min_deposit_syp: p.min_deposit_syp ?? defaults.min_deposit_syp,
      min_cashout_syp: p.min_cashout_syp ?? defaults.min_cashout_syp,
      max_cashout_syp: p.max_cashout_syp ?? defaults.max_cashout_syp,
      cashout_tax_percent: p.cashout_tax_percent ?? defaults.cashout_tax_percent,
      deposit_bonus_percent: p.deposit_bonus_percent ?? defaults.deposit_bonus_percent,
    };
  }

  async function setProviderConfig(providerName, fields) {
    if (!PaymentProvider) throw new Error('DB not initialized');
    const [row] = await PaymentProvider.findOrCreate({
      where: { bot_id: bid, provider_name: providerName },
      defaults: { bot_id: bid, provider_name: providerName, ...fields },
    });
    const allowed = ['min_deposit_syp', 'min_cashout_syp', 'max_cashout_syp', 'cashout_tax_percent', 'deposit_bonus_percent'];
    const updates = {};
    for (const k of allowed) { if (fields[k] !== undefined) updates[k] = fields[k]; }
    if (Object.keys(updates).length) await row.update(updates);
    return getProviderConfig(providerName);
  }

  /** Read config from DB only. If bot row or key not found, return defaultValue. */
  async function getConfigValue(key, defaultValue) {
    if (!Bot) throw new Error('DB not initialized');
    const col = key.toLowerCase();
    const row = await Bot.findOne({ where: { bot_id: bid } });
    if (!row) return defaultValue !== undefined ? defaultValue : '';
    const p = row.get ? row.get({ plain: true }) : row;
    const val = p[col];
    if (val === undefined || val === null) return defaultValue !== undefined ? defaultValue : '';
    return val;
  }

  async function setConfigValue(key, value) {
    if (!Bot) throw new Error('DB not initialized');
    const col = key.toLowerCase();
    const row = await Bot.findOne({ where: { bot_id: bid } });
    if (!row) throw new Error('Bot row not found for bot_id: ' + bid);
    await row.update({ [col]: value });
    await row.reload();
    botConfigRow = row.get({ plain: true });
  }

  async function seedConfigDefaults(defaults) {
    if (!Bot) throw new Error('DB not initialized');
    const cols = {};
    for (const [key, value] of Object.entries(defaults)) cols[key.toLowerCase()] = value;
    const [row, created] = await Bot.findOrCreate({
      where: { bot_id: bid },
      defaults: { bot_id: bid, ...cols },
    });
    if (!created && row.admin_username == null) {
      await row.update({ admin_username: cols.admin_username || 'Mr_UnknownOfficial' });
      await row.reload();
    }
    botConfigRow = row.get({ plain: true });
    await seedPaymentProviders();
  }

  async function seedPaymentProviders() {
    if (!PaymentProvider) return;
    const count = await PaymentProvider.count({ where: { bot_id: bid } });
    if (count > 0) return;
    await PaymentProvider.bulkCreate([
      { bot_id: bid, provider_name: 'syriatel', min_deposit_syp: 50, min_cashout_syp: 25000, max_cashout_syp: 500000, cashout_tax_percent: 0, deposit_bonus_percent: 0 },
      { bot_id: bid, provider_name: 'shamcash', min_deposit_syp: 50, min_cashout_syp: 100000, max_cashout_syp: 2500000, cashout_tax_percent: 0, deposit_bonus_percent: 0 },
    ]);
    await loadProviderConfigs();
  }

  // ── Blocked users (array of { telegram_user_id, telegram_username } in bots table) ──

  async function getBlockedUsers() {
    if (!Bot) throw new Error('DB not initialized');
    const row = await Bot.findOne({ where: { bot_id: bid }, attributes: ['blocked_users'] });
    const arr = row?.blocked_users;
    return Array.isArray(arr) ? arr : [];
  }

  async function isUserBlocked(telegramUserId, telegramUsername) {
    const blocked = await getBlockedUsers();
    if (blocked.length === 0) return false;
    const idStr = String(telegramUserId || '');
    const usernameNorm = telegramUsername ? String(telegramUsername).replace(/^@/, '').trim().toLowerCase() : '';
    return blocked.some((b) => {
      const bid = b?.telegram_user_id != null ? String(b.telegram_user_id) : '';
      const buser = b?.telegram_username ? String(b.telegram_username).replace(/^@/, '').trim().toLowerCase() : '';
      return (idStr && bid && idStr === bid) || (usernameNorm && buser && usernameNorm === buser);
    });
  }

  async function addBlockedUser(telegramUserId, telegramUsername) {
    if (!Bot) throw new Error('DB not initialized');
    const blocked = await getBlockedUsers();
    const idStr = String(telegramUserId || '');
    const usernameNorm = telegramUsername ? String(telegramUsername).replace(/^@/, '').trim() : '';
    if (blocked.some((b) => String(b?.telegram_user_id || '') === idStr)) return false;
    blocked.push({ telegram_user_id: idStr, telegram_username: usernameNorm || null });
    const row = await Bot.findOne({ where: { bot_id: bid } });
    if (!row) throw new Error('Bot row not found');
    await row.update({ blocked_users: blocked });
    return true;
  }

  async function removeBlockedUser(telegramUserId) {
    if (!Bot) throw new Error('DB not initialized');
    const blocked = await getBlockedUsers();
    const idStr = String(telegramUserId || '');
    const filtered = blocked.filter((b) => String(b?.telegram_user_id || '') !== idStr);
    if (filtered.length === blocked.length) return false;
    const row = await Bot.findOne({ where: { bot_id: bid } });
    if (!row) throw new Error('Bot row not found');
    await row.update({ blocked_users: filtered });
    return true;
  }

  return {
    getUserByTelegramId, createOrUpdateUser, moveUserToDeletedUsers,
    redeemGiftCode, deleteExpiredGiftCodes, createGiftCode, listGiftCodes,
    getGiftCodeById, updateGiftCode, setGiftCodeActive, getRedemptionCount, deleteGiftCode,
    saveReferral, distributeReferralCommissions, getReferralStats,
    getPendingReferralStats, distributeReferralEarnings, getReferralEarningsForAdmin,
    getPendingReferralEarnings, getUsersDisplayMap,
    logTransaction, getTransactions, getTransactionByTransferId, updateTransactionStatus, tryClaimSyriatelUsedTransactionNo, cleanupSyriatelUsedTransactionsOlderThan, tryClaimShamcashUsedTransactionNo, cleanupShamcashUsedTransactionsOlderThan, getUsersListForAdmin, getAllTelegramUserIds, getGiftRedemptionsCountForUser,
    createShamcashPendingWithdrawal, getShamcashPendingById, getShamcashPendingByUser, getAllShamcashPending, updateShamcashPendingStatus, getShamcashWithdrawalHistory,
    getAdminStats, getTopUsersByNetDeposits,
    loadConfig, getConfigValue, setConfigValue, seedConfigDefaults,
    loadProviderConfigs, getProviderConfig, setProviderConfig, seedPaymentProviders,
    getBlockedUsers, isUserBlocked, addBlockedUser, removeBlockedUser,
    useSpinCredit, ensureDailySpinEligibility,
  };
}

// ── Admin functions (not scoped to a bot) ────────────────────────────

async function getAllBots() {
  if (!Bot) throw new Error('DB not initialized');
  const rows = await Bot.findAll({ order: [['id', 'ASC']] });
  return rows.map(r => r.get ? r.get({ plain: true }) : r);
}

async function getActiveBots() {
  if (!Bot) throw new Error('DB not initialized');
  const rows = await Bot.findAll({ where: { is_active: true }, order: [['id', 'ASC']] });
  return rows.map(r => r.get ? r.get({ plain: true }) : r);
}

async function getBotRowById(botId) {
  if (!Bot) throw new Error('DB not initialized');
  const row = await Bot.findOne({ where: { bot_id: botId } });
  return row ? (row.get ? row.get({ plain: true }) : row) : null;
}

async function createBotRow(data) {
  if (!Bot) throw new Error('DB not initialized');
  const row = await Bot.create(data);
  return row.get ? row.get({ plain: true }) : row;
}

async function updateBotRow(botId, fields) {
  if (!Bot) throw new Error('DB not initialized');
  const row = await Bot.findOne({ where: { bot_id: botId } });
  if (!row) throw new Error('Bot not found: ' + botId);
  await row.update(fields);
  return row.get ? row.get({ plain: true }) : row;
}

async function deleteBotRow(botId) {
  if (!Bot) throw new Error('DB not initialized');
  const row = await Bot.findOne({ where: { bot_id: botId } });
  if (!row) return false;
  await row.destroy();
  return true;
}

module.exports = {
  initDb,
  createBotDb,
  getAllBots,
  getActiveBots,
  getBotRowById,
  createBotRow,
  updateBotRow,
  deleteBotRow,
  get sequelize() { return sequelize; },
  get User() { return User; },
  get DeletedUser() { return DeletedUser; },
  get GiftCode() { return GiftCode; },
  get GiftCodeRedemption() { return GiftCodeRedemption; },
  get Bot() { return Bot; },
  get PaymentProvider() { return PaymentProvider; },
};
