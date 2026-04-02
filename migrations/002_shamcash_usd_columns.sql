-- Migration: Add direct USD configuration columns for ShamCash min deposit, max cashout, and min cashout.
-- These columns are only meaningful for the 'shamcash' provider row.
-- For other providers they remain NULL.
-- NOTE: The app's Sequelize sync({ alter: true }) adds these columns automatically on startup.
--       This file is for manual migration only. Uses DROP+ADD to be safely re-runnable.

-- min_deposit_usd
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'payment_providers' AND COLUMN_NAME = 'min_deposit_usd' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payment_providers ADD COLUMN min_deposit_usd FLOAT NULL DEFAULT NULL COMMENT ''Direct USD min deposit (shamcash only)''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- max_cashout_usd
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'payment_providers' AND COLUMN_NAME = 'max_cashout_usd' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payment_providers ADD COLUMN max_cashout_usd FLOAT NULL DEFAULT NULL COMMENT ''Direct USD max withdrawal (shamcash only)''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- min_cashout_usd
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'payment_providers' AND COLUMN_NAME = 'min_cashout_usd' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@col_exists = 0, 'ALTER TABLE payment_providers ADD COLUMN min_cashout_usd FLOAT NULL DEFAULT NULL COMMENT ''Direct USD min withdrawal (shamcash only)''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed sensible defaults for existing shamcash rows that have NULL USD values
UPDATE payment_providers
  SET min_deposit_usd = COALESCE(min_deposit_usd, 1),
      max_cashout_usd = COALESCE(max_cashout_usd, 200),
      min_cashout_usd = COALESCE(min_cashout_usd, 5)
  WHERE provider_name = 'shamcash';
