/**
 * Ichancy Agent API client – direct API calls to agents.ichancy.com (no Cloudflare bypass).
 *
 * Base URL: https://agents.ichancy.com/global/api
 * Auth: First call signIn(); use the returned cookies for all subsequent API calls (Cookie header).
 *
 * Usage:
 *   const { signIn, registerPlayer, loginAndRegisterPlayer } = require('./lib/ichancy-api');
 *   const login = await signIn(username, password);
 *   const result = await registerPlayer({ email, password, login }, parentId, login.cookies);  // cookies only, no token
 *   // Or one-shot:
 *   const result = await loginAndRegisterPlayer(player);
 */

const BASE_URL = 'https://agents.ichancy.com/global/api';
const ORIGIN = 'https://agents.ichancy.com';

let _apiDebugLogs = false;
let _apiCookieRefreshMs = 5 * 60 * 1000;
let _apiCookieCacheEnabled = true;
let _apiAgentUsername = '';
let _apiAgentPassword = '';
let _apiParentId = '';

/**
 * Configure the API module with values from DB config.
 * Call once at startup after loading config from the bot_config table.
 */
function configureApi({ debugLogs, cookieRefreshMinutes, agentUsername, agentPassword, parentId } = {}) {
  if (debugLogs !== undefined) _apiDebugLogs = debugLogs === true || debugLogs === 'true' || debugLogs === '1';
  if (cookieRefreshMinutes !== undefined) {
    const min = parseInt(cookieRefreshMinutes, 10);
    _apiCookieRefreshMs = Number.isNaN(min) || min < 0 ? 5 * 60 * 1000 : min * 60 * 1000;
    _apiCookieCacheEnabled = _apiCookieRefreshMs > 0;
  }
  if (agentUsername !== undefined) _apiAgentUsername = trimCred(agentUsername);
  if (agentPassword !== undefined) _apiAgentPassword = trimCred(agentPassword);
  if (parentId !== undefined) _apiParentId = trimCred(parentId);
}

function debugLog(...args) {
  if (_apiDebugLogs) console.log('[IchancyAPI]', ...args);
}

function trimCred(s) {
  const str = s === null || s === undefined ? '' : String(s);
  return str.trim().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');
}

/** In-memory agent session: { cookies: string | null, refreshedAt: number } */
let agentSession = { cookies: null, refreshedAt: 0 };

/**
 * Get agent session cookies. Uses cache when COOKIE_REFRESH_INTERVAL_MINUTES > 0 and cache is valid.
 * When interval is 0, always signs in (no cache). Force refresh to re-login and update cache.
 *
 * @param {boolean} [forceRefresh=false] - If true, sign in again and update cache.
 * @returns {Promise<string>} Cookie header string for API requests.
 */
async function getAgentSession(forceRefresh = false) {
  const username = _apiAgentUsername;
  const password = _apiAgentPassword;
  if (!username || !password) throw new Error('Agent credentials required: ICHANCY_AGENT_USERNAME, ICHANCY_AGENT_PASSWORD');

  if (!_apiCookieCacheEnabled) {
    debugLog('getAgentSession: cache disabled (interval 0), signing in');
    const login = await signIn(username, password);
    if (!login.success) throw new Error('Agent signIn failed');
    return login.cookies;
  }

  const now = Date.now();
  const expired = forceRefresh || !agentSession.cookies || (now - agentSession.refreshedAt > _apiCookieRefreshMs);
  if (expired) {
    debugLog('getAgentSession:', forceRefresh ? 'force refresh' : !agentSession.cookies ? 'no cache' : 'cache expired', '— signing in');
    const login = await signIn(username, password);
    if (!login.success) throw new Error('Agent signIn failed');
    agentSession = { cookies: login.cookies, refreshedAt: now };
  } else {
    debugLog('getAgentSession: using cached cookies');
  }
  return agentSession.cookies;
}

/**
 * Invalidate the agent session cache. Call after an API request fails (e.g. auth/session expired)
 * so the next getAgentSession() will sign in again.
 */
