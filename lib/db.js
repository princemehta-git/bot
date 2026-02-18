/**
 * Sequelize-based DB layer: auto-creates database, syncs schema on startup (creates
 * tables, adds missing columns). Single source of truth = model definitions below.
 * No manual SQL or migrations needed.
 */

const { Sequelize, DataTypes } = require('sequelize');
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ichancy_bot';

let sequelize;
let User;
let DeletedUser;

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

  await sequelize.sync({ alter: true });
  return sequelize;
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
  getUserByTelegramId,
  createOrUpdateUser,
  moveUserToDeletedUsers,
};
