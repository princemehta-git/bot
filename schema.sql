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
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id                    VARCHAR(128) NOT NULL DEFAULT '',
  telegram_user_id          BIGINT NOT NULL COMMENT 'Telegram from.id',
  telegram_username         VARCHAR(255) NULL COMMENT 'Telegram @username',
  first_name                VARCHAR(255) NULL,
  last_name                 VARCHAR(255) NULL,
  ichancy_login             VARCHAR(255) NULL COMMENT 'Ichancy account name e.g. Bot-User123',
  password                  VARCHAR(255) NULL COMMENT 'Ichancy account password',
  balance                   DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Balance in currency',
  gifts                     DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Gifts balance',
  ichancy_user_id           VARCHAR(64) NULL COMMENT 'Ichancy platform user number',
  wheel_spins_available_today INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Wheel spins available today',
  last_spin_grant_date      DATE NULL COMMENT 'Syria date when daily spin was last granted',
  last_box_game_at          DATETIME NULL COMMENT 'Last time user played box game (one per 24h)',
  referred_by               BIGINT NULL COMMENT 'Telegram ID of user who referred this user',
  referral_net_l1           DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Running L1 referral net balance',
  referral_net_l2           DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Running L2 referral net balance',
  referral_net_l3           DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Running L3 referral net balance',
  custom_referral_percent   FLOAT NULL DEFAULT NULL COMMENT 'Per-user L1 referral override (null = use global)',
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_telegram_user_id (bot_id, telegram_user_id),
  KEY idx_ichancy_login (ichancy_login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deleted users: archive of removed user records
CREATE TABLE IF NOT EXISTS deleted_users (
  id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id                    VARCHAR(128) NOT NULL DEFAULT '',
  telegram_user_id          BIGINT NOT NULL,
  telegram_username         VARCHAR(255) NULL,
  first_name                VARCHAR(255) NULL,
  last_name                 VARCHAR(255) NULL,
  ichancy_login             VARCHAR(255) NULL,
  password                  VARCHAR(255) NULL,
  balance                   DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  gifts                     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  ichancy_user_id           VARCHAR(64) NULL,
  wheel_spins_available_today INT UNSIGNED DEFAULT 0,
  last_spin_grant_date      DATE NULL,
  last_box_game_at          DATETIME NULL,
  deleted_at                DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gift codes: admin-created promotional codes that grant balance
CREATE TABLE IF NOT EXISTS gift_codes (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  code              VARCHAR(64) NOT NULL,
  amount            INT UNSIGNED NOT NULL,
  expiry_date       DATETIME NULL,
  max_redemptions   INT UNSIGNED NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  published         TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_code (bot_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gift code redemptions: tracks which user redeemed which code
CREATE TABLE IF NOT EXISTS gift_code_redemptions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  gift_code_id      INT UNSIGNED NOT NULL COMMENT 'FK to gift_codes.id',
  telegram_user_id  BIGINT NOT NULL,
  redeemed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_code_user (gift_code_id, telegram_user_id),
  CONSTRAINT fk_redemption_code FOREIGN KEY (gift_code_id) REFERENCES gift_codes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transactions: deposit and withdrawal log
CREATE TABLE IF NOT EXISTS transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  telegram_user_id  BIGINT NOT NULL,
  type              ENUM('deposit','withdrawal') NOT NULL,
  amount            DECIMAL(18,2) NOT NULL,
  method            VARCHAR(64) NOT NULL COMMENT 'e.g. syriatel, sham_usd, sham_syp, balance_to_site, site_to_balance',
  transfer_id       VARCHAR(128) NULL COMMENT 'External payment transfer reference',
  status            ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bot_user_type (bot_id, telegram_user_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Syriatel used transaction numbers (last 3 days only; app cleans older rows).
CREATE TABLE IF NOT EXISTS syriatel_used_transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  transaction_no    VARCHAR(128) NOT NULL,
  used_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_transaction_no (bot_id, transaction_no),
  KEY idx_bot_used_at (bot_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ShamCash used transaction numbers (last 3 days only; app cleans older rows). Prevents same transfer number being redeemed twice.
CREATE TABLE IF NOT EXISTS shamcash_used_transactions (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  transaction_no    VARCHAR(128) NOT NULL,
  used_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_transaction_no (bot_id, transaction_no),
  KEY idx_bot_used_at (bot_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bots: one row per bot; config stored in columns. Sequelize sync creates/alters this table.
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
  debug_logs                TINYINT(1) NOT NULL DEFAULT 0,
  cookie_refresh_interval_minutes INT NOT NULL DEFAULT 5,
  ichancy_agent_username    VARCHAR(255) NULL,
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

-- Referral net balance details: per (referrer, referred_user, level) tracking of net site transfers.
-- net_balance increases when referred user deposits to site, decreases when they withdraw from site.
CREATE TABLE IF NOT EXISTS referral_net_details (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id            VARCHAR(128) NOT NULL DEFAULT '',
  referrer_id       BIGINT NOT NULL COMMENT 'Telegram ID of the referrer who earns commission',
  referred_user_id  BIGINT NOT NULL COMMENT 'Telegram ID of the referred user whose transfers affect this',
  level             TINYINT UNSIGNED NOT NULL COMMENT '1, 2, or 3',
  net_balance       DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Running net: deposit_to_site minus withdraw_from_site',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bot_referrer_referred_level (bot_id, referrer_id, referred_user_id, level),
  KEY idx_bot_referrer (bot_id, referrer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Referral distribution history: log of each commission payout event.
CREATE TABLE IF NOT EXISTS referral_distributions (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id              VARCHAR(128) NOT NULL DEFAULT '',
  referrer_id         BIGINT NOT NULL,
  commission_amount   DECIMAL(18,2) NOT NULL COMMENT 'Total commission paid in this distribution',
  net_l1_snapshot     DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Aggregate L1 net balance at distribution time',
  net_l2_snapshot     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  net_l3_snapshot     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  details_json        JSON NULL COMMENT 'Per-referred-user detail snapshot at distribution',
  distributed_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bot_referrer (bot_id, referrer_id)
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
