/**
 * Sequelize-based DB layer: auto-creates database, syncs schema on startup (creates
 * tables, adds missing columns). Single source of truth = model definitions below.
 * No manual SQL or migrations needed.
 */

const { Sequelize, DataTypes, Op } = require('sequelize');
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ichancy_bot';
const botId = process.env.BOT_USERNAME || '';

let sequelize;
let User;
let DeletedUser;
let GiftCode;
let GiftCodeRedemption;
let ReferralEarning;
let Transaction;
let Bot;

let botConfigRow = {};

/**
 * Create database if it does not exist, then connect Sequelize and sync schema.
 * Call once at startup before using getUserByTelegramId / createOrUpdateUser / moveUserToDeletedUsers.
 * - Creates DB if missing
 * - Creates tables if missing
 * - Adds missing columns (alter) when you add new fields to the model
 */
async function initDb() {
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    charset: 'utf8mb4',
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();

  sequelize = new Sequelize(database, user, password, {
    host,
    port,
    dialect: 'mysql',
    dialectModule: require('mysql2'),
    logging: false,
    define: {
      underscored: true,
      timestamps: true,
      updatedAt: 'updated_at',
      createdAt: 'created_at',
    },
    pool: { max: 10, min: 0, acquire: 10000 },
  });

  User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      telegram_user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        unique: true,
      },
      telegram_username: { type: DataTypes.STRING(255) },
      first_name: { type: DataTypes.STRING(255) },
      last_name: { type: DataTypes.STRING(255) },
      ichancy_login: { type: DataTypes.STRING(255) },
      password: { type: DataTypes.STRING(255) },
      balance: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      gifts: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      ichancy_user_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Ichancy platform user number',
      },
      wheel_spins_available_today: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        comment: 'Wheel spins available today',
      },
      referred_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: 'telegram_user_id of the user who referred this user',
      },
      referral_balance: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Referral earnings wallet (LS)',
      },
    },
    { tableName: 'users' }
  );

  DeletedUser = sequelize.define(
    'DeletedUser',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      telegram_user_id: { type: DataTypes.BIGINT, allowNull: false },
      telegram_username: { type: DataTypes.STRING(255) },
      first_name: { type: DataTypes.STRING(255) },
      last_name: { type: DataTypes.STRING(255) },
      ichancy_login: { type: DataTypes.STRING(255) },
      password: { type: DataTypes.STRING(255) },
      balance: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      gifts: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        defaultValue: 0,
      },
      ichancy_user_id: { type: DataTypes.STRING(64) },
      wheel_spins_available_today: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    { tableName: 'deleted_users', timestamps: false }
  );

  GiftCode = sequelize.define(
    'GiftCode',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        comment: 'Gift code (stored uppercase for lookup)',
      },
      amount: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        comment: 'Amount in LS to add to user balance',
      },
      expiry_date: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Code expires at this datetime; null = never expires',
      },
      max_redemptions: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
        comment: 'Max total redemptions; null = unlimited',
      },
    },
    { tableName: 'gift_codes' }
  );

  GiftCodeRedemption = sequelize.define(
    'GiftCodeRedemption',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      gift_code_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'gift_codes', key: 'id', onDelete: 'CASCADE' },
      },
      telegram_user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
    },
    {
      tableName: 'gift_code_redemptions',
      timestamps: true,
      updatedAt: false,
      createdAt: 'redeemed_at',
      indexes: [{ unique: true, fields: ['gift_code_id', 'telegram_user_id'] }],
    }
  );

  GiftCode.hasMany(GiftCodeRedemption, { foreignKey: 'gift_code_id' });
  GiftCodeRedemption.belongsTo(GiftCode, { foreignKey: 'gift_code_id' });

  ReferralEarning = sequelize.define(
    'ReferralEarning',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      telegram_user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        comment: 'User who earned the commission',
      },
      from_user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        comment: 'User whose payment triggered the commission',
      },
      level: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: false,
        comment: '1, 2, or 3',
      },
      source_amount: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        comment: 'Original payment amount (LS)',
      },
      commission: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        comment: 'Commission earned (LS)',
      },
    },
    {
      tableName: 'referral_earnings',
      timestamps: true,
      updatedAt: false,
      createdAt: 'created_at',
      indexes: [{ fields: ['telegram_user_id'] }],
    }
  );

  Transaction = sequelize.define(
    'Transaction',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      telegram_user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('deposit', 'withdrawal'),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(18, 2),
        allowNull: false,
        comment: 'Amount in LS',
      },
      method: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'Payment method: syriatel, sham_usd, sham_syp, etc.',
      },
      transfer_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: 'Transfer/operation number provided by user',
      },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
    },
    {
      tableName: 'transactions',
      timestamps: true,
      updatedAt: false,
      createdAt: 'created_at',
      indexes: [
        { fields: ['telegram_user_id', 'type'] },
      ],
    }
  );

  Bot = sequelize.define(
    'Bot',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      bot_id: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      bot_token: { type: DataTypes.STRING(255), allowNull: true },
      bot_username: { type: DataTypes.STRING(128), allowNull: true },
      bot_display_name: { type: DataTypes.STRING(255), allowNull: true, defaultValue: 'Bot' },
      channel_username: { type: DataTypes.STRING(255), allowNull: true },
      debug_mode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      debug_logs: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      cookie_refresh_interval_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
      ichancy_agent_username: { type: DataTypes.STRING(255), allowNull: true },
      ichancy_agent_password: { type: DataTypes.STRING(255), allowNull: true },
      ichancy_parent_id: { type: DataTypes.STRING(64), allowNull: true },
      golden_tree_url: { type: DataTypes.TEXT, allowNull: true },
      ichancy_site_url: { type: DataTypes.STRING(512), allowNull: true },
      sham_usd_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
      sham_usd_max: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 216 },
      sham_syp_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100000 },
      sham_syp_max: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2500000 },
      sham_syp_per_usd: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 15000 },
      syriatel_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
      syriatel_max: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 500000 },
      charge_syriatel_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
      charge_syriatel_max: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 500000 },
      syriatel_deposit_numbers: { type: DataTypes.TEXT, allowNull: true },
      charge_sham_usd_min: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      charge_sham_usd_max: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 216 },
      charge_sham_syp_min: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      charge_sham_syp_max: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3240000 },
      sham_cash_deposit_code: { type: DataTypes.STRING(255), allowNull: true },
      alert_channel_accounts: { type: DataTypes.STRING(255), allowNull: true },
      alert_channel_transactions: { type: DataTypes.STRING(255), allowNull: true },
      support_username: { type: DataTypes.STRING(128), allowNull: true },
      admin_username: { type: DataTypes.STRING(128), allowNull: true },
      referral_level1_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 5 },
      referral_level2_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 3 },
      referral_level3_percent: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 2 },
      deposit_required_ls: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50000 },
      active_referrals_required: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    },
    { tableName: 'bots' }
  );

  await sequelize.sync({ alter: true });

  // Migrate from old bot_config key-value table (if it exists)
  await migrateFromBotConfigTable();

  return sequelize;
}

