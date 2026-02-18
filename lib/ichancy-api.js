/**
 * Ichancy API client – bypass Cloudflare via local proxy, then login and register players.
 *
 * Set BYPASS_API_URLS (comma-separated) for multiple servers; each request tries them in order
 * until one succeeds. Example: BYPASS_API_URLS=http://localhost:8000,http://184.168.126.149:8000
 * Falls back to BYPASS_API_URL or http://localhost:8000 if unset.
 *
 * Usage:
 *   const { getBypassCookies, mirrorRequest, login, registerPlayer } = require('./lib/ichancy-api');
 *   const { cookies } = await login(username, password);
 *   const result = await registerPlayer({ email, password, login }, cookies);
 */

const ICHANCY_HOST = 'agents.ichancy.com';
const PATH_SIGN_IN = 'global/api/User/signIn';
const PATH_REGISTER_PLAYER = 'global/api/Player/registerPlayer';

const DEFAULT_BYPASS_URL = 'http://localhost:8000';

/**
 * Get bypass API base URLs from env (comma-separated). Tried in order for failover.
 * Falls back to BYPASS_API_URL then single default.
 * @returns {string[]}
 */
function getBypassBaseUrls() {
  const urls = process.env.BYPASS_API_URLS || process.env.BYPASS_API_URL || DEFAULT_BYPASS_URL;
  return urls.split(',').map((u) => u.trim()).filter(Boolean);
}

/**
 * Parse Set-Cookie header values into a single Cookie header string (name=value pairs only).
 * @param {string[]} setCookieHeaders - From response.headers.getSetCookie() or raw set-cookie strings
 * @returns {string}
 */
function parseSetCookieToCookieHeader(setCookieHeaders) {
  if (!setCookieHeaders || setCookieHeaders.length === 0) return '';
  const pairs = setCookieHeaders.map((raw) => {
    const part = raw.split(';')[0].trim();
    return part;
  }).filter(Boolean);
  return pairs.join('; ');
}

/**
 * Get Cloudflare bypass cookies and user-agent for a target URL.
 * Tries each BYPASS_API_URLS entry until one succeeds.
 *
 * @param {string} targetUrl - Full URL, e.g. 'https://agents.ichancy.com/'
 * @param {{ bypassCache?: boolean }} [options]
 * @returns {Promise<{ cookies: Record<string, string>, user_agent: string }>}
 */
