-- Migration: Refactor payment provider limits from bots table to payment_providers table.
-- Run this ONLY if you prefer manual migration; otherwise the app runs it automatically on startup.
-- Replace @bot_id with your actual bot_id (e.g. from bots.bot_id).

-- 1) Create payment_providers table
CREATE TABLE IF NOT EXISTS payment_providers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id VARCHAR(128) NOT NULL,
  provider_name ENUM('syriatel','shamcash') NOT NULL,
  min_deposit_syp INT NOT NULL DEFAULT 50,
  min_cashout_syp INT NOT NULL DEFAULT 25000,
  max_cashout_syp INT NOT NULL DEFAULT 250000,
  cashout_tax_percent FLOAT NOT NULL DEFAULT 0,
  deposit_bonus_percent FLOAT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY bot_provider (bot_id, provider_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Copy data from bots (adjust column names if your bots table still has the old schema)
-- INSERT INTO payment_providers (bot_id, provider_name, min_deposit_syp, min_cashout_syp, max_cashout_syp, cashout_tax_percent, deposit_bonus_percent)
-- SELECT bot_id, 'syriatel', COALESCE(charge_syriatel_min, 50), COALESCE(syriatel_min, 25000), COALESCE(syriatel_max, 500000), 0, 0 FROM bots WHERE bot_id = @bot_id;
-- INSERT INTO payment_providers (bot_id, provider_name, min_deposit_syp, min_cashout_syp, max_cashout_syp, cashout_tax_percent, deposit_bonus_percent)
-- SELECT bot_id, 'shamcash', COALESCE(charge_sham_syp_min, 50), COALESCE(sham_syp_min, 100000), COALESCE(sham_syp_max, 2500000), 0, 0 FROM bots WHERE bot_id = @bot_id;

-- 3) Add new exchange rate column and copy value
-- ALTER TABLE bots ADD COLUMN exchange_rate_syp_per_usd FLOAT NOT NULL DEFAULT 15000;
-- UPDATE bots SET exchange_rate_syp_per_usd = sham_syp_per_usd WHERE bot_id = @bot_id AND sham_syp_per_usd IS NOT NULL;

-- 4) Drop old columns from bots (run one by one if your MySQL version requires it)
-- ALTER TABLE bots DROP COLUMN sham_syp_per_usd;
-- ALTER TABLE bots DROP COLUMN sham_usd_min, DROP COLUMN sham_usd_max, DROP COLUMN sham_syp_min, DROP COLUMN sham_syp_max;
-- ALTER TABLE bots DROP COLUMN syriatel_min, DROP COLUMN syriatel_max, DROP COLUMN charge_syriatel_min, DROP COLUMN charge_syriatel_max;
-- ALTER TABLE bots DROP COLUMN charge_sham_usd_min, DROP COLUMN charge_sham_usd_max, DROP COLUMN charge_sham_syp_min, DROP COLUMN charge_sham_syp_max;

-- Final structure:
-- bots: exchange_rate_syp_per_usd (global), syriatel_deposit_numbers, sham_cash_deposit_code (kept).
--   syriatel_deposit_numbers: JSON array of {number, enabled}, e.g. [{"number":"0912345678","enabled":true},...].
--   Legacy: comma-separated numbers (all treated as enabled).
-- payment_providers: one row per (bot_id, provider_name) with min_deposit_syp, min_cashout_syp, max_cashout_syp, cashout_tax_percent, deposit_bonus_percent.