async function migrateFromBotConfigTable() {
  try {
    const [tables] = await sequelize.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bot_config'",
      { replacements: [database] }
    );
    if (!tables || tables.length === 0) return;

    const [rows] = await sequelize.query(
      'SELECT config_key, config_value FROM bot_config WHERE bot_id = ? OR bot_id = ?',
      { replacements: [botId, ''] }
    );
    if (!rows || rows.length === 0) return;

    const existing = await Bot.findOne({ where: { bot_id: botId } });
    if (existing) {
      await sequelize.query('DROP TABLE IF EXISTS bot_config');
      return;
    }

    const data = { bot_id: botId };
    const boolFields = ['debug_mode', 'debug_logs', 'is_active'];
    const intFields = [
      'sham_usd_min', 'sham_usd_max', 'sham_syp_min', 'sham_syp_max',
      'syriatel_min', 'syriatel_max', 'charge_syriatel_min', 'charge_syriatel_max',
      'charge_sham_syp_min', 'charge_sham_syp_max', 'deposit_required_ls',
      'active_referrals_required', 'cookie_refresh_interval_minutes',
    ];
    const floatFields = [
      'sham_syp_per_usd', 'charge_sham_usd_min', 'charge_sham_usd_max',
      'referral_level1_percent', 'referral_level2_percent', 'referral_level3_percent',
    ];

    for (const { config_key, config_value } of rows) {
      const col = config_key.toLowerCase();
      if (boolFields.includes(col)) {
        data[col] = config_value === 'true' || config_value === '1';
      } else if (intFields.includes(col)) {
        data[col] = parseInt(config_value, 10) || 0;
      } else if (floatFields.includes(col)) {
        data[col] = parseFloat(config_value) || 0;
      } else {
        data[col] = config_value;
      }
    }

    await Bot.create(data);
    await sequelize.query('DROP TABLE IF EXISTS bot_config');
    console.log('Migrated bot config from bot_config table to bots table.');
  } catch (err) {
    console.warn('migrateFromBotConfigTable:', err.message);
  }
}

