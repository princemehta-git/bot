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
  ichancy_login     VARCHAR(255) NULL COMMENT 'Ichancy account name e.g. User123-Bot',
  balance           DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Balance in currency',
  gifts             DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT 'Gifts balance',
  ichancy_user_id   VARCHAR(64) NULL COMMENT 'Ichancy platform user number',
  wheel_spins_available_today INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Wheel spins available today',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_user_id (telegram_user_id),
  KEY idx_ichancy_login (ichancy_login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
