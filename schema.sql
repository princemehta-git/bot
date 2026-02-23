-- Ichancy Telegram Bot – database structure (REFERENCE ONLY)
-- The app uses Sequelize: it auto-creates the DB and syncs tables on startup (lib/db.js).
-- You do NOT need to run this file manually. Keep it as documentation/reference.
-- To create DB/tables by hand (e.g. mysql -u root -p < schema.sql):

CREATE DATABASE IF NOT EXISTS ichancy_bot
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE ichancy_bot;

-- Users: Telegram users and their bot account / balance / gifts
CREATE TABLE IF NOT EXISTS users (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  telegram_user_id  BIGINT NOT NULL COMMENT 'Telegram from.id',
  telegram_username VARCHAR(255) NULL COMMENT 'Telegram @username',
  first_name        VARCHAR(255) NULL,
  last_name         VARCHAR(255) NULL,
  ichancy_login     VARCHAR(255) NULL COMMENT 'Ichancy account name e.g. Bot-User123',
  balance           DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Balance in currency',
  gifts             DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Gifts balance',
  ichancy_user_id   VARCHAR(64) NULL COMMENT 'Ichancy platform user number',
  wheel_spins_available_today INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Wheel spins available today',
  last_spin_grant_date        DATE NULL COMMENT 'Syria date when daily spin was last granted',
  last_box_game_at  DATETIME NULL COMMENT 'Last time user played box game (one per 24h)',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_user_id (telegram_user_id),
  KEY idx_ichancy_login (ichancy_login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Syriatel used transaction numbers (last 3 days only; app cleans older rows).
CREATE TABLE IF NOT EXISTS syriatel_used_transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL,
  transaction_no    VARCHAR(128) NOT NULL,
  used_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_transaction_no (bot_id, transaction_no),
  KEY idx_bot_used_at (bot_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ShamCash used transaction numbers (last 3 days only; app cleans older rows). Prevents same transfer number being redeemed twice.
CREATE TABLE IF NOT EXISTS shamcash_used_transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL,
  transaction_no    VARCHAR(128) NOT NULL,
  used_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_transaction_no (bot_id, transaction_no),
  KEY idx_bot_used_at (bot_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bots: one row per bot; config stored in columns. Sequelize sync creates/alters this table. config stored in columns. Sequelize sync creates/alters this table.
-- Key columns for admin "إدارة النسب" (manage rates):
--   exchange_rate_syp_per_usd  FLOAT NOT NULL DEFAULT 15000  (Lebanese pounds per 1 USD)
-- Other columns: bot_token, bot_username, channel_username, syriatel_deposit_numbers,
--   sham_cash_deposit_code, referral_level1_percent, referral_level2_percent, referral_level3_percent,
--   deposit_syriatel_enabled, deposit_shamcash_enabled, withdraw_syriatel_enabled, withdraw_shamcash_enabled,
--   spin_prizes (JSON), luck_box_prizes (JSON), etc.
CREATE TABLE IF NOT EXISTS bots (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id                    VARCHAR(128) NOT NULL,
  is_active                 TINYINT(1) NOT NULL DEFAULT 1,
  bot_off                   TINYINT(1) NOT NULL DEFAULT 0,
  bot_token                 VARCHAR(255) NULL,
  bot_username              VARCHAR(128) NULL,
  bot_display_name          VARCHAR(255) NULL DEFAULT 'Bot',
  username_prefix           VARCHAR(64) NULL DEFAULT 'Bot-',
  channel_username          VARCHAR(255) NULL,
  debug_mode                TINYINT(1) NOT NULL DEFAULT 0,
  debug_logs                 TINYINT(1) NOT NULL DEFAULT 0,
  cookie_refresh_interval_minutes INT NOT NULL DEFAULT 5,
  ichancy_agent_username     VARCHAR(255) NULL,
  ichancy_agent_password    VARCHAR(255) NULL,
  ichancy_parent_id         VARCHAR(64) NULL,
  golden_tree_url           TEXT NULL,
  ichancy_site_url          VARCHAR(512) NULL,
  exchange_rate_syp_per_usd FLOAT NOT NULL DEFAULT 15000 COMMENT 'Lebanese pounds per 1 USD',
  syriatel_deposit_numbers  TEXT NULL,
  sham_cash_deposit_code    VARCHAR(255) NULL,
  alert_channel_accounts    VARCHAR(255) NULL,
  alert_channel_transactions VARCHAR(255) NULL,
  support_username          VARCHAR(128) NULL,
  admin_username            VARCHAR(128) NULL,
  timezone                  VARCHAR(64) NULL DEFAULT 'Asia/Damascus',
  referral_level1_percent   FLOAT NOT NULL DEFAULT 5,
  referral_level2_percent   FLOAT NOT NULL DEFAULT 3,
  referral_level3_percent   FLOAT NOT NULL DEFAULT 2,
  deposit_required_ls       INT NOT NULL DEFAULT 50000,
  active_referrals_required INT NOT NULL DEFAULT 5,
  deposit_syriatel_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  deposit_shamcash_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  withdraw_syriatel_enabled TINYINT(1) NOT NULL DEFAULT 1,
  withdraw_shamcash_enabled TINYINT(1) NOT NULL DEFAULT 1,
  syriatel_api_key          VARCHAR(255) NULL,
  syriatel_pin              VARCHAR(64) NULL,
  blocked_users             JSON NULL,
  spin_prizes               JSON NULL,
  luck_box_prizes           JSON NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_id (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment providers (Syriatel Cash, Sham Cash): limits and rates used for deposit/withdrawal.
-- Admin "إدارة النسب" saves here via setProviderConfig; deposit/withdrawal read from here only.
CREATE TABLE IF NOT EXISTS payment_providers (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id              VARCHAR(128) NOT NULL,
  provider_name       ENUM('syriatel','shamcash') NOT NULL,
  min_deposit_syp     INT NOT NULL DEFAULT 50 COMMENT 'Minimum deposit in Lebanese pounds',
  min_cashout_syp     INT NOT NULL DEFAULT 25000 COMMENT 'Minimum withdrawal in Lebanese pounds',
  max_cashout_syp     INT NOT NULL DEFAULT 250000 COMMENT 'Maximum withdrawal in Lebanese pounds',
  cashout_tax_percent FLOAT NOT NULL DEFAULT 0 COMMENT 'Withdrawal tax rate 0-100',
  deposit_bonus_percent FLOAT NOT NULL DEFAULT 0 COMMENT 'Deposit bonus rate 0-100',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_provider (bot_id, provider_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pending ShamCash withdrawal requests (user requested; admin accepts/rejects or user cancels).
CREATE TABLE IF NOT EXISTS shamcash_pending_withdrawals (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL,
  telegram_user_id  BIGINT NOT NULL,
  amount_syp        DECIMAL(18,2) NOT NULL COMMENT 'Amount deducted from bot wallet (in SYP)',
  currency          ENUM('usd','syp') NOT NULL COMMENT 'Display currency',
  amount_display    VARCHAR(64) NOT NULL COMMENT 'Display amount e.g. 100 or 50000',
  client_code       VARCHAR(128) NOT NULL COMMENT 'ShamCash client code',
  transaction_id    INT UNSIGNED NULL COMMENT 'FK to transactions.id (withdrawal log)',
  status            ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  resolved_at       DATETIME NULL,
  resolved_by       VARCHAR(64) NULL COMMENT 'admin_accept, admin_reject, user_cancel',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bot_status (bot_id, status),
  KEY idx_bot_user (bot_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