function invalidateAgentSession() {
  if (agentSession.cookies) {
    debugLog('invalidateAgentSession: clearing cache');
    agentSession = { cookies: null, refreshedAt: 0 };
  }
}

/** Headers that match the browser in the HAR (Origin, Referer, Accept) */
function browserLikeHeaders(referer = `${ORIGIN}/`) {
  return {
    'Content-Type': 'application/json',
    Accept: '*/*',
    Origin: ORIGIN,
    Referer: referer,
  };
}

/**
 * Build Cookie header string from response Set-Cookie header(s).
 * @param {Headers} headers - fetch response.headers
 * @returns {string}
 */
function getCookieHeaderFromResponse(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const setCookies = headers.getSetCookie();
    return setCookies.map((s) => s.split(';')[0].trim()).filter(Boolean).join('; ');
  }
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return '';
  return setCookie.split(',').map((s) => s.split(';')[0].trim()).filter(Boolean).join('; ');
}

/**
 * POST to an API path with optional Cookie header (for authenticated calls).
 * @param {string} path - e.g. 'UserApi/registerPlayer'
 * @param {object} body - JSON body
 * @param {{ cookies?: string }} [options] - From signIn()
 * @returns {Promise<{ status: number, data: any }>}
 */
async function apiRequest(path, body, options = {}) {
  debugLog('apiRequest: starting', { path, hasCookies: !!options.cookies });
  const url = path.startsWith('http') ? path : `${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const referer = options.referer || `${ORIGIN}/dashboard`;
  const headers = browserLikeHeaders(referer);
  if (options.cookies) {
    headers['Cookie'] = options.cookies;
  }
  debugLog('apiRequest: sending request', { path, payload: body });
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const responseCookies = getCookieHeaderFromResponse(res.headers);
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  const text = await res.text();
  if (text) {
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }
  }
  if (_apiDebugLogs) {
    debugLog('apiRequest: got response', { path, status: res.status, resultOk: data && data.status === true, cookies: responseCookies || null, data });
  } else {
    debugLog('apiRequest: got response', { path, status: res.status, resultOk: data && data.status === true, cookies: responseCookies || null });
  }
  return { status: res.status, data };
}

/**
 * Sign in – returns session cookies to use for all subsequent API calls.
 * POST /User/signIn
 *
 * @param {string} username - Agent email/username
 * @param {string} password - Agent password
 * @returns {Promise<{ success: boolean, cookies: string, data?: any, status: number }>} Success when response has status === true (token ignored for now).
 */
async function signIn(username, password) {
  const url = `${BASE_URL.replace(/\/$/, '')}/User/signIn`;
  const u = trimCred(username);
  const p = trimCred(password);
  const requestPayload = { username: u, password: p };
  const payloadForLog = { username: u, password: p ? '***' : '' };

  if (_apiDebugLogs) {
    console.log('[IchancyAPI] ─── signIn: calling Ichancy site for agent login ───');
    console.log('[IchancyAPI] signIn REQUEST:');
    console.log('[IchancyAPI]   URL:', url);
    console.log('[IchancyAPI]   Method: POST');
    console.log('[IchancyAPI]   Payload:', JSON.stringify(payloadForLog, null, 2));
  }
  debugLog('signIn: starting');

  const res = await fetch(url, {
    method: 'POST',
    headers: browserLikeHeaders(),
    body: JSON.stringify(requestPayload),
  });
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  const text = await res.text();
  if (text) {
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }
  }
  const cookies = getCookieHeaderFromResponse(res.headers);
  const hasErrorNotification = data && Array.isArray(data.notification) && data.notification.some(
    (n) => n && (n.status === 'error' || (n.content && /login|password|attempt limit/i.test(String(n.content))))
  );
  const ok = res.status === 200 && data && data.status === true && data.result !== false && !hasErrorNotification;

  if (_apiDebugLogs) {
    console.log('[IchancyAPI] signIn RESPONSE:');
    console.log('[IchancyAPI]   Status:', res.status, res.statusText);
    console.log('[IchancyAPI]   Success:', ok, '(hasErrorNotification:', !!hasErrorNotification, ', result:', data && data.result, ')');
    console.log('[IchancyAPI]   Cookies received:', cookies ? 'yes (' + (cookies.length || 0) + ' chars)' : 'no');
    console.log('[IchancyAPI]   Response body:', JSON.stringify(data, null, 2));
    console.log('[IchancyAPI] ─── signIn: done ───');
  } else {
    debugLog('signIn: got response', { status: res.status, success: ok, cookies: cookies ? 'present' : 'none' });
  }
  return {
    success: ok,
    cookies: ok ? cookies : (cookies || ''),
    data,
    status: res.status,
  };
}

/**
 * Refresh access token. POST /UserApi/refreshToken (body-only; use when you have refreshToken from signIn data).
 *
 * @param {string} refreshToken
 * @returns {Promise<{ success: boolean, accessToken?: string, refreshToken?: string, data?: any }>}
 */
async function refreshToken(refreshToken) {
  debugLog('refreshToken: starting');
  const { status, data } = await apiRequest('UserApi/refreshToken', { refreshToken });
  const ok = status === 200 && data && data.status === true && data.result && data.result.accessToken;
  debugLog('refreshToken: done', { ok });
  if (ok) {
    return {
      success: true,
      accessToken: data.result.accessToken,
      refreshToken: data.result.refreshToken,
      data,
    };
  }
  return { success: false, data };
}

/**
 * Register a new player. Must be called with cookies from signIn().
 * POST /UserApi/registerPlayer
 *
 * @param {{ email: string, password: string, login: string }} player
 * @param {string} parentId - Agent/parent ID
 * @param {string|{ cookies?: string }} session - Cookie string from signIn(), or { cookies }
 * @returns {Promise<{ success: boolean, data: any, status: number }>}
 */
async function registerPlayer(player, parentId, session) {
  const opts = typeof session === 'string' ? { cookies: session } : session;
  if (!opts || !opts.cookies) throw new Error('registerPlayer requires cookies from signIn()');
  const p = player || {};
  const body = {
    player: {
      email: trimCred(p.email),
      password: trimCred(p.password),
      parentId: String(trimCred(parentId)),
      login: trimCred(p.login),
    },
  };
  const payloadForLog = {
    player: {
      email: body.player.email,
      password: body.player.password ? '***' : '',
      parentId: body.player.parentId,
      login: body.player.login,
    },
  };

  if (_apiDebugLogs) {
    console.log('[IchancyAPI] ─── registerPlayer: creating user on Ichancy ───');
    console.log('[IchancyAPI] registerPlayer REQUEST:');
    console.log('[IchancyAPI]   URL:', `${BASE_URL.replace(/\/$/, '')}/Player/registerPlayer`);
    console.log('[IchancyAPI]   Method: POST');
    console.log('[IchancyAPI]   Payload:', JSON.stringify(payloadForLog, null, 2));
  }
  debugLog('registerPlayer: starting', { parentId, playerLogin: p.login || body.player.login });

  const optsWithReferer = { ...opts, referer: `${ORIGIN}/players/players` };
  const { status, data } = await apiRequest('Player/registerPlayer', body, optsWithReferer);
  const r = data && data.result;
  const resultOk = r !== false && r !== 'ex' && (r === true || r === 1 || (typeof r === 'number' && r > 0));
  const success = status === 200 && data && data.status === true && resultOk;

  if (_apiDebugLogs) {
    console.log('[IchancyAPI] registerPlayer RESPONSE:');
    console.log('[IchancyAPI]   Status:', status);
    console.log('[IchancyAPI]   Success:', success);
    console.log('[IchancyAPI]   data.status:', data && data.status);
    console.log('[IchancyAPI]   data.result:', data && data.result);
    if (data && data.notification && data.notification.length) {
      console.log('[IchancyAPI]   data.notification:', JSON.stringify(data.notification, null, 2));
    }
    console.log('[IchancyAPI]   Full response body:', JSON.stringify(data, null, 2));
    console.log('[IchancyAPI] ─── registerPlayer: done ───');
  } else {
    debugLog('registerPlayer: got result', { success, status });
  }

  return {
    success,
    data,
    status,
  };
}

/**
 * One-shot: sign in with agent credentials, then register a player.
 * Uses env ICHANCY_AGENT_USERNAME, ICHANCY_AGENT_PASSWORD, ICHANCY_PARENT_ID if not passed.
 *
 * @param {{ email: string, password: string, login: string }} player
 * @param {{ username?: string, password?: string, parentId?: string }} [agent] - Override env
 * @returns {Promise<{ loginOk: boolean, registerOk: boolean, loginData?: any, registerData?: any, status?: number }>}
 */
async function loginAndRegisterPlayer(player, agent = {}) {
  const username = agent.username || _apiAgentUsername;
  const password = agent.password || _apiAgentPassword;
  const parentId = agent.parentId || _apiParentId;

  if (!username || !password) throw new Error('Agent credentials required: ICHANCY_AGENT_USERNAME, ICHANCY_AGENT_PASSWORD');
  if (!parentId) throw new Error('Parent ID required: ICHANCY_PARENT_ID or agent.parentId');

  if (_apiDebugLogs) {
    console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
    console.log('[IchancyAPI] loginAndRegisterPlayer: START (create new user flow)');
    console.log('[IchancyAPI]   playerLogin:', player.login);
    console.log('[IchancyAPI]   playerEmail:', player.email);
    console.log('[IchancyAPI]   parentId:', parentId);
    console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
  }
  debugLog('loginAndRegisterPlayer: starting', { playerLogin: player.login, parentId });
  let cookies;
  try {
    cookies = await getAgentSession();
  } catch (err) {
    debugLog('loginAndRegisterPlayer: getAgentSession failed', err.message);
    return {
      loginOk: false,
      registerOk: false,
      loginData: null,
      status: 0,
    };
  }

  debugLog('loginAndRegisterPlayer: step 2 — registerPlayer');
  let registerResult = await registerPlayer(player, parentId, cookies);
  if (!registerResult.success && _apiCookieCacheEnabled) {
    debugLog('loginAndRegisterPlayer: register failed, retrying with fresh login');
    invalidateAgentSession();
    try {
      cookies = await getAgentSession(true);
      registerResult = await registerPlayer(player, parentId, cookies);
    } catch (retryErr) {
      debugLog('loginAndRegisterPlayer: retry getAgentSession failed', retryErr.message);
    }
  }
  if (_apiDebugLogs) {
    console.log('[IchancyAPI] ─────────────────────────────────────────────────────────────');
    console.log('[IchancyAPI] loginAndRegisterPlayer: DONE');
    console.log('[IchancyAPI]   registerOk:', registerResult.success);
    console.log('[IchancyAPI]   status:', registerResult.status);
    console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
  }
  debugLog('loginAndRegisterPlayer: done', { registerOk: registerResult.success });
  return {
    loginOk: true,
    registerOk: registerResult.success,
    loginData: null,
    registerData: registerResult.data,
    status: registerResult.status,
    cookies,
  };
}

/**
 * Get players statistics (list of players for current agent).
 * POST Statistics/getPlayersStatisticsPro
 * @param {string} cookies - From signIn()
 * @param {{ start?: number, limit?: number }} [opts]
 * @returns {Promise<{ success: boolean, records?: any[], data?: any }>}
 */
async function getPlayersStatisticsPro(cookies, opts = {}) {
  debugLog('getPlayersStatisticsPro: starting', { start: opts.start ?? 0, limit: opts.limit ?? 20 });
  const start = opts.start ?? 0;
  const limit = opts.limit ?? 20;
  const body = { start, limit, filter: {} };
  const optsWithReferer = { cookies, referer: `${ORIGIN}/players/players` };
  const { status, data } = await apiRequest('Statistics/getPlayersStatisticsPro', body, optsWithReferer);
  const resultObj = data && data.result && typeof data.result === 'object';
  const ok = status === 200 && data && data.status === true && resultObj && Array.isArray(data.result.records);
  debugLog('getPlayersStatisticsPro: done', { ok, recordsCount: ok ? data.result.records.length : 0 });
  return {
    success: ok,
    records: ok ? data.result.records : [],
    data,
  };
}

/**
 * Resolve playerId by login (username). Fetches getPlayersStatisticsPro and finds the record with matching username.
 * (Register API returns result: 1 as success flag, not the real playerId; real id is in Statistics/getPlayersStatisticsPro.)
 * @param {string} cookies - From signIn()
 * @param {string} playerLogin - e.g. "Bot-playeridtest"
 * @returns {Promise<string|undefined>}
 */
async function getPlayerIdByLogin(cookies, playerLogin) {
  debugLog('getPlayerIdByLogin: starting', { playerLogin });
  const { success, records } = await getPlayersStatisticsPro(cookies, { start: 0, limit: 200 });
  if (!success || !records.length) {
    debugLog('getPlayerIdByLogin: no records');
    return undefined;
  }
  const match = records.find((r) => (r.username || '').toLowerCase() === (playerLogin || '').toLowerCase());
  const playerId = match ? String(match.playerId || match.player_id || '') : undefined;
  debugLog('getPlayerIdByLogin: done', { found: !!playerId, playerId });
  return playerId;
}

/**
 * Search for a player by username using the searchBy parameter (direct server-side search).
 * Returns partial matches, so we do exact case-insensitive matching on the result.
 * POST Statistics/getPlayersStatisticsPro with searchBy: { players: playerLogin }
 * @param {string} cookies - From signIn()
 * @param {string} playerLogin - e.g. "Bot-playeridtest"
 * @returns {Promise<string|undefined>} playerId if exact match found
 */
async function findPlayerBySearch(cookies, playerLogin) {
  debugLog('findPlayerBySearch: starting', { playerLogin });
  const body = { start: 0, limit: 10, filter: {}, searchBy: { players: playerLogin } };
  const optsWithReferer = { cookies, referer: `${ORIGIN}/players/players` };
  const { status, data } = await apiRequest('Statistics/getPlayersStatisticsPro', body, optsWithReferer);
  const resultObj = data && data.result && typeof data.result === 'object';
  const ok = status === 200 && data && data.status === true && resultObj && Array.isArray(data.result.records);
  if (!ok || !data.result.records.length) {
    debugLog('findPlayerBySearch: no results');
    return undefined;
  }
  // Server does partial matching, so find exact case-insensitive match
  const match = data.result.records.find((r) => (r.username || '').toLowerCase() === (playerLogin || '').toLowerCase());
  const playerId = match ? String(match.playerId || match.player_id || '') : undefined;
  debugLog('findPlayerBySearch: done', { found: !!playerId, playerId, totalResults: data.result.records.length });
  return playerId;
}

/**
 * Robust player ID resolution with retries.
 * Order: new way (searchBy) x2, old way (bulk fetch) x2.
 * If all fail, force re-sign-in for fresh cookies, then repeat.
 * Runs in background — caller should fire-and-forget.
 *
 * @param {string} cookies - Initial cookies from signIn()
 * @param {string} playerLogin - Username to resolve
 * @param {function} getSessionFn - async (forceRefresh) => cookies
 * @param {function} invalidateSessionFn - () => void
 * @returns {Promise<string|undefined>} playerId if found
 */
async function resolvePlayerIdWithRetry(cookies, playerLogin, getSessionFn, invalidateSessionFn) {
  debugLog('resolvePlayerIdWithRetry: starting', { playerLogin });

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Phase 1: try with current cookies
  for (let i = 1; i <= 2; i++) {
    try {
      const id = await findPlayerBySearch(cookies, playerLogin);
      if (id) { debugLog('resolvePlayerIdWithRetry: found (new way, phase 1, attempt ' + i + ')'); return id; }
    } catch (err) { debugLog('resolvePlayerIdWithRetry: new way attempt ' + i + ' failed:', err.message); }
    if (i < 2) await delay(2000);
  }

  for (let i = 1; i <= 2; i++) {
    try {
      const id = await getPlayerIdByLogin(cookies, playerLogin);
      if (id) { debugLog('resolvePlayerIdWithRetry: found (old way, phase 1, attempt ' + i + ')'); return id; }
    } catch (err) { debugLog('resolvePlayerIdWithRetry: old way attempt ' + i + ' failed:', err.message); }
    if (i < 2) await delay(2000);
  }

  // Phase 2: force re-sign-in for fresh cookies, then retry
  debugLog('resolvePlayerIdWithRetry: phase 1 exhausted, forcing re-sign-in');
  let freshCookies;
  try {
    invalidateSessionFn();
    freshCookies = await getSessionFn(true);
  } catch (err) {
    debugLog('resolvePlayerIdWithRetry: re-sign-in failed:', err.message);
    return undefined;
  }

  for (let i = 1; i <= 2; i++) {
    try {
      const id = await findPlayerBySearch(freshCookies, playerLogin);
      if (id) { debugLog('resolvePlayerIdWithRetry: found (new way, phase 2, attempt ' + i + ')'); return id; }
    } catch (err) { debugLog('resolvePlayerIdWithRetry: new way phase 2 attempt ' + i + ' failed:', err.message); }
    if (i < 2) await delay(2000);
  }

  for (let i = 1; i <= 2; i++) {
    try {
      const id = await getPlayerIdByLogin(freshCookies, playerLogin);
      if (id) { debugLog('resolvePlayerIdWithRetry: found (old way, phase 2, attempt ' + i + ')'); return id; }
    } catch (err) { debugLog('resolvePlayerIdWithRetry: old way phase 2 attempt ' + i + ' failed:', err.message); }
    if (i < 2) await delay(2000);
  }

  debugLog('resolvePlayerIdWithRetry: all attempts exhausted, player not found');
  return undefined;
}

/**
 * Get player balance on the site (site wallet). POST Player/getPlayerBalanceById
 * @param {string} cookies - From signIn()
 * @param {string} playerId - Ichancy player id (ichancy_user_id)
 * @returns {Promise<{ success: boolean, balance?: number, currencyCode?: string, data?: any }>}
 */
async function getPlayerBalanceById(cookies, playerId) {
  debugLog('getPlayerBalanceById: starting', { playerId });
  const body = { playerId: String(playerId) };
  const { status, data } = await apiRequest('Player/getPlayerBalanceById', body, { cookies });
  const ok = status === 200 && data && data.status === true && Array.isArray(data.result) && data.result.length > 0;
  if (!ok) {
    debugLog('getPlayerBalanceById: failed or no result');
    return { success: false, data };
  }
  const main = data.result.find((r) => r.main) || data.result[0];
  const balance = main && (main.balance !== undefined && main.balance !== null) ? Number(main.balance) : 0;
  debugLog('getPlayerBalanceById: done', { balance });
  return {
    success: true,
    balance,
    currencyCode: main && main.currencyCode ? main.currencyCode : 'NSP',
    data,
  };
}

/**
 * Deposit to player (add money to user's website wallet). POST Player/depositToPlayer
 * @param {string} cookies - From signIn()
 * @param {string} playerId - Ichancy player id (ichancy_user_id)
 * @param {number} amount - Amount to deposit
 * @param {{ currencyCode?: string, moneyStatus?: number, comment?: string }} [opts]
 * @returns {Promise<{ success: boolean, data?: any, notification?: any[] }>}
 */
async function depositToPlayer(cookies, playerId, amount, opts = {}) {
  debugLog('depositToPlayer: starting', { playerId, amount });
  const body = {
    amount: Number(amount),
    comment: opts.comment ?? null,
    playerId: String(playerId),
    currencyCode: opts.currencyCode ?? 'NSP',
    moneyStatus: opts.moneyStatus ?? 5,
  };
  if (_apiDebugLogs) debugLog('depositToPlayer: payload', body);
  debugLog('depositToPlayer: calling API');
  const { status, data } = await apiRequest('Player/depositToPlayer', body, { cookies });
  // API returns data.result as balance object on success, not boolean true
  const success = status === 200 && data && data.status === true && (data.result === true || (data.result && typeof data.result === 'object'));
  if (_apiDebugLogs) debugLog('depositToPlayer: got result', { success, status, data });
  else debugLog('depositToPlayer: got result', { success, status });
  return {
    success,
    data,
    notification: data && data.notification,
  };
}

/**
 * Withdraw from player (take money from user's website wallet). POST Player/withdrawFromPlayer
 * Amount in payload must be negative.
 *
 * @param {string} cookies - From signIn()
 * @param {string} playerId - Ichancy player id (ichancy_user_id)
 * @param {number} amount - Positive amount to withdraw (sent as -amount in API)
 * @param {{ currencyCode?: string, moneyStatus?: number, comment?: string }} [opts]
 * @returns {Promise<{ success: boolean, data?: any, notification?: any[] }>}
 */
async function withdrawFromPlayer(cookies, playerId, amount, opts = {}) {
  debugLog('withdrawFromPlayer: starting', { playerId, amount });
  const body = {
    amount: -Number(amount),
    comment: opts.comment ?? null,
    playerId: String(playerId),
    currencyCode: opts.currencyCode ?? 'NSP',
    moneyStatus: opts.moneyStatus ?? 5,
  };
  if (_apiDebugLogs) debugLog('withdrawFromPlayer: payload', body);
  debugLog('withdrawFromPlayer: calling API');
  const { status, data } = await apiRequest('Player/withdrawFromPlayer', body, { cookies });
  // API may return data.result as balance object on success, not boolean true
  const success = status === 200 && data && data.status === true && (data.result === true || (data.result && typeof data.result === 'object'));
  if (_apiDebugLogs) debugLog('withdrawFromPlayer: got result', { success, status, data });
  else debugLog('withdrawFromPlayer: got result', { success, status });
  return {
    success,
    data,
    notification: data && data.notification,
  };
}

/**
 * Get agent wallet (cashier balance on ichancy). POST Agent/getAgentWallet
 * @param {string} cookies - From signIn() / getAgentSession()
 * @returns {Promise<{ success: boolean, balance?: string, data?: any }>}
 */
async function getAgentWallet(cookies) {
  debugLog('getAgentWallet: starting');
  const { status, data } = await apiRequest('Agent/getAgentWallet', {}, { cookies });
  const ok = status === 200 && data && data.status === true && data.result && (typeof data.result.balance !== 'undefined');
  if (!ok) {
    debugLog('getAgentWallet: failed or no result');
    return { success: false, data };
  }
  const balance = String(data.result.balance ?? '0');
  debugLog('getAgentWallet: done', { balance });
  return {
    success: true,
    balance,
    data: data.result,
  };
}

/**
 * Create a per-bot API client with its own session cache and credentials.
 * Each bot instance should call this once and use the returned functions.
 */
function createApiClient(config = {}) {
  let debugLogs = config.debugLogs === true || config.debugLogs === 'true' || config.debugLogs === '1';
  const agentUsername = trimCred(config.agentUsername);
  const agentPassword = trimCred(config.agentPassword);
  const parentId = trimCred(config.parentId);
  configureApi({ debugLogs, cookieRefreshMinutes: config.cookieRefreshMinutes, agentUsername, agentPassword, parentId });
  let cookieRefreshMinutes = parseInt(config.cookieRefreshMinutes, 10);
  let cookieRefreshMs = Number.isNaN(cookieRefreshMinutes) || cookieRefreshMinutes < 0 ? 5 * 60 * 1000 : cookieRefreshMinutes * 60 * 1000;
  let cookieCacheEnabled = cookieRefreshMs > 0;
  let session = { cookies: null, refreshedAt: 0 };

  function log(...args) { if (debugLogs) console.log('[IchancyAPI]', ...args); }

  async function _getSession(forceRefresh = false) {
    if (!agentUsername || !agentPassword) throw new Error('Agent credentials required');
    if (!cookieCacheEnabled) {
      const login = await signIn(agentUsername, agentPassword);
      if (!login.success) throw new Error('Agent signIn failed');
      return login.cookies;
    }
    const now = Date.now();
    if (forceRefresh || !session.cookies || (now - session.refreshedAt > cookieRefreshMs)) {
      const login = await signIn(agentUsername, agentPassword);
      if (!login.success) throw new Error('Agent signIn failed');
      session = { cookies: login.cookies, refreshedAt: now };
    }
    return session.cookies;
  }

  function _invalidateSession() { session = { cookies: null, refreshedAt: 0 }; }

  async function _loginAndRegisterPlayer(player, agent = {}) {
    const u = agent.username || agentUsername;
    const p = agent.password || agentPassword;
    const pid = agent.parentId || parentId;
    if (!u || !p) throw new Error('Agent credentials required');
    if (!pid) throw new Error('Parent ID required');
    if (debugLogs) {
      console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
      console.log('[IchancyAPI] loginAndRegisterPlayer: START (create new user flow)');
      console.log('[IchancyAPI]   playerLogin:', player.login);
      console.log('[IchancyAPI]   playerEmail:', player.email);
      console.log('[IchancyAPI]   parentId:', pid);
      console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
    }
    let cookies;
    try { cookies = await _getSession(); } catch (err) {
      if (debugLogs) console.log('[IchancyAPI] loginAndRegisterPlayer: FAILED at getSession —', err.message);
      return { loginOk: false, registerOk: false, loginData: null, status: 0 };
    }
    let registerResult = await registerPlayer(player, pid, cookies);
    if (!registerResult.success && cookieCacheEnabled) {
      _invalidateSession();
      try { cookies = await _getSession(true); registerResult = await registerPlayer(player, pid, cookies); } catch (_) {}
    }
    if (debugLogs) {
      console.log('[IchancyAPI] ─────────────────────────────────────────────────────────────');
      console.log('[IchancyAPI] loginAndRegisterPlayer: DONE');
      console.log('[IchancyAPI]   registerOk:', registerResult.success);
      console.log('[IchancyAPI]   status:', registerResult.status);
      console.log('[IchancyAPI] ═══════════════════════════════════════════════════════════');
    }
    return { loginOk: true, registerOk: registerResult.success, loginData: null, registerData: registerResult.data, status: registerResult.status, cookies };
  }

  async function _getPlayerIdByLogin(cookies, playerLogin) {
    return getPlayerIdByLogin(cookies, playerLogin);
  }

  async function _resolvePlayerIdWithRetry(cookies, playerLogin) {
    return resolvePlayerIdWithRetry(cookies, playerLogin, _getSession, _invalidateSession);
  }

  return {
    getAgentSession: _getSession,
    invalidateAgentSession: _invalidateSession,
    loginAndRegisterPlayer: _loginAndRegisterPlayer,
    getPlayerIdByLogin: _getPlayerIdByLogin,
    resolvePlayerIdWithRetry: _resolvePlayerIdWithRetry,
    getPlayerBalanceById,
    depositToPlayer,
    withdrawFromPlayer,
    getAgentWallet,
  };
}

module.exports = {
  BASE_URL,
  configureApi,
  createApiClient,
  apiRequest,
  signIn,
  getAgentSession,
  invalidateAgentSession,
  refreshToken,
  registerPlayer,
  loginAndRegisterPlayer,
  getPlayersStatisticsPro,
  getPlayerIdByLogin,
  findPlayerBySearch,
  resolvePlayerIdWithRetry,
  getPlayerBalanceById,
  depositToPlayer,
  withdrawFromPlayer,
  getAgentWallet,
};
