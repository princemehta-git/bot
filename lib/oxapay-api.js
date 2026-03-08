'use strict';

/**
 * OxaPay API client
 * Docs: see oxapay-reference/ folder
 */

const crypto = require('crypto');

const BASE_URL = 'https://api.oxapay.com/v1';

// General API key rotation (for swap/rate endpoints)
const _generalKeys = (() => {
  const raw = (process.env.OXAPAY_GENERAL_API_KEYS || '').trim();
  return raw ? raw.split(',').map(k => k.trim()).filter(Boolean) : [];
})();
let _generalKeyIdx = 0;

function _nextGeneralKey() {
  if (_generalKeys.length === 0) throw new Error('OXAPAY_GENERAL_API_KEYS not configured');
  const key = _generalKeys[_generalKeyIdx % _generalKeys.length];
  _generalKeyIdx++;
  return key;
}

async function _callWithKeyRotation(fn) {
  const total = Math.max(_generalKeys.length, 1);
  let lastErr;
  for (let i = 0; i < total; i++) {
    const key = _nextGeneralKey();
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// ─── Core fetch helper ────────────────────────────────────────────────────────

async function _post(url, body, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'merchant_api_key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OxaPay POST ${url} → ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data ?? json; // unwrap { data: {...}, status, ... } envelope
}

async function _postGeneral(url, body, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'general_api_key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OxaPay POST ${url} → ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

async function _get(url, apiKey) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'merchant_api_key': apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OxaPay GET ${url} → ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// ─── Payment APIs (merchant key) ─────────────────────────────────────────────

/**
 * Create an invoice.
 * @param {string} merchantKey
 * @param {object} params - { amount, currency, lifetime, callback_url, order_id, fee_paid_by_payer, description }
 * @returns {{ track_id, payment_url, expired_at, date }}
 */
async function createInvoice(merchantKey, params) {
  return _post(`${BASE_URL}/payment/invoice`, params, merchantKey);
}

/**
 * Get payment information by track_id.
 * @param {string} merchantKey
 * @param {string} trackId
 * @returns {{ track_id, status, currency, amount, txs: Array }}
 */
async function getPaymentInfo(merchantKey, trackId) {
  return _get(`${BASE_URL}/payment/${encodeURIComponent(trackId)}`, merchantKey);
}

// ─── General APIs (general key with rotation) ─────────────────────────────────

/**
 * Calculate swap: how much `toCurrency` you get for `amount` of `fromCurrency`.
 * Uses general API key with rotation on failure.
 * @param {number} amount
 * @param {string} fromCurrency  e.g. 'USDT'
 * @param {string} toCurrency    e.g. 'SOL'
 * @returns {{ to_amount, rate, amount }}
 */
async function swapCalculate(amount, fromCurrency, toCurrency) {
  return _callWithKeyRotation(key =>
    _postGeneral(`${BASE_URL}/general/swap/calculate`, { from_currency: fromCurrency, to_currency: toCurrency, amount }, key)
  );
}

/**
 * Get swap rate between two currencies.
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @returns {{ rate }}
 */
async function swapRate(fromCurrency, toCurrency) {
  return _callWithKeyRotation(key =>
    _postGeneral(`${BASE_URL}/general/swap/rate`, { from_currency: fromCurrency, to_currency: toCurrency }, key)
  );
}

// ─── Webhook signature verification ─────────────────────────────────────────

/**
 * Verify HMAC-SHA512 signature from OxaPay webhook.
 * @param {Buffer|string} rawBody  - Raw request body (Buffer preferred)
 * @param {string} hmacHeader      - Value of the 'hmac' request header
 * @param {string} merchantKey     - The merchant API key for this bot
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, hmacHeader, merchantKey) {
  if (!hmacHeader || !merchantKey) return false;
  try {
    const computed = crypto
      .createHmac('sha512', merchantKey)
      .update(rawBody)
      .digest('hex');
    return computed.toLowerCase() === hmacHeader.toLowerCase();
  } catch {
    return false;
  }
}

// ─── Common APIs (public, no auth) ──────────────────────────────────────────

/**
 * Get all currencies supported by OxaPay.
 * Public endpoint — no API key required.
 * @returns {Array<{ symbol: string, name: string }>} Active currencies
 */
async function getCurrencies() {
  const res = await fetch(`${BASE_URL}/common/currencies`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OxaPay GET /common/currencies → ${res.status}: ${text}`);
  }
  const json = await res.json();
  const data = json.data ?? json;
  return Object.values(data)
    .filter(c => c && c.status === true && c.symbol)
    .map(c => {
      // Use the maximum deposit_min across all networks (most conservative — guarantees the
      // amount meets whichever network OxaPay routes the payer to)
      const nets = Object.values(c.networks || {});
      const depositMin = nets.length > 0
        ? Math.max(...nets.map(n => Number(n.deposit_min) || 0))
        : 0;
      return { symbol: c.symbol, name: c.name || c.symbol, deposit_min: depositMin };
    });
}

// ─── Coin mapping constants ───────────────────────────────────────────────────

/**
 * OxaPay supports plain currency codes only (no network-specific variants).
 * Network selection is handled by OxaPay on their payment page.
 * Supported: USDT, BTC, ETH, TRX, LTC, SOL
 */

/** Map from short callback slug → display name shown to users */
const COIN_SLUG_TO_DISPLAY = {
  USDT: 'USDT',
  BTC:  'BTC',
  ETH:  'ETH',
  TRX:  'TRX',
  LTC:  'LTC',
  SOL:  'SOL',
};

/** Set of OxaPay API codes that are stablecoins (treated 1:1 with USD, no swap needed) */
const USDT_API_CODES = new Set(['USDT', 'USDC', 'DAI']);

/** Map from display name → OxaPay API currency code */
const COIN_DISPLAY_TO_API = {
  'USDT': 'USDT',
  'BTC':  'BTC',
  'ETH':  'ETH',
  'TRX':  'TRX',
  'LTC':  'LTC',
  'SOL':  'SOL',
};

/** Map from OxaPay API currency code → display name */
const COIN_API_TO_DISPLAY = Object.fromEntries(
  Object.entries(COIN_DISPLAY_TO_API).map(([d, a]) => [a, d])
);

module.exports = {
  createInvoice,
  getPaymentInfo,
  getCurrencies,
  swapCalculate,
  swapRate,
  verifyWebhookSignature,
  COIN_SLUG_TO_DISPLAY,
  COIN_DISPLAY_TO_API,
  COIN_API_TO_DISPLAY,
  USDT_API_CODES,
};