function toPlainSnake(user) {
  if (!user) return null;
  const p = user.get ? user.get({ plain: true }) : user;
  return {
    id: p.id,
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
    referred_by: p.referred_by || null,
    referral_balance: p.referral_balance ?? 0,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/**
 * Get user by Telegram user id. Returns null if not found.
 */
async function getUserByTelegramId(telegramUserId) {
  if (!User) throw new Error('DB not initialized: call initDb() first');
  const row = await User.findOne({ where: { telegram_user_id: telegramUserId } });
  return toPlainSnake(row);
}

/**
 * Insert or update user. Merges with existing; only provided fields override.
 */
async function createOrUpdateUser(telegramUserId, fields = {}) {
  if (!User) throw new Error('DB not initialized: call initDb() first');
  const existing = await User.findOne({ where: { telegram_user_id: telegramUserId } });
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
    referred_by: fields.referred_by !== undefined ? fields.referred_by : (plain.referred_by || null),
    referral_balance: fields.referral_balance !== undefined ? Number(fields.referral_balance) : Number(plain.referral_balance || 0),
  };

  if (existing) {
    await existing.update(payload);
    return toPlainSnake(await existing.reload());
  }
  const created = await User.create({
    telegram_user_id: telegramUserId,
    ...payload,
  });
  return toPlainSnake(created);
}

/**
 * Redeem a gift code for a user. Returns { amount } on success, { error } on failure.
 * - Validates: code exists, not expired, under max_redemptions, user hasn't used it before.
 */
async function redeemGiftCode(code, telegramUserId) {
  if (!GiftCode || !GiftCodeRedemption || !User) throw new Error('DB not initialized: call initDb() first');
  const codeUpper = (code || '').trim().toUpperCase();
  if (!codeUpper) return { error: 'empty' };

  const t = await sequelize.transaction();
  try {
    const giftCode = await GiftCode.findOne({
      where: { code: codeUpper },
      lock: true,
      transaction: t,
    });
    if (!giftCode) {
      await t.rollback();
      return { error: 'invalid' };
    }
    const now = new Date();
    if (giftCode.expiry_date && new Date(giftCode.expiry_date) < now) {
      await giftCode.destroy({ transaction: t });
      await t.commit();
      return { error: 'expired' };
    }
    if (giftCode.max_redemptions != null) {
      const count = await GiftCodeRedemption.count({
        where: { gift_code_id: giftCode.id },
        transaction: t,
      });
      if (count >= giftCode.max_redemptions) {
        await t.rollback();
        return { error: 'exhausted' };
      }
    }
    const alreadyRedeemed = await GiftCodeRedemption.findOne({
      where: { gift_code_id: giftCode.id, telegram_user_id: telegramUserId },
      transaction: t,
    });
    if (alreadyRedeemed) {
      await t.rollback();
      return { error: 'already_used' };
    }
    await GiftCodeRedemption.create(
      { gift_code_id: giftCode.id, telegram_user_id: telegramUserId },
      { transaction: t }
    );
    const amount = Number(giftCode.amount);
    const existing = await User.findOne({ where: { telegram_user_id: telegramUserId }, transaction: t });
    const currentBalance = Number(existing?.balance ?? 0);
    const newBalance = currentBalance + amount;
    if (existing) {
      await existing.update({ balance: newBalance }, { transaction: t });
    } else {
      await User.create(
        { telegram_user_id: telegramUserId, balance: newBalance, gifts: 0 },
        { transaction: t }
      );
    }
    await t.commit();
    return { amount };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

/**
 * Delete all expired gift codes from the database. Call on startup or periodically.
 */
async function deleteExpiredGiftCodes() {
  if (!GiftCode) throw new Error('DB not initialized: call initDb() first');
  const now = new Date();
  const deleted = await GiftCode.destroy({
    where: { expiry_date: { [Op.lt]: now } },
  });
  return deleted;
}

/**
 * Create a gift code. For admin use.
 * @param {Object} opts - { code, amount, expiryDate?, maxRedemptions? }
 * @returns {{ row, created: boolean }}
 */
async function createGiftCode(opts) {
  if (!GiftCode) throw new Error('DB not initialized: call initDb() first');
  const code = (opts.code || '').trim().toUpperCase();
  if (!code) throw new Error('code is required');
  const amount = parseInt(opts.amount, 10);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive number');
  const expiryDate = opts.expiryDate ? new Date(opts.expiryDate) : null;
  const maxRedemptions = opts.maxRedemptions != null ? parseInt(opts.maxRedemptions, 10) : null;
  const [row, created] = await GiftCode.findOrCreate({
    where: { code },
    defaults: {
      code,
      amount,
      expiry_date: expiryDate,
      max_redemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : null,
    },
  });
  if (!created) {
    await row.update({
      amount,
      expiry_date: expiryDate,
      max_redemptions: Number.isFinite(maxRedemptions) ? maxRedemptions : null,
    });
  }
  return { row: row.get ? row.get({ plain: true }) : row, created };
}

/**
 * Save referral: set referred_by on a user (only if not already set).
 * @returns {boolean} true if saved, false if already had a referrer or self-referral
 */
async function saveReferral(telegramUserId, referrerTelegramUserId) {
  if (!User) throw new Error('DB not initialized: call initDb() first');
  if (String(telegramUserId) === String(referrerTelegramUserId)) return false;
  const row = await User.findOne({ where: { telegram_user_id: telegramUserId } });
  if (!row || row.referred_by) return false;
  const referrerExists = await User.findOne({ where: { telegram_user_id: referrerTelegramUserId } });
  if (!referrerExists) return false;
  await row.update({ referred_by: referrerTelegramUserId });
  return true;
}

/**
 * Distribute referral commissions for a payment. Walks up the referral tree 3 levels.
 * @param {number|string} payerTelegramUserId - user who made the payment
 * @param {number} paymentAmount - payment amount in LS
 * @param {number[]} levelPercents - [level1%, level2%, level3%]
 * @returns {Array} list of { telegramUserId, level, commission } that were credited
 */
async function distributeReferralCommissions(payerTelegramUserId, paymentAmount, levelPercents) {
  if (!User || !ReferralEarning) throw new Error('DB not initialized: call initDb() first');
  const amt = Number(paymentAmount);
  if (!Number.isFinite(amt) || amt <= 0) return [];

  const results = [];
  let currentUserId = payerTelegramUserId;

  for (let level = 1; level <= 3; level++) {
    const currentUser = await User.findOne({ where: { telegram_user_id: currentUserId } });
    if (!currentUser || !currentUser.referred_by) break;

    const referrerId = currentUser.referred_by;
    const percent = levelPercents[level - 1] || 0;
    if (percent <= 0) { currentUserId = referrerId; continue; }

    const commission = Math.floor((amt * percent / 100) * 100) / 100;
    if (commission <= 0) { currentUserId = referrerId; continue; }

    const referrer = await User.findOne({ where: { telegram_user_id: referrerId } });
    if (!referrer) break;

    await ReferralEarning.create({
      telegram_user_id: referrerId,
      from_user_id: payerTelegramUserId,
      level,
      source_amount: amt,
      commission,
    });

    const newRefBal = Number(referrer.referral_balance || 0) + commission;
    await referrer.update({ referral_balance: newRefBal });

    results.push({ telegramUserId: referrerId, level, commission });
    currentUserId = referrerId;
  }

  return results;
}

/**
 * Get referral stats for a user.
 * @returns { totalEarnings, referralBalance, referralCount }
 */
async function getReferralStats(telegramUserId) {
  if (!User || !ReferralEarning) throw new Error('DB not initialized: call initDb() first');

  const totalResult = await ReferralEarning.sum('commission', {
    where: { telegram_user_id: telegramUserId },
  });
  const totalEarnings = Number(totalResult || 0);

  const userRow = await User.findOne({ where: { telegram_user_id: telegramUserId } });
  const referralBalance = Number(userRow?.referral_balance || 0);

  const referralCount = await User.count({
    where: { referred_by: telegramUserId },
  });

  return { totalEarnings, referralBalance, referralCount };
}

/**
 * Log a transaction (deposit or withdrawal).
 * @param {Object} opts - { telegramUserId, type: 'deposit'|'withdrawal', amount, method, transferId?, status? }
 * @returns {Object} the created row
 */
async function logTransaction(opts) {
  if (!Transaction) throw new Error('DB not initialized: call initDb() first');
  const row = await Transaction.create({
    telegram_user_id: opts.telegramUserId,
    type: opts.type,
    amount: opts.amount,
    method: opts.method,
    transfer_id: opts.transferId || null,
    status: opts.status || 'pending',
  });
  return row.get ? row.get({ plain: true }) : row;
}

/**
 * Get paginated transactions for a user.
 * @param {number|string} telegramUserId
 * @param {'deposit'|'withdrawal'} type
 * @param {number} page - 1-based
 * @param {number} pageSize - items per page
 * @returns {{ rows: Object[], total: number, page, totalPages }}
 */
async function getTransactions(telegramUserId, type, page = 1, pageSize = 5) {
  if (!Transaction) throw new Error('DB not initialized: call initDb() first');
  const offset = (page - 1) * pageSize;
  const { count, rows } = await Transaction.findAndCountAll({
    where: { telegram_user_id: telegramUserId, type },
    order: [['created_at', 'DESC']],
    limit: pageSize,
    offset,
  });
  return {
    rows: rows.map((r) => r.get ? r.get({ plain: true }) : r),
    total: count,
    page,
    totalPages: Math.ceil(count / pageSize),
  };
}

/**
 * Move the user record to deleted_users (with deleted_at) and remove from users.
 */
async function moveUserToDeletedUsers(telegramUserId) {
  if (!User || !DeletedUser) throw new Error('DB not initialized: call initDb() first');
  const row = await User.findOne({ where: { telegram_user_id: telegramUserId } });
  if (!row) return null;
  const plain = row.get({ plain: true });
  await DeletedUser.create({
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
    deleted_at: new Date(),
  });
  await row.destroy();
  return plain;
}

/**
 * Load this bot's row from the bots table into memory.
 * Call once after initDb + seedConfigDefaults.
 */
async function loadConfig() {
  if (!Bot) throw new Error('DB not initialized: call initDb() first');
  const row = await Bot.findOne({ where: { bot_id: botId } });
  botConfigRow = row ? row.get({ plain: true }) : {};
  return botConfigRow;
}

/**
 * Read a config value from the cached bot row.
 * Key is UPPER_CASE (e.g. 'BOT_TOKEN') — automatically mapped to the column name (lower_case).
 * @param {string} key
 * @param {*} [defaultValue='']
 */
function getConfigValue(key, defaultValue) {
  const col = key.toLowerCase();
  const val = botConfigRow[col];
  if (val !== undefined && val !== null) return val;
  return defaultValue !== undefined ? defaultValue : '';
}

/**
 * Update a config value on this bot's row in the DB and refresh cache.
 * @param {string} key - UPPER_CASE key (e.g. 'SHAM_USD_MIN')
 * @param {*} value
 */
async function setConfigValue(key, value) {
  if (!Bot) throw new Error('DB not initialized: call initDb() first');
  const col = key.toLowerCase();
  const row = await Bot.findOne({ where: { bot_id: botId } });
  if (!row) throw new Error('Bot row not found for bot_id: ' + botId);
  await row.update({ [col]: value });
  botConfigRow = row.get({ plain: true });
}

/**
 * Create the bot row if it doesn't exist, using the provided defaults.
 * Keys are UPPER_CASE — automatically mapped to column names (lower_case).
 * If the row already exists, this is a no-op (existing values are preserved).
 * @param {Object} defaults - { BOT_TOKEN: '', SHAM_USD_MIN: 10, ... }
 */
async function seedConfigDefaults(defaults) {
  if (!Bot) throw new Error('DB not initialized: call initDb() first');
  const cols = {};
  for (const [key, value] of Object.entries(defaults)) {
    cols[key.toLowerCase()] = value;
  }
  const [row, created] = await Bot.findOrCreate({
    where: { bot_id: botId },
    defaults: { bot_id: botId, ...cols },
  });
  if (!created && row.admin_username == null) {
    await row.update({ admin_username: cols.admin_username || 'Mr_UnknownOfficial' });
    await row.reload();
  }
  botConfigRow = row.get({ plain: true });
}

module.exports = {
  initDb,
  get sequelize() {
    return sequelize;
  },
  get User() {
    return User;
  },
  get DeletedUser() {
    return DeletedUser;
  },
  get GiftCode() {
    return GiftCode;
  },
  get GiftCodeRedemption() {
    return GiftCodeRedemption;
  },
  getUserByTelegramId,
  createOrUpdateUser,
  moveUserToDeletedUsers,
  redeemGiftCode,
  createGiftCode,
  deleteExpiredGiftCodes,
  saveReferral,
  distributeReferralCommissions,
  getReferralStats,
  logTransaction,
  getTransactions,
  loadConfig,
  getConfigValue,
  setConfigValue,
  seedConfigDefaults,
};
