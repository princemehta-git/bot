-- Migration: Add direct USD configuration columns for ShamCash min deposit and max cashout.
-- These columns are only meaningful for the 'shamcash' provider row.
-- For other providers they remain NULL.

ALTER TABLE payment_providers
  ADD COLUMN min_deposit_usd FLOAT NULL DEFAULT NULL COMMENT 'Direct USD min deposit (shamcash only)',
  ADD COLUMN max_cashout_usd FLOAT NULL DEFAULT NULL COMMENT 'Direct USD max withdrawal (shamcash only)';

-- Seed sensible defaults for existing shamcash rows
UPDATE payment_providers
  SET min_deposit_usd = 1, max_cashout_usd = 200
  WHERE provider_name = 'shamcash' AND min_deposit_usd IS NULL;
