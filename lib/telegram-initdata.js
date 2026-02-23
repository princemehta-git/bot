/**
 * Telegram WebApp initData verification utility.
 * Validates data from Telegram.WebApp.initData using HMAC-SHA256.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

const crypto = require('crypto');

const AUTH_DATE_MAX_AGE_SEC = 3600; // 1 hour

/**
 * Verify Telegram WebApp initData string.
 * @param {string} initDataString - Raw initData from Telegram.WebApp.initData
 * @param {string} botToken - Bot token for HMAC verification
 * @returns {{ valid: true, payload: object } | { valid: false }}
 */
function verifyInitData(initDataString, botToken) {
  if (!initDataString || typeof initDataString !== 'string' || !botToken) {
    return { valid: false };
  }

  const params = new URLSearchParams(initDataString);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  // Build data-check-string: all params except hash, sorted alphabetically
  const paramsObj = {};
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') paramsObj[key] = value;
  }
  const sortedKeys = Object.keys(paramsObj).sort();
  const dataCheckString = sortedKeys.map((k) => `${k}=${paramsObj[k]}`).join('\n');

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  // computed_hash = HMAC_SHA256(secret_key, data_check_string)
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return { valid: false };

  // Replay protection: auth_date must be within last hour
  const authDate = parseInt(params.get('auth_date'), 10);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > AUTH_DATE_MAX_AGE_SEC) {
    return { valid: false };
  }

  const payload = { auth_date: authDate };
  const userStr = params.get('user');
  if (userStr) {
    try {
      payload.user = JSON.parse(userStr);
    } catch (_) {
      payload.user = null;
    }
  }
  const startParam = params.get('start_param');
  if (startParam !== undefined) payload.start_param = startParam;

  return { valid: true, payload };
}

/**
 * Parse amount from prize text (extract digits).
 * @param {string} text - Prize text e.g. "💰 5000" or "حظ أوفر"
 * @returns {number}
 */
function parseAmountFromText(text) {
  const digits = (text || '').replace(/[^\d]/g, '');
  return parseInt(digits, 10) || 0;
}

module.exports = { verifyInitData, parseAmountFromText };
