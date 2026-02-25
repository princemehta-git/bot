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
let ReferralNetDetail;
let ReferralDistribution;
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
    referral_net_l1: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    referral_net_l2: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    referral_net_l3: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    custom_referral_percent: { type: DataTypes.FLOAT, allowNull: true, defaultValue: null },
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
    published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
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

  ReferralNetDetail = sequelize.define('ReferralNetDetail', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    referrer_id: { type: DataTypes.BIGINT, allowNull: false },
    referred_user_id: { type: DataTypes.BIGINT, allowNull: false },
    level: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    net_balance: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'referral_net_details',
    timestamps: true,
    updatedAt: 'updated_at',
    createdAt: 'created_at',
    indexes: [
      { unique: true, fields: ['bot_id', 'referrer_id', 'referred_user_id', 'level'] },
      { fields: ['bot_id', 'referrer_id'] },
    ],
  });

  ReferralDistribution = sequelize.define('ReferralDistribution', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    bot_id: { type: DataTypes.STRING(128), allowNull: false, defaultValue: '' },
    referrer_id: { type: DataTypes.BIGINT, allowNull: false },
    commission_amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    net_l1_snapshot: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    net_l2_snapshot: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    net_l3_snapshot: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    details_json: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'referral_distributions',
    timestamps: true,
    updatedAt: false,
    createdAt: 'distributed_at',
    indexes: [{ fields: ['bot_id', 'referrer_id'] }],
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
    const tables = ['users', 'deleted_users', 'gift_codes', 'gift_code_redemptions', 'referral_net_details', 'referral_distributions', 'transactions'];
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
    referral_net_l1: p.referral_net_l1 ?? 0,
    referral_net_l2: p.referral_net_l2 ?? 0,
    referral_net_l3: p.referral_net_l3 ?? 0,
    custom_referral_percent: p.custom_referral_percent ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

// ── Per-bot DB context factory ───────────────────────────────────────

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/**
 * Get the UTC Date for midnight (00:00:00) on a given date in a timezone.
 * Used for stats boundaries so "month" and "today" follow the bot's timezone.
 * @param {number} year - Year in the given timezone
 * @param {number} month - Month 1-12
 * @param {number} day - Day of month
 * @param {string} timeZone - IANA timezone (e.g. 'Asia/Damascus')
 * @returns {Date} UTC moment that is midnight on that date in timeZone
 */
function getMidnightInTimezone(year, month, day, timeZone) {
  const targetStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = Date.UTC(year, month - 1, day - 1, -12, 0, 0);
  const end = Date.UTC(year, month - 1, day + 1, 12, 0, 0);
  for (let t = start; t <= end; t += 3600000) {
    const d = new Date(t);
    const s = d.toLocaleString('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    if (s.startsWith(targetStr + ' 00:00')) return d;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

/**
 * Get monthStart and todayStart in the bot's timezone for admin stats.
 * @param {Date} now - Current time (any timezone)
 * @param {string} timeZone - IANA timezone from bots.timezone (e.g. 'Asia/Damascus')
 * @returns {{ monthStart: Date, todayStart: Date, exportDateStr: string }}
 */
function getStatsDateBoundsInTimezone(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    monthStart: getMidnightInTimezone(year, month, 1, timeZone),
    todayStart: getMidnightInTimezone(year, month, day, timeZone),
    exportDateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * Get first and last moment of the previous month in the bot's timezone (for "last month" stats).
 * @param {Date} now - Current time
 * @param {string} timeZone - IANA timezone (e.g. 'Asia/Damascus')
 * @returns {{ monthStart: Date, monthEnd: Date, monthLabel: string }}
 */
function getPreviousMonthBoundsInTimezone(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  const year = get('year');
  const month = get('month');
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear = year - 1;
  }
  const monthStart = getMidnightInTimezone(prevYear, prevMonth, 1, timeZone);
  const monthEnd = new Date(getMidnightInTimezone(year, month, 1, timeZone).getTime() - 1);
  const monthLabel = new Intl.DateTimeFormat('ar-SY', { timeZone, month: 'long', year: 'numeric' }).format(monthStart);
  return { monthStart, monthEnd, monthLabel };
}

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
      referral_net_l1: fields.referral_net_l1 !== undefined ? Number(fields.referral_net_l1) : Number(plain.referral_net_l1 || 0),
      referral_net_l2: fields.referral_net_l2 !== undefined ? Number(fields.referral_net_l2) : Number(plain.referral_net_l2 || 0),
      referral_net_l3: fields.referral_net_l3 !== undefined ? Number(fields.referral_net_l3) : Number(plain.referral_net_l3 || 0),
      custom_referral_percent: fields.custom_referral_percent !== undefined ? fields.custom_referral_percent : (plain.custom_referral_percent ?? null),
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

  /**
   * Atomically adjust a user's balance (and optionally gifts) by a delta.
   * Returns the updated user row (plain object) or null if the user was not found
   * or the resulting balance would go negative.
   */
  async function adjustBalance(telegramUserId, { balanceDelta = 0, giftsDelta = 0 } = {}) {
    if (!User) throw new Error('DB not initialized');
    const bDelta = Number(balanceDelta);
    const gDelta = Number(giftsDelta);
    if (!Number.isFinite(bDelta) && !Number.isFinite(gDelta)) return null;

    const sets = [];
    const replacements = [];
    const checks = [];
    if (bDelta !== 0) {
      sets.push('balance = balance + ?');
      replacements.push(bDelta);
      if (bDelta < 0) checks.push('balance + ? >= 0');
    }
    if (gDelta !== 0) {
      sets.push('gifts = gifts + ?');
      replacements.push(gDelta);
      if (gDelta < 0) checks.push('gifts + ? >= 0');
    }
    if (sets.length === 0) return null;

    const whereChecks = checks.length
      ? ' AND ' + checks.join(' AND ')
      : '';
    const checkReplacements = [];
    if (bDelta < 0) checkReplacements.push(bDelta);
    if (gDelta < 0) checkReplacements.push(gDelta);

    const sql = `UPDATE users SET ${sets.join(', ')} WHERE bot_id = ? AND telegram_user_id = ?${whereChecks}`;
    const allReplacements = [...replacements, bid, telegramUserId, ...checkReplacements];

    const [result, metadata] = await sequelize.query(sql, { replacements: allReplacements });
    const affected = (result && result.affectedRows) ?? (metadata && metadata.affectedRows) ?? 0;
    if (affected === 0) return null;

    return getUserByTelegramId(telegramUserId);
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
    const codes = await GiftCode.findAll({ where, order: [['id', 'DESC']], attributes: ['id', 'code', 'amount', 'expiry_date', 'max_redemptions', 'is_active', 'published'] });
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

  async function markGiftCodesPublished(ids) {
    if (!GiftCode || !ids || !ids.length) return;
    await GiftCode.update({ published: true }, { where: { id: { [Op.in]: ids }, bot_id: bid } });
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

  /**
   * Update referral net balances when a user transfers money to/from ichancy site.
   * @param {number|string} userId - telegram_user_id of the user who transferred
   * @param {number} amount - amount transferred (always positive)
   * @param {'deposit_to_site'|'withdraw_from_site'} direction
   */
  async function updateReferralNetBalances(userId, amount, direction) {
    if (!User || !ReferralNetDetail) throw new Error('DB not initialized');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const delta = direction === 'deposit_to_site' ? amt : -amt;
    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    let currentUserId = userId;
    for (let level = 1; level <= 3; level++) {
      const currentUser = await User.findOne({ where: { bot_id: bid, telegram_user_id: currentUserId } });
      if (!currentUser || !currentUser.referred_by) break;
      const referrerId = currentUser.referred_by;
      const referrer = await User.findOne({ where: { bot_id: bid, telegram_user_id: referrerId } });
      if (!referrer) break;
      const netCol = `referral_net_l${level}`;
      await referrer.update({ [netCol]: round2(Number(referrer[netCol] || 0) + delta) });
      const [detail] = await ReferralNetDetail.findOrCreate({
        where: { bot_id: bid, referrer_id: referrerId, referred_user_id: userId, level },
        defaults: { bot_id: bid, referrer_id: referrerId, referred_user_id: userId, level, net_balance: 0 },
      });
      await detail.update({ net_balance: round2(Number(detail.net_balance || 0) + delta) });
      currentUserId = referrerId;
    }
  }

  /**
   * Get referral commission and stats for a user.
   * Commission per level = max(0, percent * aggregate_net_balance).
   */
  async function getReferralCommission(telegramUserId, levelPercents) {
    if (!User) throw new Error('DB not initialized');
    const userRow = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    if (!userRow) return { totalCommission: 0, levels: [], referralCount: 0 };
    const referralCount = await User.count({ where: { bot_id: bid, referred_by: telegramUserId } });
    const levels = [];
    let totalCommission = 0;
    for (let level = 1; level <= 3; level++) {
      const net = Number(userRow[`referral_net_l${level}`] || 0);
      const percent = levelPercents[level - 1] || 0;
      const commission = net > 0 ? Math.floor((net * percent / 100) * 100) / 100 : 0;
      totalCommission += commission;
      levels.push({ level, netBalance: net, percent, commission });
    }
    return { totalCommission, levels, referralCount };
  }

  /** Get per-referred-user net balance detail rows for a referrer (admin view). */
  async function getReferralNetDetails(telegramUserId) {
    if (!ReferralNetDetail) throw new Error('DB not initialized');
    const rows = await ReferralNetDetail.findAll({
      where: { bot_id: bid, referrer_id: telegramUserId },
      order: [['level', 'ASC'], ['id', 'ASC']],
    });
    return rows.map(r => r.get ? r.get({ plain: true }) : r);
  }

  /** Get aggregate pending commission across all users (for admin stats overview). */
  async function getGlobalReferralPendingStats(levelPercents) {
    if (!User) throw new Error('DB not initialized');
    const users = await User.findAll({
      where: { bot_id: bid, [Op.or]: [{ referral_net_l1: { [Op.ne]: 0 } }, { referral_net_l2: { [Op.ne]: 0 } }, { referral_net_l3: { [Op.ne]: 0 } }] },
      attributes: ['telegram_user_id', 'referral_net_l1', 'referral_net_l2', 'referral_net_l3'],
    });
    let totalPending = 0;
    let usersWithCommission = 0;
    for (const u of users) {
      const p = u.get ? u.get({ plain: true }) : u;
      let userCommission = 0;
      for (let level = 1; level <= 3; level++) {
        const net = Number(p[`referral_net_l${level}`] || 0);
        const pct = levelPercents[level - 1] || 0;
        if (net > 0) userCommission += Math.floor((net * pct / 100) * 100) / 100;
      }
      if (userCommission > 0) {
        totalPending += userCommission;
        usersWithCommission += 1;
      }
    }
    const lastRow = ReferralDistribution ? await ReferralDistribution.findOne({ where: { bot_id: bid }, order: [['distributed_at', 'DESC']], attributes: ['distributed_at'] }) : null;
    return { totalPending: Math.round(totalPending * 100) / 100, usersWithCommission, lastDistributionAt: lastRow?.distributed_at || null };
  }

  /**
   * Distribute referral commissions for all eligible users.
   * For each level: if aggregate net > 0, pay commission and reset to 0.
   * Negative net balances carry forward.
   */
  async function distributeAllReferralCommissions(levelPercents) {
    if (!User || !ReferralNetDetail || !ReferralDistribution) throw new Error('DB not initialized');
    const users = await User.findAll({
      where: { bot_id: bid, [Op.or]: [{ referral_net_l1: { [Op.gt]: 0 } }, { referral_net_l2: { [Op.gt]: 0 } }, { referral_net_l3: { [Op.gt]: 0 } }] },
    });
    if (users.length === 0) return { distributedCount: 0, distributedTotal: 0, distributedUserCount: 0 };

    const t = await sequelize.transaction();
    try {
      const round2 = (n) => Math.round(Number(n) * 100) / 100;
      let distributedTotal = 0;
      let distributedUserCount = 0;
      let distributedCount = 0;

      for (const u of users) {
        const p = u.get ? u.get({ plain: true }) : u;
        let commission = 0;
        const snapshot = {};
        const updates = {};

        const customPct = p.custom_referral_percent;
        for (let level = 1; level <= 3; level++) {
          const netCol = `referral_net_l${level}`;
          const net = Number(p[netCol] || 0);
          snapshot[`l${level}`] = net;
          let pct = levelPercents[level - 1] || 0;
          if (level === 1 && customPct != null) pct = customPct;
          if (net > 0 && pct > 0) {
            commission += Math.floor((net * pct / 100) * 100) / 100;
            updates[netCol] = 0;
          }
        }
        if (commission <= 0) continue;

        commission = round2(commission);

        const detailRows = await ReferralNetDetail.findAll({
          where: { bot_id: bid, referrer_id: p.telegram_user_id },
          attributes: ['referred_user_id', 'level', 'net_balance'],
          transaction: t,
        });
        const detailsJson = detailRows.map(d => {
          const dp = d.get ? d.get({ plain: true }) : d;
          return { referred_user_id: dp.referred_user_id, level: dp.level, net_balance: Number(dp.net_balance) };
        });

        await u.update({ ...updates, balance: round2(Number(u.balance || 0) + commission) }, { transaction: t });

        for (let level = 1; level <= 3; level++) {
          if (updates[`referral_net_l${level}`] === 0) {
            await ReferralNetDetail.update(
              { net_balance: 0 },
              { where: { bot_id: bid, referrer_id: p.telegram_user_id, level, net_balance: { [Op.gt]: 0 } }, transaction: t }
            );
          }
        }

        await ReferralDistribution.create({
          bot_id: bid,
          referrer_id: p.telegram_user_id,
          commission_amount: commission,
          net_l1_snapshot: snapshot.l1 || 0,
          net_l2_snapshot: snapshot.l2 || 0,
          net_l3_snapshot: snapshot.l3 || 0,
          details_json: detailsJson,
        }, { transaction: t });

        distributedTotal += commission;
        distributedUserCount += 1;
        distributedCount += 1;
      }

      await t.commit();
      return { distributedCount, distributedTotal: round2(distributedTotal), distributedUserCount };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  /** Get distribution history for admin (paginated). */
  async function getReferralDistributionHistory(page = 1, pageSize = 15) {
    if (!ReferralDistribution) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await ReferralDistribution.findAndCountAll({
      where: { bot_id: bid },
      order: [['distributed_at', 'DESC']],
      limit: pageSize, offset,
    });
    return { rows: rows.map(r => r.get ? r.get({ plain: true }) : r), total: count, page, totalPages: Math.ceil(count / pageSize) || 1 };
  }

  /** Get distribution history for a specific user. */
  async function getUserDistributionHistory(telegramUserId, page = 1, pageSize = 10) {
    if (!ReferralDistribution) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await ReferralDistribution.findAndCountAll({
      where: { bot_id: bid, referrer_id: telegramUserId },
      order: [['distributed_at', 'DESC']],
      limit: pageSize, offset,
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
    const where = {
      bot_id: bid,
      ichancy_user_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    };
    if (searchQuery) {
      const like = `%${searchQuery.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      const orConditions = [
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('telegram_username'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('ichancy_login'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('first_name'), ''), { [Op.like]: like }),
        sequelize.where(sequelize.fn('COALESCE', sequelize.col('last_name'), ''), { [Op.like]: like }),
      ];
      if (/^\d+$/.test(searchQuery)) {
        orConditions.push({ telegram_user_id: searchQuery });
      }
      where[Op.or] = orConditions;
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

  async function getUserTransactionHistory(telegramUserId, page = 1, pageSize = 10) {
    if (!Transaction) throw new Error('DB not initialized');
    const offset = (page - 1) * pageSize;
    const { count, rows } = await Transaction.findAndCountAll({
      where: { bot_id: bid, telegram_user_id: telegramUserId },
      order: [['created_at', 'DESC']],
      limit: pageSize, offset,
    });
    return { rows: rows.map(r => r.get ? r.get({ plain: true }) : r), total: count, page, totalPages: Math.ceil(count / pageSize) || 1 };
  }

  async function getTotalDepositsForUser(telegramUserId) {
    if (!Transaction) throw new Error('DB not initialized');
    const sum = await Transaction.sum('amount', {
      where: { bot_id: bid, telegram_user_id: telegramUserId, type: 'deposit', status: 'confirmed' },
    });
    return Number(sum) || 0;
  }

  async function getWithdrawalCountForUser(telegramUserId) {
    if (!Transaction) throw new Error('DB not initialized');
    return Transaction.count({
      where: { bot_id: bid, telegram_user_id: telegramUserId, type: 'withdrawal', status: 'confirmed' },
    });
  }

  async function distributeSingleUserReferralCommission(telegramUserId, levelPercents) {
    if (!User || !ReferralNetDetail || !ReferralDistribution) throw new Error('DB not initialized');
    const u = await User.findOne({ where: { bot_id: bid, telegram_user_id: telegramUserId } });
    if (!u) return null;
    const p = u.get ? u.get({ plain: true }) : u;
    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    let commission = 0;
    const snapshot = {};
    const updates = {};
    const customPct = p.custom_referral_percent;
    for (let level = 1; level <= 3; level++) {
      const netCol = `referral_net_l${level}`;
      const net = Number(p[netCol] || 0);
      snapshot[`l${level}`] = net;
      let pct = levelPercents[level - 1] || 0;
      if (level === 1 && customPct != null) pct = customPct;
      if (net > 0 && pct > 0) {
        commission += Math.floor((net * pct / 100) * 100) / 100;
        updates[netCol] = 0;
      }
    }
    if (commission <= 0) return { commission: 0 };
    commission = round2(commission);
    const t = await sequelize.transaction();
    try {
      const detailRows = await ReferralNetDetail.findAll({
        where: { bot_id: bid, referrer_id: telegramUserId },
        attributes: ['referred_user_id', 'level', 'net_balance'],
        transaction: t,
      });
      const detailsJson = detailRows.map(d => {
        const dp = d.get ? d.get({ plain: true }) : d;
        return { referred_user_id: dp.referred_user_id, level: dp.level, net_balance: Number(dp.net_balance) };
      });
      await u.update({ ...updates, balance: round2(Number(u.balance || 0) + commission) }, { transaction: t });
      for (let level = 1; level <= 3; level++) {
        if (updates[`referral_net_l${level}`] === 0) {
          await ReferralNetDetail.update(
            { net_balance: 0 },
            { where: { bot_id: bid, referrer_id: telegramUserId, level, net_balance: { [Op.gt]: 0 } }, transaction: t }
          );
        }
      }
      await ReferralDistribution.create({
        bot_id: bid,
        referrer_id: telegramUserId,
        commission_amount: commission,
        net_l1_snapshot: snapshot.l1 || 0,
        net_l2_snapshot: snapshot.l2 || 0,
        net_l3_snapshot: snapshot.l3 || 0,
        details_json: detailsJson,
      }, { transaction: t });
      await t.commit();
      return { commission, detailsJson };
    } catch (err) {
      await t.rollback();
      throw err;
    }
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

  async function getAdminStats(opts = {}) {
    if (!User || !DeletedUser || !Transaction || !GiftCode || !GiftCodeRedemption || !PaymentProvider) throw new Error('DB not initialized');
    const now = new Date();
    const currencyMultiple = Math.max(1, Number(opts.currencyMultiple) || 100);
    const monthOffset = (Number(opts.monthOffset) === -1) ? -1 : 0;
    const bw = { bot_id: bid };

    const timeZone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
    const isPreviousMonth = monthOffset === -1;
    let monthStart, monthEnd, todayStart, weekStart;
    let monthLabel = null;

    if (isPreviousMonth) {
      const prev = getPreviousMonthBoundsInTimezone(now, timeZone);
      monthStart = prev.monthStart;
      monthEnd = prev.monthEnd;
      monthLabel = prev.monthLabel;
      todayStart = null;
      weekStart = null;
    } else {
      const bounds = getStatsDateBoundsInTimezone(now, timeZone);
      monthStart = bounds.monthStart;
      monthEnd = null;
      todayStart = bounds.todayStart;
      weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
    }

    const activeCutoff = new Date(now.getTime() - THIRTY_DAYS_MS);

    const [usersTotal, usersActive, usersDeleted, totalUserBalances] = await Promise.all([
      User.count({ where: bw }),
      User.count({ where: { ...bw, updated_at: { [Op.gte]: activeCutoff } } }),
      DeletedUser.count({ where: bw }),
      User.sum('balance', { where: bw }),
    ]);

    const monthWhere = monthEnd
      ? [bid, monthStart, monthEnd]
      : [bid, monthStart];

    const [monthlyDepositSum] = await sequelize.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions ${monthEnd ? 'WHERE bot_id = ? AND type = \'deposit\' AND status = \'confirmed\' AND created_at >= ? AND created_at <= ?' : 'WHERE bot_id = ? AND type = \'deposit\' AND status = \'confirmed\' AND created_at >= ?'}`,
      { replacements: monthWhere }
    );
    const totalDeposits = Number(monthlyDepositSum?.[0]?.total ?? 0);

    const [monthlyWithdrawRows] = await sequelize.query(
      `SELECT method, amount FROM transactions ${monthEnd ? 'WHERE bot_id = ? AND type = \'withdrawal\' AND status = \'confirmed\' AND created_at >= ? AND created_at <= ?' : 'WHERE bot_id = ? AND type = \'withdrawal\' AND status = \'confirmed\' AND created_at >= ?'}`,
      { replacements: monthWhere }
    );
    let totalWithdrawals = 0;
    for (const r of monthlyWithdrawRows || []) {
      const amt = Number(r.amount ?? 0);
      totalWithdrawals += (r.method === 'syriatel') ? amt / currencyMultiple : amt;
    }

    const [pendingRows] = await sequelize.query(
      `SELECT method, amount FROM transactions WHERE bot_id = ? AND type = 'withdrawal' AND status = 'pending'`,
      { replacements: [bid] }
    );
    let pendingWithdrawalsSum = 0;
    for (const r of pendingRows || []) {
      const amt = Number(r.amount ?? 0);
      pendingWithdrawalsSum += (r.method === 'syriatel') ? amt / currencyMultiple : amt;
    }

    let todayDeposits = 0;
    let todayWithdrawals = 0;
    let weekDeposits = 0;
    let weekWithdrawals = 0;
    if (!isPreviousMonth && todayStart && weekStart) {
      const [todayDepositSum] = await sequelize.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE bot_id = ? AND type = 'deposit' AND status = 'confirmed' AND created_at >= ?`,
        { replacements: [bid, todayStart] }
      );
      todayDeposits = Number(todayDepositSum?.[0]?.total ?? 0);
      const [todayWithdrawRows] = await sequelize.query(
        `SELECT method, amount FROM transactions WHERE bot_id = ? AND type = 'withdrawal' AND status = 'confirmed' AND created_at >= ?`,
        { replacements: [bid, todayStart] }
      );
      for (const r of todayWithdrawRows || []) {
        const amt = Number(r.amount ?? 0);
        todayWithdrawals += (r.method === 'syriatel') ? amt / currencyMultiple : amt;
      }
      const [weekDepositSum] = await sequelize.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE bot_id = ? AND type = 'deposit' AND status = 'confirmed' AND created_at >= ?`,
        { replacements: [bid, weekStart] }
      );
      weekDeposits = Number(weekDepositSum?.[0]?.total ?? 0);
      const [weekWithdrawRows] = await sequelize.query(
        `SELECT method, amount FROM transactions WHERE bot_id = ? AND type = 'withdrawal' AND status = 'confirmed' AND created_at >= ?`,
        { replacements: [bid, weekStart] }
      );
      for (const r of weekWithdrawRows || []) {
        const amt = Number(r.amount ?? 0);
        weekWithdrawals += (r.method === 'syriatel') ? amt / currencyMultiple : amt;
      }
    }

    const [depositByMethod] = await sequelize.query(
      `SELECT method, COALESCE(SUM(amount), 0) AS total FROM transactions ${monthEnd ? 'WHERE bot_id = ? AND type = \'deposit\' AND status = \'confirmed\' AND created_at >= ? AND created_at <= ?' : 'WHERE bot_id = ? AND type = \'deposit\' AND status = \'confirmed\' AND created_at >= ?'} GROUP BY method`,
      { replacements: monthWhere }
    );
    const syrConfig = await getProviderConfig('syriatel');
    const shamConfig = await getProviderConfig('shamcash');
    const syrPct = Number(syrConfig?.deposit_bonus_percent ?? 0) || 0;
    const shamPct = Number(shamConfig?.deposit_bonus_percent ?? 0) || 0;
    let totalBonuses = 0;
    for (const row of depositByMethod || []) {
      const total = Number(row.total ?? 0);
      const p = (row.method === 'syriatel') ? syrPct : shamPct;
      if (p > 0) totalBonuses += total * (p / (100 + p));
    }

    const referralDistWhere = monthEnd
      ? { bot_id: bid, distributed_at: { [Op.gte]: monthStart, [Op.lte]: monthEnd } }
      : { bot_id: bid, distributed_at: { [Op.gte]: monthStart } };
    const referralSum = ReferralDistribution ? await ReferralDistribution.sum('commission_amount', { where: referralDistWhere }) : 0;
    const referralProfits = Number(referralSum ?? 0);

    let codeProfits = 0;
    try {
      const codeReplacements = monthEnd ? [bid, monthStart, monthEnd] : [bid, monthStart];
      const codeQuery = monthEnd
        ? `SELECT COALESCE(SUM(g.amount), 0) AS total FROM gift_code_redemptions r INNER JOIN gift_codes g ON r.gift_code_id = g.id WHERE r.bot_id = ? AND r.redeemed_at >= ? AND r.redeemed_at <= ?`
        : `SELECT COALESCE(SUM(g.amount), 0) AS total FROM gift_code_redemptions r INNER JOIN gift_codes g ON r.gift_code_id = g.id WHERE r.bot_id = ? AND r.redeemed_at >= ?`;
      const [codeRows] = await sequelize.query(codeQuery, { replacements: codeReplacements });
      codeProfits = Number(codeRows?.[0]?.total ?? 0);
    } catch (_) {}

    const total = usersTotal || 0;
    const active = usersActive || 0;
    return {
      usersTotal: total,
      usersActive: active,
      usersInactive: Math.max(0, total - active),
      usersDeleted: usersDeleted || 0,
      totalDeposits,
      totalWithdrawals,
      pendingWithdrawalsSum,
      totalUserBalances: Number(totalUserBalances || 0),
      referralProfits,
      wheelProfits: 0,
      boxProfits: 0,
      codeProfits,
      giftCouponRedeemProfits: codeProfits,
      todayDeposits,
      todayWithdrawals,
      weekDeposits,
      weekWithdrawals,
      totalBonuses,
      isPreviousMonth: !!isPreviousMonth,
      monthLabel: monthLabel || undefined,
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

  /** Read provider config from in-memory cache. Falls back to DB if cache is empty. */
  async function getProviderConfig(providerName) {
    if (!PaymentProvider) throw new Error('DB not initialized');
    const defaults = { min_deposit_syp: 50, min_cashout_syp: 25000, max_cashout_syp: 250000, cashout_tax_percent: 0, deposit_bonus_percent: 0 };
    const cached = providerConfigCache[providerName];
    if (cached) {
      return {
        min_deposit_syp: cached.min_deposit_syp ?? defaults.min_deposit_syp,
        min_cashout_syp: cached.min_cashout_syp ?? defaults.min_cashout_syp,
        max_cashout_syp: cached.max_cashout_syp ?? defaults.max_cashout_syp,
        cashout_tax_percent: cached.cashout_tax_percent ?? defaults.cashout_tax_percent,
        deposit_bonus_percent: cached.deposit_bonus_percent ?? defaults.deposit_bonus_percent,
      };
    }
    const row = await PaymentProvider.findOne({ where: { bot_id: bid, provider_name: providerName } });
    if (!row) return defaults;
    const p = row.get ? row.get({ plain: true }) : row;
    providerConfigCache[providerName] = p;
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
    await row.reload();
    providerConfigCache[providerName] = row.get ? row.get({ plain: true }) : row;
    return getProviderConfig(providerName);
  }

  /** Read config from in-memory cache. Falls back to DB if cache is empty. */
  async function getConfigValue(key, defaultValue) {
    if (!Bot) throw new Error('DB not initialized');
    const col = key.toLowerCase();
    if (botConfigRow && Object.keys(botConfigRow).length > 0) {
      const val = botConfigRow[col];
      if (val === undefined || val === null) return defaultValue !== undefined ? defaultValue : '';
      return val;
    }
    const row = await Bot.findOne({ where: { bot_id: bid } });
    if (!row) return defaultValue !== undefined ? defaultValue : '';
    const p = row.get ? row.get({ plain: true }) : row;
    botConfigRow = p;
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
    if (botConfigRow && Object.keys(botConfigRow).length > 0) {
      const arr = botConfigRow.blocked_users;
      return Array.isArray(arr) ? arr : [];
    }
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
      const blockedId = b?.telegram_user_id != null ? String(b.telegram_user_id) : '';
      const buser = b?.telegram_username ? String(b.telegram_username).replace(/^@/, '').trim().toLowerCase() : '';
      return (idStr && blockedId && idStr === blockedId) || (usernameNorm && buser && usernameNorm === buser);
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
    if (botConfigRow) botConfigRow.blocked_users = blocked;
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
    if (botConfigRow) botConfigRow.blocked_users = filtered;
    return true;
  }

  /** Get date bounds and export date string for Excel (uses bot timezone from DB). */
  async function getExportDateBounds() {
    const now = new Date();
    const timeZone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
    const { todayStart, exportDateStr } = getStatsDateBoundsInTimezone(now, timeZone);
    const weekStart = new Date(now.getTime() - SEVEN_DAYS_MS);
    return { todayStart, weekStart, exportDateStr, now };
  }

  /** Get transactions for Excel export with user display name. startDate/endDate are Date objects (UTC moment). */
  async function getTransactionsForExport(startDate, endDate) {
    if (!Transaction || !User) throw new Error('DB not initialized');
    const where = ['t.bot_id = ?'];
    const replacements = [bid];
    if (startDate) {
      where.push('t.created_at >= ?');
      replacements.push(startDate);
    }
    if (endDate) {
      where.push('t.created_at <= ?');
      replacements.push(endDate);
    }
    const [rows] = await sequelize.query(
      `SELECT t.telegram_user_id AS telegram_user_id,
        COALESCE(NULLIF(TRIM(u.ichancy_login), ''), NULLIF(TRIM(u.telegram_username), ''), NULLIF(TRIM(u.first_name), ''), CAST(t.telegram_user_id AS CHAR)) AS username,
        t.type AS type,
        t.amount AS amount,
        t.method AS method,
        t.status AS status,
        t.created_at AS created_at
       FROM transactions t
       LEFT JOIN users u ON u.bot_id = t.bot_id AND u.telegram_user_id = t.telegram_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC`,
      { replacements }
    );
    const typeMap = { deposit: 'إيداع', withdrawal: 'سحب' };
    const methodMap = { syriatel: 'SYRIATEL_CASH', sham_syp: 'sham_cash', sham_usd: 'sham_cash' };
    const statusMap = { pending: 'قيد الانتظار', confirmed: 'success', rejected: 'مرفوض' };
    return (rows || []).map((r) => ({
      telegram_user_id: String(r.telegram_user_id ?? ''),
      username: String(r.username ?? r.telegram_user_id ?? ''),
      type_ar: typeMap[r.type] || r.type,
      amount: Number(r.amount ?? 0),
      method_display: methodMap[r.method] || r.method || '—',
      status_display: statusMap[r.status] || r.status || '—',
      created_at: r.created_at,
    }));
  }

  return {
    getUserByTelegramId, createOrUpdateUser, moveUserToDeletedUsers,
    redeemGiftCode, deleteExpiredGiftCodes, createGiftCode, listGiftCodes,
    getGiftCodeById, updateGiftCode, setGiftCodeActive, getRedemptionCount, deleteGiftCode, markGiftCodesPublished,
    saveReferral, updateReferralNetBalances, getReferralCommission,
    getReferralNetDetails, getGlobalReferralPendingStats,
    distributeAllReferralCommissions, getReferralDistributionHistory,
    getUserDistributionHistory, getUsersDisplayMap,
    logTransaction, getTransactions, getTransactionByTransferId, updateTransactionStatus, tryClaimSyriatelUsedTransactionNo, cleanupSyriatelUsedTransactionsOlderThan, tryClaimShamcashUsedTransactionNo, cleanupShamcashUsedTransactionsOlderThan, getUsersListForAdmin, getAllTelegramUserIds, getGiftRedemptionsCountForUser, getUserTransactionHistory, getTotalDepositsForUser, getWithdrawalCountForUser, distributeSingleUserReferralCommission,
    createShamcashPendingWithdrawal, getShamcashPendingById, getShamcashPendingByUser, getAllShamcashPending, updateShamcashPendingStatus, getShamcashWithdrawalHistory,
    getAdminStats, getTopUsersByNetDeposits,
    getExportDateBounds, getTransactionsForExport,
    loadConfig, getConfigValue, setConfigValue, seedConfigDefaults,
    loadProviderConfigs, getProviderConfig, setProviderConfig, seedPaymentProviders,
    getBlockedUsers, isUserBlocked, addBlockedUser, removeBlockedUser,
    useSpinCredit, adjustBalance, ensureDailySpinEligibility,
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
