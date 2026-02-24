/**
 * Short-lived tokens for the spin Mini App when Telegram initData is not available
 * (e.g. Telegram Web). Signed with bot token so only our bot can issue/verify.
 */

const crypto = require('crypto');

const SPIN_TOKEN_TTL_SEC = 600; // 10 minutes

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  return Buffer.from(b64, 'base64');
}

/**
 * Create a spin token for the given user. Valid for SPIN_TOKEN_TTL_SEC.
 * @param {string} botId
 * @param {number} userId - Telegram user id
 * @param {string} botToken
 * @returns {string} token string (payload.signature)
 */
function createSpinToken(botId, userId, botToken) {
  if (!botId || !botToken) return '';
  const exp = Math.floor(Date.now() / 1000) + SPIN_TOKEN_TTL_SEC;
  const payload = { bot_id: botId, user_id: userId, exp };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(Buffer.from(payloadStr, 'utf8'));
  const sig = crypto.createHmac('sha256', botToken).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);
  return payloadB64 + '.' + sigB64;
}

/**
 * Verify a spin token and return bot_id and user_id if valid.
 * @param {string} token
 * @param {string} botToken
 * @returns {{ botId: string, userId: number } | null}
 */
function verifySpinToken(token, botToken) {
  if (!token || typeof token !== 'string' || !botToken) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const sig = base64UrlDecode(sigB64);
  const expectedSig = crypto.createHmac('sha256', botToken).update(payloadB64).digest();
  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  const userId = typeof payload.user_id === 'number' ? payload.user_id : parseInt(payload.user_id, 10);
  if (!payload.bot_id || !Number.isFinite(userId)) return null;
  return { botId: payload.bot_id, userId };
}

module.exports = { createSpinToken, verifySpinToken };