async function getBypassCookies(targetUrl, options = {}) {
  const bases = getBypassBaseUrls();
  const targetHost = new URL(targetUrl).hostname;
  const headers = { 'x-hostname': targetHost };
  if (options.bypassCache) headers['x-bypass-cache'] = 'true';
  let lastError;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    try {
      const url = new URL(b + '/cookies');
      url.searchParams.set('url', targetUrl);
      console.log('[CloudflareBypass] GET', url.toString(), { payload: { headers } });
      const res = await fetch(url.toString(), { headers });
      if (res.ok) return await res.json();
      lastError = new Error(`getBypassCookies failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('getBypassCookies: no servers available');
}

/**
 * Fire-and-forget: ping BYPASS_API_URL up to BYPASS_BATCH_SIZE times for agents.ichancy.com.
 * Uses GET /api/data with cache only (no x-bypass-cache) so no new cookies/sessions are created.
 */
function pingBypassCookiesAgentsIchancy() {
  const bases = getBypassBaseUrls();
  if (bases.length === 0) return;
  const batchSize = Math.max(1, parseInt(process.env.BYPASS_BATCH_SIZE, 10) || 5);
  const hostname = ICHANCY_HOST;
  for (let i = 0; i < batchSize; i++) {
    const base = bases[i % bases.length].replace(/\/$/, '');
    const url = `${base}/api/data`;
    fetch(url, { headers: { 'x-hostname': hostname } }).catch(() => {});
  }
}

/**
 * Ping every bypass base URL in parallel; ignore response (fire-and-forget).
 * Runs once per cron interval (BYPASS_PING_INTERVAL_MIN). GET /api/data, cache only.
 */
function pingBypassCookiesAgentsIchancyOncePerServer() {
  const bases = getBypassBaseUrls();
  const hostname = ICHANCY_HOST;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    fetch(`${b}/api/data`, { headers: { 'x-hostname': hostname } }).catch(() => {});
  }
}

/**
 * Clear CloudflareBypassForScraping cookie cache and mirror sessions.
 * Tries each BYPASS_API_URLS server; succeeds if at least one clears.
 *
 * @returns {Promise<void>}
 */
async function clearBypassCache() {
  const bases = getBypassBaseUrls();
  let lastError;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    try {
      const url = b + '/cache/clear';
      console.log('[CloudflareBypass] POST', url, { payload: {} });
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) return;
      lastError = new Error(`clearBypassCache failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('clearBypassCache: no servers available');
}

/**
 * Mirror a single request to one bypass base URL. For use with timeout or when you know the server.
 *
 * @param {string} baseUrl - Single base URL, e.g. http://localhost:8000
 * @param {string} method
 * @param {string} path
 * @param {object|string|null} [body]
 * @param {{ hostname?: string, cookies?: string, bypassCache?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<{ status: number, headers: Headers, data: any, cookies: string }>}
 */
async function mirrorRequestSingle(baseUrl, method, path, body = null, options = {}) {
  const hostname = options.hostname || ICHANCY_HOST;
  const pathNorm = path.startsWith('/') ? path.slice(1) : path;
  const b = baseUrl.replace(/\/$/, '');
  const url = `${b}/${pathNorm}`;
  const headers = {
    'x-hostname': hostname,
    'content-type': 'application/json',
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  if (options.cookies) headers['cookie'] = options.cookies;
  if (options.bypassCache) headers['x-bypass-cache'] = 'true';

  const init = {
    method: method.toUpperCase(),
    headers,
    signal: options.signal,
  };
  if (body != null && method.toUpperCase() !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const payload = { headers, body: body != null ? (typeof body === 'string' ? body : body) : undefined };
  console.log('[CloudflareBypass]', method.toUpperCase(), url, { payload });

  const res = await fetch(url, init);
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

  let nextCookies = options.cookies || '';
  if (typeof res.headers.getSetCookie === 'function') {
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length) {
      const newPart = parseSetCookieToCookieHeader(setCookies);
      nextCookies = nextCookies ? `${nextCookies}; ${newPart}` : newPart;
    }
  } else {
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const newPart = parseSetCookieToCookieHeader(Array.isArray(setCookie) ? setCookie : [setCookie]);
      nextCookies = nextCookies ? `${nextCookies}; ${newPart}` : newPart;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    data,
    cookies: nextCookies || options.cookies,
  };
}

/**
 * Mirror an HTTP request through Cloudflare bypass. Tries preferredBaseUrl first, then each BYPASS_API_URLS.
 *
 * @param {string} method - GET, POST, PUT, DELETE, etc.
 * @param {string} path - Path on the target host (no leading slash)
 * @param {object|string|null} [body]
 * @param {{ hostname?: string, cookies?: string, bypassCache?: boolean, preferredBaseUrl?: string }} [options]
 * @returns {Promise<{ status: number, headers: Headers, data: any, cookies: string }>}
 */
async function mirrorRequest(method, path, body = null, options = {}) {
  const hostname = options.hostname || ICHANCY_HOST;
  const pathNorm = path.startsWith('/') ? path.slice(1) : path;
  let bases = getBypassBaseUrls();
  if (options.preferredBaseUrl) {
    const preferred = options.preferredBaseUrl.replace(/\/$/, '');
    bases = [preferred].concat(bases.filter((b) => b.replace(/\/$/, '') !== preferred));
  }
  let lastError;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    try {
      return await mirrorRequestSingle(b, method, path, body, options);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('mirrorRequest: no servers available');
}

/**
 * Warm up a single bypass server. Non-fatal on error.
 *
 * @param {string} baseUrl
 * @param {string} [hostname]
 * @param {{ bypassCache?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
async function warmupBypassSingle(baseUrl, hostname = ICHANCY_HOST, options = {}) {
  try {
    await mirrorRequestSingle(baseUrl.replace(/\/$/, ''), 'GET', 'api/data', null, {
      hostname,
      bypassCache: !!options.bypassCache,
      signal: options.signal,
    });
  } catch (e) {
    // non-fatal
  }
}

/**
 * Warm up Cloudflare bypass for a hostname by hitting /api/data with x-hostname.
 *
 * @param {string} [hostname]
 * @param {{ bypassCache?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function warmupBypass(hostname = ICHANCY_HOST, options = {}) {
  try {
    await mirrorRequest('GET', 'api/data', null, {
      hostname,
      bypassCache: !!options.bypassCache,
    });
  } catch (e) {
    console.warn('Bypass warmup failed:', e);
  }
}

const DEFAULT_LOGIN_TIMEOUT_MS = 15000;

const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_BATCH_SIZE = 5;

/**
 * Probe one bypass URL: GET api/data with x-hostname (use cache). Resolves with baseUrl if 200, else rejects.
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function probeOneBypass(baseUrl, timeoutMs) {
  const b = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return mirrorRequestSingle(b, 'GET', 'api/data', null, {
    hostname: ICHANCY_HOST,
    bypassCache: false,
    signal: controller.signal,
  })
    .then((res) => {
      clearTimeout(timer);
      if (res.status >= 200 && res.status < 300) return b;
      throw new Error(`Probe ${res.status}`);
    })
    .catch((e) => {
      clearTimeout(timer);
      throw e;
    });
}

/**
 * Probe bypass servers in parallel batches. First URL to respond with 200 (cached) wins.
 * Uses BYPASS_BATCH_SIZE (default 5), BYPASS_PROBE_TIMEOUT_SEC (default 5), BYPASS_BATCH_ITERATIONS (optional, max batches).
 *
 * @param {{ batchSize?: number, probeTimeoutMs?: number, maxBatches?: number }} [options]
 * @returns {Promise<string|null>} Winning baseUrl or null if none responded in time.
 */
async function probeBypassServers(options = {}) {
  const urls = getBypassBaseUrls();
  if (urls.length === 0) return null;
  const batchSize = Math.max(1, options.batchSize ?? (parseInt(process.env.BYPASS_BATCH_SIZE, 10) || DEFAULT_BATCH_SIZE));
  const probeTimeoutMs = options.probeTimeoutMs ?? ((parseInt(process.env.BYPASS_PROBE_TIMEOUT_SEC, 10) || 5) * 1000);
  const parsedIterations = process.env.BYPASS_BATCH_ITERATIONS ? parseInt(process.env.BYPASS_BATCH_ITERATIONS, 10) : undefined;
  const maxBatches = options.maxBatches ?? (Number.isInteger(parsedIterations) && parsedIterations > 0 ? parsedIterations : undefined);
  const normalized = [...new Set(urls.map((u) => u.replace(/\/$/, '')))];
  let tried = 0;
  for (let i = 0; i < normalized.length; i += batchSize) {
    if (maxBatches !== undefined && maxBatches !== null && tried >= maxBatches) break;
    tried += 1;
    const chunk = normalized.slice(i, i + batchSize);
    const winner = await Promise.any(
      chunk.map((b) => probeOneBypass(b, probeTimeoutMs))
    ).catch(() => null);
    if (winner) return winner;
  }
  return null;
}

/**
 * Login to a single bypass server (use when we know it has cache). No cache clear, use cache.
 *
 * @param {string} baseUrl - Single base URL that won probe
 * @param {string} username
 * @param {string} password
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ success: boolean, cookies: string, data: any, status: number, baseUrl: string }>}
 */
async function loginToSingleServer(baseUrl, username, password, options = {}) {
  const b = baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await warmupBypassSingle(b, ICHANCY_HOST, { bypassCache: false, signal: controller.signal });
    const result = await mirrorRequestSingle(b, 'POST', PATH_SIGN_IN, { username, password }, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const success = result.status >= 200 && result.status < 300;
    return {
      success,
      cookies: result.cookies || '',
      data: result.data,
      status: result.status,
      baseUrl: b,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      success: false,
      cookies: '',
      data: null,
      status: 0,
      baseUrl: b,
    };
  }
}

/**
 * Login with fresh bypass (force x-bypass-cache: true). Use when probe found no cached server.
 * Tries each BYPASS_API_URL in order with timeout per server.
 *
 * @param {string} username
 * @param {string} password
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ success: boolean, cookies: string, data: any, status: number, baseUrl?: string }>}
 */
async function loginWithFreshBypass(username, password, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const bases = getBypassBaseUrls();
  let lastResult = null;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await warmupBypassSingle(b, ICHANCY_HOST, { bypassCache: true, signal: controller.signal });
      const result = await mirrorRequestSingle(b, 'POST', PATH_SIGN_IN, { username, password }, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastResult = result;
      if (result.status >= 200 && result.status < 300) {
        return {
          success: true,
          cookies: result.cookies || '',
          data: result.data,
          status: result.status,
          baseUrl: b,
        };
      }
    } catch (e) {
      clearTimeout(timer);
      lastResult = null;
    }
  }
  return {
    success: false,
    cookies: '',
    data: lastResult ? lastResult.data : null,
    status: lastResult ? lastResult.status : 0,
  };
}

/**
 * Login with a timeout per server. Tries each BYPASS_API_URLS in order; if login does not succeed
 * within timeoutMs (default 15s) on one server, tries the next. Returns baseUrl so caller can use
 * the same server for registerPlayer.
 *
 * @param {string} username
 * @param {string} password
 * @param {{ timeoutMs?: number, clearCacheFirst?: boolean }} [options]
 * @returns {Promise<{ success: boolean, cookies: string, data: any, status: number, baseUrl?: string }>}
 */
async function loginWithTimeout(username, password, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  if (options.clearCacheFirst) {
    await clearBypassCache().catch(() => {});
  }
  const bases = getBypassBaseUrls();
  let lastResult = null;
  for (const base of bases) {
    const b = base.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await warmupBypassSingle(b, ICHANCY_HOST, { bypassCache: false, signal: controller.signal });
      const result = await mirrorRequestSingle(b, 'POST', PATH_SIGN_IN, { username, password }, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastResult = result;
      if (result.status >= 200 && result.status < 300) {
        return {
          success: true,
          cookies: result.cookies || '',
          data: result.data,
          status: result.status,
          baseUrl: b,
        };
      }
    } catch (e) {
      clearTimeout(timer);
      lastResult = null;
    }
  }
  return {
    success: false,
    cookies: '',
    data: lastResult ? lastResult.data : null,
    status: lastResult ? lastResult.status : 0,
  };
}

/**
 * Login to agents.ichancy.com (curl agents) via bypass. Returns session cookies for subsequent API calls.
 * Includes warmup + retry logic to be more robust.
 *
 * @param {string} username - Agent username (e.g. Karak.dk@agt.nsp)
 * @param {string} password - Agent password
 * @param {{ clearCacheFirst?: boolean, retries?: number }} [options]
 * @returns {Promise<{ success: boolean, cookies: string, data: any, status: number }>}
 */
async function login(username, password, options = {}) {
  const retries = options.retries ?? 2;

  if (options.clearCacheFirst) {
    await clearBypassCache().catch(() => {});
  }

  await warmupBypass(ICHANCY_HOST, { bypassCache: false });

  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await mirrorRequest('POST', PATH_SIGN_IN, { username, password });
    lastResult = result;
    const success = result.status >= 200 && result.status < 300;
    if (success) {
      return {
        success: true,
        cookies: result.cookies || '',
        data: result.data,
        status: result.status,
      };
    }

    // On 5xx from bypass/target, try to clear cache + warmup + retry
    if (result.status >= 500 && attempt < retries) {
      await clearBypassCache().catch(() => {});
      await warmupBypass(ICHANCY_HOST, { bypassCache: false });
      continue;
    }

    break;
  }

  return {
    success: false,
    cookies: '',
    data: lastResult ? lastResult.data : null,
    status: lastResult ? lastResult.status : 0,
  };
}

/**
 * Register a new player on agents.ichancy.com. Must be called after login(); use the cookies from login.
 * Pass preferredBaseUrl (from loginWithTimeout) to use the same bypass server for speed.
 *
 * @param {{ email: string, password: string, login: string }} player
 * @param {string} cookies - Cookie header string from login()
 * @param {string} parentId
 * @param {{ preferredBaseUrl?: string }} [options]
 * @returns {Promise<{ success: boolean, data: any, status: number }>}
 */
async function registerPlayer(player, cookies, parentId, options = {}) {
  if (!cookies) throw new Error('registerPlayer requires cookies from login()');
  const body = {
    player: {
      email: player.email,
      password: player.password,
      parentId: String(parentId),
      login: player.login,
    },
  };
  const result = await mirrorRequest('POST', PATH_REGISTER_PLAYER, body, {
    cookies,
    preferredBaseUrl: options.preferredBaseUrl,
  });
  const success = result.status >= 200 && result.status < 300;
  return {
    success,
    data: result.data,
    status: result.status,
  };
}

/**
 * One-shot: login with agent credentials, then register a player. Uses env ICHANCY_AGENT_USERNAME,
 * ICHANCY_AGENT_PASSWORD, ICHANCY_PARENT_ID if not passed.
 *
 * @param {{ email: string, password: string, login: string }} player
 * @param {{ username?: string, password?: string, parentId?: string }} [agent] - Override env
 * @returns {Promise<{ loginOk: boolean, registerOk: boolean, cookies?: string, loginData?: any, registerData?: any }>}
 */
async function loginAndRegisterPlayer(player, agent = {}) {
  const username = agent.username || process.env.ICHANCY_AGENT_USERNAME;
  const password = agent.password || process.env.ICHANCY_AGENT_PASSWORD;
  const parentId = agent.parentId || process.env.ICHANCY_PARENT_ID;

  if (!username || !password) throw new Error('Agent credentials required: ICHANCY_AGENT_USERNAME, ICHANCY_AGENT_PASSWORD');
  if (!parentId) throw new Error('Parent ID required: ICHANCY_PARENT_ID or agent.parentId');

  const loginResult = await login(username, password);
  if (!loginResult.success) {
    return { loginOk: false, registerOk: false, loginData: loginResult.data, status: loginResult.status };
  }

  const registerResult = await registerPlayer(player, loginResult.cookies, parentId);
  return {
    loginOk: true,
    registerOk: registerResult.success,
    cookies: loginResult.cookies,
    loginData: loginResult.data,
    registerData: registerResult.data,
    status: registerResult.status,
  };
}

module.exports = {
  getBypassBaseUrls,
  getBypassCookies,
  pingBypassCookiesAgentsIchancy,
  pingBypassCookiesAgentsIchancyOncePerServer,
  mirrorRequest,
  mirrorRequestSingle,
  clearBypassCache,
  warmupBypass,
  warmupBypassSingle,
  probeBypassServers,
  loginToSingleServer,
  loginWithFreshBypass,
  login,
  loginWithTimeout,
  registerPlayer,
  loginAndRegisterPlayer,
  ICHANCY_HOST,
  PATH_SIGN_IN,
  PATH_REGISTER_PLAYER,
  DEFAULT_LOGIN_TIMEOUT_MS,
};
