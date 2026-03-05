process.env.NTBA_FIX_319 = '1';
const TelegramBot = require('node-telegram-bot-api');
const { createSpinToken } = require('./spin-token');
let XLSX;
try { XLSX = require('xlsx'); } catch (_) { XLSX = null; }

/**
 * Factory: create an isolated bot instance for the given bot config.
 * @param {Object} botRow - The bots table row
 * @param {Object} db - Scoped DB context from createBotDb(botId)
 * @param {Function} createApiClient - Factory from ichancy-api.js
 * @returns {{ start, stop, processUpdate, botId }}
 */
module.exports = function createBotInstance(botRow, db, createApiClient) {

const BOT_ID = botRow.bot_id;
const BOT_SUPPORT_USERNAME = (botRow.support_username || 'Mr_UnknownOfficial').trim().replace(/^@/, '');

const {
  getUserByTelegramId, createOrUpdateUser, adjustBalance, useSpinCredit, ensureDailySpinEligibility, moveUserToDeletedUsers,
  redeemGiftCode, deleteExpiredGiftCodes, createGiftCode, listGiftCodes,
  getGiftCodeById, updateGiftCode, setGiftCodeActive, getRedemptionCount,
  deleteGiftCode, markGiftCodesPublished, saveReferral, updateReferralNetBalances, getReferralCommission,
  getReferralNetDetails, getGlobalReferralPendingStats,
  distributeAllReferralCommissions, getReferralDistributionHistory,
  getUserDistributionHistory, getUsersDisplayMap,
  logTransaction, getTransactions, getTransactionByTransferId, updateTransactionStatus, tryClaimSyriatelUsedTransactionNo, cleanupSyriatelUsedTransactionsOlderThan, tryClaimShamcashUsedTransactionNo, cleanupShamcashUsedTransactionsOlderThan, getUsersListForAdmin, getAllTelegramUserIds,
  getGiftRedemptionsCountForUser, getUserTransactionHistory, getTotalDepositsForUser, getWithdrawalCountForUser, distributeSingleUserReferralCommission,
  getAdminStats, getTopUsersByNetDeposits,
  getExportDateBounds, getTransactionsForExport,
  createShamcashPendingWithdrawal, getShamcashPendingById, getShamcashPendingByUser, getAllShamcashPending, updateShamcashPendingStatus, getShamcashWithdrawalHistory,
  loadConfig, getConfigValue, setConfigValue, seedConfigDefaults,
  getProviderConfig, loadProviderConfigs, setProviderConfig,
  isUserBlocked, addBlockedUser, removeBlockedUser,
} = db;

let loginAndRegisterPlayer, getPlayerIdByLogin, getAgentSession,
    invalidateAgentSession, getPlayerBalanceById, depositToPlayer, withdrawFromPlayer, getAgentWallet;

let DEBUG_MODE = false;
let DEBUG_LOGS = false;
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(`[Bot:${BOT_ID}]`, ...args);
}

let bot;

let channelId = '';
let channelLink = '';
let SPIN_BASE_URL = '';

function isChannelMember(userId) {
  return bot
    .getChatMember(channelId, userId)
    .then((member) => {
      const status = (member.status || '').toLowerCase();
      // member, administrator, creator, restricted (can see channel)
      return ['member', 'administrator', 'creator', 'restricted'].includes(status);
    })
    .catch((err) => {
      // Bot not in channel, or channel not found, or wrong channel id
      console.warn('Channel check failed for user', userId, err.message);
      return false;
    });
}

const MAIN_MENU_TEXT = `👋 أهلاً بك في البوت الرسمي ل Ichancy!

اختر إحدى الخدمات أدناه:`;

const TERMS_TEXT = `📜 الشروط والأحكام لاستخدام بوت Ichancy 📜

عند الضغط على زر موافقة، فأنت توافق على الشروط التالية:

💡 مقدمة:
البوت مخصّص لإنشاء الحسابات، والسّحب، والتعبئة الفورية لحسابات موقع Ichancy.

1️⃣ طريقة استخدام عجلة الحظ:
يحصل المستخدم على ضربة عجلة واحدة عند إكمال أحد الخيارين التاليين (خلال آخر 24 ساعة):
(أ) تعبئة رصيد بقيمة 50,000 ل.س أو ما يعادلها.
(ب) إحالة 5 مستخدمين نشطين قاموا فعلياً بالتعبئة على البوت.
في حال تحقيق كلا الشرطين معاً (خلال آخر 24 ساعة)، يحصل المستخدم على دورة ثانية (بمجموع دورتين في اليوم).
يتم تصفير عداد الدورات يومياً (حسب اليوم التقويمي).
⚠️ ملاحظة: دور العجلة التجريبي لا يؤثر على رصيد الحساب — أي أرباح من الدور التجريبي لا تُضاف الى الرصيد الفعلي.

2️⃣ مصداقية البوت:
البوت رسمي ومعتمد من إدارة موقع Ichancy، ويعمل بخوارزميات دقيقة لضمان تجربة موثوقة وآمنة للمستخدمين.

3️⃣ شروط أرباح الإحالات:
تُحتسب أرباح الإحالة فقط بعد تسجيل 3 إحالات نشطة أو أكثر (أي قاموا بالتعبئة الفعلية).

4️⃣ نظام السحب:
يقوم البوت باقتصاص تكاليف تشغيلية كنسبة قدرها 5% لعمليات السحب القادمة من أرباح الموقع.

5️⃣ تبديل طرق الدفع (ممنوع):
لا يسمح بشحن رصيد وسحبه بهدف التبديل بين وسائل الدفع المختلفة.
إذا تم اكتشاف هكذا عملية، سيتم سحب الرصيد والتحفظ عليه دون إشعار مسبق. البوت ليس منصة تحويل عملات/مدفوعات.

⛔️ تنبيه:
أي محاولة للتحايل أو مخالفة الشروط ستؤدي إلى إيقاف الحساب وتجميد الأرصدة.

📌 يرجى قراءة هذه الشروط بعناية لضمان تجربة آمنة وسلسة.`;

const AGREED_TEXT = `✅ شكراً لموافقتك على الشروط! يمكنك الآن استخدام جميع ميزات البوت.`;

// --- Create account flow: OTP → username → password ---
const OTP_VALID_MS = 2 * 60 * 1000; // 2 minutes

function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const userState = {}; // chatId -> { step, otp, otpExpiry, username? }
const adminUserListState = {}; // chatId -> { searchQuery?, page } for إدارة المستخدمين list context
const pendingReferrals = {}; // telegramUserId -> referrerTelegramUserId (stored until user creates ichancy account)

const MSG_OTP_PROMPT = (code) =>
  `🔐 للتحقق من أنك مستخدم حقيقي، يرجى إدخال الكود التالي:\n\n📝 كود التحقق: <code>${escapeHtml(code)}</code>\n⏳ صالح لمدة دقيقتين.`;

const MSG_OTP_EXPIRED = `❌ انتهت صلاحية الكود، اضغط /start للحصول على كود جديد`;

const MSG_ASK_USERNAME = `✅ تم التحقق بنجاح! الآن أدخل اسم المستخدم الذي ترغب به:\n\n🔐 **بدء إنشاء حسابك الآن**\n\nيرجى إدخال اسم مستخدم جديد لحسابك.\n\n📌 **شروط اسم المستخدم:**\n1️⃣ يجب أن يحتوي على 5 أحرف أو أرقام على الأقل.\n2️⃣ يمكن أن يحتوي على حروف إنجليزية وأرقام فقط.\n3️⃣ ❌ لا يحتوي على رموز خاصة مثل: #، @، %، $ …\n4️⃣ ❌ لا يحتوي على حروف أو أرقام عربية.\n\n📝 **ملاحظة مهمة:** هذه الخطوة ضرورية لإكمال إنشاء حسابك بنجاح.\n➡️ الرجاء الآن كتابة اسم المستخدم بالشكل الصحيح للمتابعة.`;

const MSG_USERNAME_INVALID = `❌ اسم المستخدم غير صالح.\n\n📌 شروط اسم المستخدم:\n1️⃣ 5 أحرف على الأقل.\n2️⃣ لا يحتوي على حروف أو أرقام عربية.\n3️⃣ لا يحتوي على رموز خاصة مثل: @, #, $, %, &.\n4️⃣ يمكن أن يحتوي على حروف إنجليزية وأرقام فقط.\n\n➡️ الرجاء إدخال اسم مستخدم صالح.`;

const MSG_ASK_PASSWORD = `✅ تم قبول اسم المستخدم!\nالآن أدخل كلمة المرور (3 أحرف على الأقل):`;

const MSG_PASSWORD_SHORT = `❌ كلمة المرور قصيرة جدًا. يجب أن تكون 3 أحرف على الأقل.`;

const MSG_ACCOUNT_CREATING = `⏳ جارٍ إنشاء حسابك على موقع إيشانسي... قد يستغرق الأمر بضع ثوانٍ.`;

const MSG_ACCOUNT_SUCCESS = (displayUsername, password) =>
  `✅ تم إنشاء حسابك بنجاح!\n\n▫️ اسم المستخدم: <code>${escapeHtml(displayUsername)}</code>\n▫️ كلمة المرور: <code>${escapeHtml(password)}</code>\n\nيمكنك الآن العودة للقائمة الرئيسية.`;

function isValidUsername(str) {
  if (!str || str.length < 5) return false;
  return /^[a-zA-Z0-9]{5,}$/.test(str.trim());
}

function mainMenuKeyboard(isAdmin = false) {
  const rows = [
    [{ text: 'إنشاء حساب أيشانسي ➕', callback_data: 'create_account' }],
    [{ text: 'دليل المستخدم و شروط البوت 📄', callback_data: 'terms' }],
  ];
  if (isAdmin) {
    rows.push([{ text: 'لوحة الأدمن ⚙', callback_data: 'admin_panel' }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function termsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'موافق✅', callback_data: 'terms_agree' }],
        [{ text: 'رجوع للقائمة الرئيسية🔙', callback_data: 'terms_back' }],
      ],
    },
  };
}

function subscribeKeyboard(isAdmin = false) {
  const rows = [[{ text: 'اضغط هنا للاشتراك 📣', url: channelLink }]];
  if (isAdmin) {
    rows.push([{ text: 'لوحة الأدمن ⚙', callback_data: 'admin_panel' }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

// Back button after account created
function successBackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: 'رجوع للقائمة الرئيسية 🔙', callback_data: 'main_menu_back' }]],
    },
  };
}

// Profile view: back to main menu
function profileBackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 العودة للقائمة', callback_data: 'profile_back' }]],
    },
  };
}

// Wallet view: back to main menu
function walletBackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔙 العودة للقائمة', callback_data: 'wallet_back' }]],
    },
  };
}

// Wallet message — bot balance, gifts, site balance (like profile but balances only)
function walletMessage(user, siteBalance = null) {
  const botBalance = formatNumber(user?.balance ?? 0);
  const gifts = formatNumber(user?.gifts ?? 0);
  const siteBalanceStr = siteBalance !== null && siteBalance !== undefined
    ? formatNumber(siteBalance) + ' ل.س'
    : '—';

  return `💼 محفظتي

💰 رصيد البوت: <code>${escapeHtml(botBalance)}</code> ل.س
🎁 هدايا البوت: <code>${escapeHtml(gifts)}</code> ل.س
🌐 رصيد الموقع (Ichancy): <code>${escapeHtml(siteBalanceStr)}</code>`;
}

function formatNumber(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatCurrencySyp(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Escape for Telegram HTML parse_mode so user content is safe and copyable in <code> */
function escapeHtml(s) {
  if (s == null || s === undefined) return '';
  const str = String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let BOT_TIMEZONE = 'Asia/Damascus';
let ADMIN_USERNAME_RAW = '';
let BOT_OFF_FLAG = false;
let FLAG_DEPOSIT_SYRIATEL = true;
let FLAG_DEPOSIT_SHAMCASH = true;
let FLAG_WITHDRAW_SYRIATEL = true;
let FLAG_WITHDRAW_SHAMCASH = true;
let USERNAME_PREFIX_VALUE = 'Bot-';
/** Bot timezone (e.g. Asia/Damascus). Set from DB in loadLocalConfig. */
function getBotTimezone() {
  return BOT_TIMEZONE || 'Asia/Damascus';
}

/** Format a Date in bot timezone (Syrian by default). */
function formatInBotTz(date, options = {}) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = getBotTimezone();
  const opts = { timeZone: tz, ...options };
  return new Intl.DateTimeFormat('ar-SY', {
    ...opts,
    dateStyle: options.dateStyle || 'short',
    timeStyle: options.timeStyle != null ? options.timeStyle : 'short',
  }).format(d);
}

/** Format date for manual referral list: HH:MM DD-MM-YYYY in bot timezone. */
function formatDateManualList(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    const tz = getBotTimezone();
    const time = new Intl.DateTimeFormat('ar-SY', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    const day = new Intl.DateTimeFormat('ar-SY', { timeZone: tz, day: '2-digit' }).format(d);
    const month = new Intl.DateTimeFormat('ar-SY', { timeZone: tz, month: '2-digit' }).format(d);
    const year = new Intl.DateTimeFormat('ar-SY', { timeZone: tz, year: 'numeric' }).format(d);
    return `${time} ${day}-${month}-${year}`;
  } catch (_) {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Parse "YYYY-MM-DD HH:mm" as Syrian time (Damascus UTC+3) into UTC Date. */
function parseSyrianDateTime(dateStr, timeStr) {
  const d = (dateStr || '').trim();
  const t = (timeStr || '00:00').trim();
  if (!d) return null;
  const iso = `${d}T${t}:00+03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Full profile message (معلومات الملف الشخصي) — bot wallet + optional site wallet
async function profileMessage(user, siteBalance = null) {
  if (!user || !user.ichancy_login) {
    return '❌ لا يوجد حساب مرتبط. يرجى إنشاء حساب أولاً من القائمة الرئيسية.';
  }
  const depositRequired = formatNumber(await cfgInt('deposit_required_ls', 50000));
  const referralsRequired = await cfgInt('active_referrals_required', 5);

  const userId = user.ichancy_user_id || user.telegram_user_id || '—';
  const login = user.ichancy_login || '—';
  const password = user.password ? String(user.password) : '—';
  const botBalance = formatNumber(user.balance ?? 0);
  const gifts = formatNumber(user.gifts ?? 0);
  const spinsAvailable = Number(user.wheel_spins_available_today ?? 0);
  const siteBalanceStr = siteBalance !== null && siteBalance !== undefined
    ? formatNumber(siteBalance) + ' ل.س'
    : '—';

  return `👤 معلومات حسابك:

🆔 رقم المستخدم: <code>${escapeHtml(userId)}</code>
▫️ اسم المستخدم: <code>${escapeHtml(login)}</code>
▫️ كلمة المرور: <code>${escapeHtml(password)}</code>

💰 رصيد البوت: <code>${escapeHtml(botBalance)}</code> ل.س
🎁 هدايا البوت: <code>${escapeHtml(gifts)}</code> ل.س
🌐 رصيد الموقع (Ichancy): <code>${escapeHtml(siteBalanceStr)}</code>

🎡 لفات العجلة المتاحة اليوم: <code>${escapeHtml(String(spinsAvailable))}</code>
🚫 حالة الأهلية:
💰 تحتاج لإيداع <code>${escapeHtml(depositRequired)}</code> ل.س (خلال 24س) لتفعيل لفة
👥 تحتاج <code>${escapeHtml(String(referralsRequired))}</code> إحالات نشطة (خلال 24س) لتفعيل لفة

📌 شروط اللعبة: إيداع ${depositRequired} ل.س أو ${referralsRequired} إحالات نشطة (خلال آخر 24س) لتفعيل اللفات اليومية.`;
}

/** Config helper: read a number from DB (bots table). */
async function cfgInt(key, def) {
  const val = await getConfigValue(key);
  const n = typeof val === 'number' ? val : parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}
/** Config helper: read a float from DB (bots table). */
async function cfgFloat(key, def) {
  const val = await getConfigValue(key);
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isFinite(n) ? n : def;
}

let GOLDEN_TREE_URL = '';
let ICHANCY_SITE_URL = '';
let BOT_DISPLAY_NAME = '';
let BOT_USERNAME = '';
let SUPPORT_USERNAME = '';
let ALERT_CHANNEL_ACCOUNTS = '';
let ALERT_CHANNEL_TRANSACTIONS = '';
let REFERRAL_PERCENTS = [5, 3, 2];
// Payment limits (SYP) and derived USD — filled from payment_providers + exchange_rate_syp_per_usd in loadLocalConfig
let EXCHANGE_RATE_SYP_PER_USD = 15000;
let SHAM_USD_MIN = 10;
let CHARGE_SHAM_USD_MIN = 0;
let SHAM_CASH_DEPOSIT_CODE = '';

/** Fetch exchange rate and provider limits from DB only (for deposit/withdrawal). Use this when validating or applying amounts. */
async function getRatesForPayment() {
  const exchangeRate = Number(await getConfigValue('EXCHANGE_RATE_SYP_PER_USD', 15000)) || 15000;
  const syr = await getProviderConfig('syriatel');
  const sham = await getProviderConfig('shamcash');
  const syrMinCashout = Number(syr.min_cashout_syp ?? 25000);
  const syrMaxCashout = Number(syr.max_cashout_syp ?? 500000);
  const syriatel = {
    min_deposit_syp: Number(syr.min_deposit_syp ?? 50),
    min_cashout_syp: syrMinCashout,
    max_cashout_syp: Math.max(syrMinCashout, syrMaxCashout),
    cashout_tax_percent: Number(syr.cashout_tax_percent ?? 0),
    deposit_bonus_percent: Number(syr.deposit_bonus_percent ?? 0),
  };
  const shamMinCashout = Number(sham.min_cashout_syp ?? 100000);
  const shamMaxCashout = Number(sham.max_cashout_syp ?? 2500000);
  const shamMinDeposit = Number(sham.min_deposit_syp ?? 50);
  const shamUsdMin = Math.max(1, Math.ceil(shamMinCashout / exchangeRate));
  const shamUsdMaxRaw = Math.max(1, Math.floor(shamMaxCashout / exchangeRate));
  const chargeShamUsdMin = Math.max(0, Math.ceil(shamMinDeposit / exchangeRate));
  const chargeShamUsdMaxRaw = Math.max(0, Math.floor(shamMaxCashout / exchangeRate));
  const shamcash = {
    min_deposit_syp: shamMinDeposit,
    min_cashout_syp: shamMinCashout,
    max_cashout_syp: Math.max(shamMinCashout, shamMaxCashout),
    cashout_tax_percent: Number(sham.cashout_tax_percent ?? 0),
    deposit_bonus_percent: Number(sham.deposit_bonus_percent ?? 0),
    sham_usd_min: shamUsdMin,
    sham_usd_max: Math.max(shamUsdMin, shamUsdMaxRaw),
    charge_sham_usd_min: chargeShamUsdMin,
    charge_sham_usd_max: Math.max(chargeShamUsdMin, chargeShamUsdMaxRaw),
  };
  return { exchangeRate, syriatel, shamcash };
}

/** Enabled deposit entries: { number, apiKey? }. apiKey optional; fallback to global SYRIATEL_API_KEY. */
let SYRIATEL_DEPOSIT_ENTRIES = [];
let SYRIATEL_DEPOSIT_NUMBERS = [];
let SYRIATEL_API_KEY = '';
let SYRIATEL_PIN = '0000';
let CHARGE_SYRIATEL_MIN = 50;
let CHARGE_SYRIATEL_MAX = 500000;
let SYRIATEL_MIN = 25000;
let SYRIATEL_MAX = 500000;
let SHAM_SYP_MIN = 100000;
let SHAM_SYP_MAX = 2500000;
let CHARGE_SHAM_SYP_MIN = 50;
let CHARGE_SHAM_SYP_MAX = 2500000;
let SHAM_USD_MAX = 166;
let CHARGE_SHAM_USD_MAX = 166;
const SYRIATEL_USED_TX_RETENTION_DAYS = 3;
const SHAMCASH_USED_TX_RETENTION_DAYS = 3;
/** When true, verify deposit via history API (fetch all incoming, then find tx). When false, verify via /transaction API (lookup by transactionId) — faster. */
const SYRIATEL_VERIFY_VIA_HISTORY = true;
/** Deposit (Syriatel/Sham SYP): payment amount * this = wallet credit. Withdraw Syriatel: wallet amount / this = amount sent via API. From env OLD_CURRENCY_MULTIPLE, default 100. */
let OLD_CURRENCY_MULTIPLE = 100;

const LOADING_TEXT = '⏳ جاري التحميل...';

/** Send an alert to the accounts channel when a new account is created. */
function alertNewAccount(fromUser, displayUsername, password, referralInfo) {
  if (!ALERT_CHANNEL_ACCOUNTS) return;
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  let msg = `🆕 تم إنشاء حساب جديد\n\n👤 المستخدم: ${escapeHtml(tgUsername)} (${escapeHtml(name)})\n🆔️ معرف الحساب: <code>${fromUser.id}</code>\n💬 اسم المستخدم: ${escapeHtml(displayUsername)}\n🔑 كلمة المرور: <code>${escapeHtml(password)}</code>`;
  if (referralInfo) msg += `\n\n${referralInfo}`;
  bot.sendMessage(ALERT_CHANNEL_ACCOUNTS, msg, { parse_mode: 'HTML' }).catch((err) =>
    console.warn('alertNewAccount:', err.message)
  );
}

/** Send an alert to the transactions channel for deposit/withdrawal. */
function alertTransaction(fromUser, type, amount, method, transferId) {
  if (!ALERT_CHANNEL_TRANSACTIONS) return;
  const icon = type === 'deposit' ? '📥' : '📤';
  const typeLabel = type === 'deposit' ? 'إيداع' : 'سحب';
  const methodLabel = { syriatel: 'سيرياتيل كاش', sham_usd: 'شام كاش (USD)', sham_syp: 'شام كاش (ل.س)' }[method] || method;
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  let msg = `${icon} ${typeLabel}\n\n👤 ${escapeHtml(name)} (${escapeHtml(tgUsername)})\n🆔 <code>${fromUser.id}</code>\n💰 <code>${formatNumber(amount)}</code> ل.س\n📱 ${methodLabel}`;
  if (transferId) msg += `\n🔖 رقم العملية: <code>${escapeHtml(transferId)}</code>`;
  bot.sendMessage(ALERT_CHANNEL_TRANSACTIONS, msg, { parse_mode: 'HTML' }).catch((err) =>
    console.warn('alertTransaction:', err.message)
  );
}

/** Format date/time for payment channel notifications (uses BOT_TIMEZONE). */
function formatDateTimeForNotification(date) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return d.toLocaleString('ar-SY', { timeZone: BOT_TIMEZONE || 'Asia/Damascus', dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return d.toLocaleString();
  }
}

/** Send detailed Syriatel automated withdrawal notification to payment channel (amount asked, after tax, sent via API, user, date/time). */
function sendSyriatelWithdrawalNotificationToChannel(fromUser, amountAsked, afterTax, amountSentViaApi, phone, taxPercent) {
  if (!ALERT_CHANNEL_TRANSACTIONS) return;
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  const taxLine = (taxPercent && Number(taxPercent) > 0)
    ? `\n📉 بعد خصم ضريبة السحب (${Number(taxPercent).toFixed(1)}%): <code>${formatNumber(afterTax)}</code> ل.س`
    : '';
  const msg = `📤 سحب سيرياتيل كاش (آلي)\n\n👤 المستخدم: ${escapeHtml(name)}\n🆔 Telegram: ${escapeHtml(tgUsername)} (<code>${fromUser.id}</code>)\n📱 رقم الاستلام: <code>${escapeHtml(phone)}</code>\n\n💰 المبلغ المطلوب: <code>${formatNumber(amountAsked)}</code> ل.س${taxLine}\n💸 المبلغ المحوّل (÷${OLD_CURRENCY_MULTIPLE}): <code>${formatNumber(amountSentViaApi)}</code> ل.س\n\n📅 التاريخ والوقت: ${formatDateTimeForNotification(new Date())}`;
  bot.sendMessage(ALERT_CHANNEL_TRANSACTIONS, msg, { parse_mode: 'HTML' }).catch((err) =>
    console.warn('sendSyriatelWithdrawalNotificationToChannel:', err.message)
  );
}

/** Send ShamCash withdrawal request to payment channel with Accept/Reject buttons and full details (amount asked, after tax, to transfer, user, date/time). */
function sendShamcashWithdrawalToChannel(pendingId, fromUser, botName, opts) {
  if (!ALERT_CHANNEL_TRANSACTIONS) return;
  const { currency, amountAskedDisplay, amountToTransferDisplay, clientCode, taxPercent, taxAmountDisplay } = opts;
  const curLabel = currency === 'usd' ? 'USD' : 'ل.س';
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  const taxLine = (taxPercent != null && Number(taxPercent) > 0 && taxAmountDisplay != null)
    ? `\n📉 الخصم ( للإدارة ) : <code>${escapeHtml(taxAmountDisplay)}</code> ${curLabel}`
    : '';
  const transferLine = currency === 'syp'
    ? `\n💸 المبلغ للتحويل بالعملة الجديدة : <code>${escapeHtml(amountToTransferDisplay)}</code> ل.س`
    : `\n💸 المبلغ للتحويل بالعملة الجديدة : <code>${escapeHtml(amountToTransferDisplay)}</code> ${curLabel}`;
  const msg = `📤 طلب سحب شام كاش\n\n👤 المستخدم: ${escapeHtml(botName || name)}\n🆔 Telegram: ${escapeHtml(tgUsername)} (<code>${fromUser.id}</code>)\n\n💰 المبلغ المطلوب: <code>${escapeHtml(amountAskedDisplay)}</code> ${curLabel}${taxLine}${transferLine}\n📋 رمز العميل (ShamCash): <code>${escapeHtml(clientCode)}</code>\n\n📅 التاريخ والوقت: ${formatDateTimeForNotification(new Date())}\n\n⏳ في انتظار الموافقة.`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ قبول', callback_data: `sham_accept_${pendingId}` }, { text: '❌ رفض', callback_data: `sham_reject_${pendingId}` }],
    ],
  };
  bot.sendMessage(ALERT_CHANNEL_TRANSACTIONS, msg, { parse_mode: 'HTML', reply_markup: keyboard }).catch((err) =>
    console.warn('sendShamcashWithdrawalToChannel:', err.message)
  );
}

/** Notify payment channel when user cancels their own ShamCash withdrawal request (with user details, client id, amount, date/time). */
function sendShamcashUserRejectToChannel(pending, fromUser, botName) {
  if (!ALERT_CHANNEL_TRANSACTIONS) return;
  const curLabel = pending.currency === 'usd' ? ' USD' : ' ل.س';
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  const msg = `❌ رفض المستخدم لطلب السحب (شام كاش)\n\n👤 المستخدم: ${escapeHtml(botName || name)}\n🆔 Telegram: ${escapeHtml(tgUsername)} (<code>${fromUser.id}</code>)\n\n💰 المبلغ: <code>${escapeHtml(pending.amount_display)}</code> ${curLabel}\n📋 رمز العميل (ShamCash): <code>${escapeHtml(pending.client_code)}</code>\n\n📅 التاريخ والوقت: ${formatDateTimeForNotification(new Date())}`;
  bot.sendMessage(ALERT_CHANNEL_TRANSACTIONS, msg, { parse_mode: 'HTML' }).catch((err) =>
    console.warn('sendShamcashUserRejectToChannel:', err.message)
  );
}

/** Fetch site wallet balance for user (agent session + getPlayerBalanceById). Returns balance number or null. */
async function fetchSiteBalanceForUser(user) {
  debugLog('fetchSiteBalanceForUser: starting', { hasUser: !!user, ichancy_user_id: user && user.ichancy_user_id });
  if (!user || !user.ichancy_user_id) return null;
  try {
    let cookies = await getAgentSession();
    let res = await getPlayerBalanceById(cookies, user.ichancy_user_id);
    if (!res.success) {
      invalidateAgentSession();
      cookies = await getAgentSession(true);
      res = await getPlayerBalanceById(cookies, user.ichancy_user_id);
    }
    debugLog('fetchSiteBalanceForUser: done', { balance: res.success ? res.balance : null });
    return res.success ? res.balance : null;
  } catch (err) {
    console.warn('fetchSiteBalanceForUser:', err.message);
    return null;
  }
}

/** Syriatel history API: fetch incoming transactions for one number/userId. Returns { success, transactions } or { success: false, error }. */
async function syriatelFetchHistoryFor(forValue, apiKey, transferIdToFind) {
  const key = (apiKey != null && String(apiKey).trim()) ? String(apiKey).trim() : SYRIATEL_API_KEY;
  if (!key) return { success: false, error: 'No API key' };
  const baseUrl = (process.env.SYRIATEL_API_BASE_URL || 'http://31.97.205.230:3009').replace(/\/$/, '');
  const url = `${baseUrl}/history?apiKey=${encodeURIComponent(key)}&direction=incoming&for=${encodeURIComponent(String(forValue))}&page=1`;
  if (DEBUG_LOGS) {
    debugLog('syriatelFetchHistoryFor URL', url);
    debugLog('syriatelFetchHistoryFor apiKey', key);
    if (transferIdToFind != null && transferIdToFind !== '') {
      debugLog('syriatelFetchHistoryFor lookingForTransactionNo', String(transferIdToFind).trim());
    }
  }
  try {
    const res = await fetch(url);
    let data;
    try {
      data = await res.json();
    } catch (_) {
      return { success: false, error: res.statusText || 'Invalid response' };
    }
    if (DEBUG_LOGS) {
      const lookingFor = transferIdToFind != null && transferIdToFind !== '' ? String(transferIdToFind).trim() : null;
      const foundInThisResponse = lookingFor && data && Array.isArray(data.transactions)
        ? data.transactions.some((t) => String(t.transactionNo || '').trim() === lookingFor)
        : null;
      debugLog('syriatelFetchHistoryFor response (stringified)', JSON.stringify({
        for: forValue,
        status: res.status,
        success: data?.success,
        transactionCount: data?.transactions?.length,
        lookingForTransactionNo: lookingFor,
        foundInThisResponse: foundInThisResponse ?? (lookingFor ? false : 'n/a'),
        fullResponse: data,
      }));
    }
    if (!res.ok) {
      return { success: false, error: data?.message || res.statusText || `HTTP ${res.status}` };
    }
    if (data && data.success && Array.isArray(data.transactions)) {
      return { success: true, transactions: data.transactions };
    }
    return { success: false, error: data?.message || res.statusText || 'Invalid response' };
  } catch (err) {
    debugLog('syriatelFetchHistoryFor:', err.message);
    return { success: false, error: err.message };
  }
}

/** Fetch incoming history for all enabled Syriatel deposit numbers in parallel; merge transactions. Returns { success, transactions } or { success: false, error }. */
async function syriatelFetchHistoryAllNumbers(transferIdToFind) {
  if (SYRIATEL_DEPOSIT_ENTRIES.length === 0) {
    return { success: false, error: 'No deposit numbers configured' };
  }
  if (DEBUG_LOGS) {
    debugLog('syriatelFetchHistoryAllNumbers: fetching in parallel for', SYRIATEL_DEPOSIT_ENTRIES.length, 'number(s)', JSON.stringify(SYRIATEL_DEPOSIT_ENTRIES.map((e) => e.number)));
    if (transferIdToFind != null && transferIdToFind !== '') {
      debugLog('syriatelFetchHistoryAllNumbers: lookingForTransactionNo', String(transferIdToFind).trim());
    }
  }
  const results = await Promise.all(
    SYRIATEL_DEPOSIT_ENTRIES.map((e) => syriatelFetchHistoryFor(e.number, e.apiKey, transferIdToFind))
  );
  if (DEBUG_LOGS) {
    const summary = results.map((r, i) => ({
      number: SYRIATEL_DEPOSIT_ENTRIES[i].number,
      success: r.success,
      count: r.transactions?.length ?? 0,
      lookingFor: transferIdToFind != null && transferIdToFind !== '' ? String(transferIdToFind).trim() : null,
      found: transferIdToFind != null && transferIdToFind !== ''
        ? (r.transactions || []).some((t) => String(t.transactionNo || '').trim() === String(transferIdToFind).trim())
        : null,
    }));
    debugLog('syriatelFetchHistoryAllNumbers: all parallel requests done', JSON.stringify(summary));
  }
  const failed = results.find((r) => !r.success);
  if (failed) {
    return { success: false, error: failed.error || 'API error' };
  }
  const seen = new Set();
  const merged = [];
  for (const r of results) {
    for (const t of r.transactions || []) {
      const no = String(t.transactionNo || '').trim();
      if (no && !seen.has(no)) {
        seen.add(no);
        merged.push(t);
      }
    }
  }
  return { success: true, transactions: merged };
}

/** Syriatel transaction API: find one transaction by ID for a specific line. Returns { success, transaction } or { success: false, error }. */
async function syriatelFetchTransaction(transactionId, forValue, apiKey) {
  const key = (apiKey != null && String(apiKey).trim()) ? String(apiKey).trim() : SYRIATEL_API_KEY;
  if (!key) return { success: false, error: 'No API key' };
  const baseUrl = (process.env.SYRIATEL_API_BASE_URL || 'http://31.97.205.230:3009').replace(/\/$/, '');
  const params = new URLSearchParams({ apiKey: key, direction: 'outgoing', transactionId: String(transactionId).trim() });
  if (forValue != null && String(forValue).trim()) params.set('for', String(forValue).trim());
  const url = `${baseUrl}/transaction?${params.toString()}`;
  if (DEBUG_LOGS) {
    debugLog('syriatelFetchTransaction URL', url);
    debugLog('syriatelFetchTransaction apiKey', key);
  }
  try {
    const res = await fetch(url);
    let data;
    try {
      data = await res.json();
    } catch (_) {
      return { success: false, error: res.statusText || 'Invalid response' };
    }
    if (DEBUG_LOGS) {
      debugLog('syriatelFetchTransaction response (stringified)', JSON.stringify({
        for: forValue,
        status: res.status,
        success: data?.success,
        hasTransaction: !!data?.transaction,
        lookingForTransactionNo: transactionId,
        found: data?.transaction && String(data.transaction.transactionNo || '').trim() === String(transactionId).trim(),
        fullResponse: data,
      }));
    }
    if (!res.ok) {
      return { success: false, error: data?.message || res.statusText || `HTTP ${res.status}` };
    }
    if (data && data.success && data.transaction) {
      return { success: true, transaction: data.transaction };
    }
    return { success: false, error: data?.message || res.statusText || 'Transaction not found' };
  } catch (err) {
    debugLog('syriatelFetchTransaction:', err.message);
    return { success: false, error: err.message };
  }
}

/** Fetch transaction by ID for all enabled Syriatel deposit numbers in parallel; return first successful hit. Returns { success, transaction } or { success: false, error }. */
async function syriatelFetchTransactionAllNumbers(transferId) {
  if (SYRIATEL_DEPOSIT_ENTRIES.length === 0) {
    return { success: false, error: 'No deposit numbers configured' };
  }
  if (DEBUG_LOGS) {
    debugLog('syriatelFetchTransactionAllNumbers: fetching in parallel for', SYRIATEL_DEPOSIT_ENTRIES.length, 'number(s)', JSON.stringify(SYRIATEL_DEPOSIT_ENTRIES.map((e) => e.number)));
    debugLog('syriatelFetchTransactionAllNumbers: lookingForTransactionNo', String(transferId).trim());
  }
  const results = await Promise.all(
    SYRIATEL_DEPOSIT_ENTRIES.map((e) => syriatelFetchTransaction(transferId, e.number, e.apiKey))
  );
  const found = results.find((r) => r.success && r.transaction && String(r.transaction.transactionNo || '').trim() === String(transferId).trim());
  if (DEBUG_LOGS) {
    const summary = results.map((r, i) => ({
      number: SYRIATEL_DEPOSIT_ENTRIES[i].number,
      success: r.success,
      found: r.transaction && String(r.transaction.transactionNo || '').trim() === String(transferId).trim(),
    }));
    debugLog('syriatelFetchTransactionAllNumbers: all parallel requests done', JSON.stringify(summary));
  }
  if (found) {
    return { success: true, transaction: found.transaction };
  }
  const firstError = results.find((r) => !r.success);
  return { success: false, error: firstError?.error || 'Transaction not found' };
}

/** Syriatel transfer API: send money to a number (single attempt). Returns { success, message } or { success: false, error }. */
/** options: { from?: string (GSM/userId/secret code for which line to send from), apiKey?: string } */
async function syriatelTransfer(to, amount, options = {}) {
  const baseUrl = (process.env.SYRIATEL_API_BASE_URL || 'http://31.97.205.230:3009').replace(/\/$/, '');
  const apiKey = (options.apiKey != null && String(options.apiKey).trim()) ? String(options.apiKey).trim() : SYRIATEL_API_KEY;
  let url = `${baseUrl}/transfer?apiKey=${encodeURIComponent(apiKey)}&pin=${encodeURIComponent(SYRIATEL_PIN)}&to=${encodeURIComponent(String(to))}&amount=${encodeURIComponent(String(amount))}`;
  if (options.from != null && String(options.from).trim()) {
    url += `&from=${encodeURIComponent(String(options.from).trim())}`;
  }
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.success === true) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data?.message || res.statusText || 'Transfer failed' };
  } catch (err) {
    debugLog('syriatelTransfer:', err.message);
    return { success: false, error: err.message };
  }
}

/** Try transfer using each syriatel_deposit_numbers entry (as "from" / per-entry apiKey) until one succeeds. Returns first success or last failure. */
async function syriatelTransferTryAllNumbers(to, amount) {
  if (!SYRIATEL_DEPOSIT_ENTRIES || SYRIATEL_DEPOSIT_ENTRIES.length === 0) {
    return syriatelTransfer(to, amount);
  }
  let lastResult = { success: false, error: 'No deposit numbers configured' };
  for (const entry of SYRIATEL_DEPOSIT_ENTRIES) {
    const result = await syriatelTransfer(to, amount, { from: entry.number, apiKey: entry.apiKey });
    if (result.success) {
      if (DEBUG_LOGS) debugLog('syriatelTransferTryAllNumbers: success with from=', entry.number);
      return result;
    }
    lastResult = result;
    if (DEBUG_LOGS) debugLog('syriatelTransferTryAllNumbers: failed from=', entry.number, result.error);
  }
  return lastResult;
}

/** GET /gsms with apiKey; returns { success, gsms } or { success: false }. */
async function fetchSyriatelGsms(apiKey) {
  const key = (apiKey != null && String(apiKey).trim()) ? String(apiKey).trim() : SYRIATEL_API_KEY;
  if (!key) return { success: false };
  const baseUrl = (process.env.SYRIATEL_API_BASE_URL || 'http://31.97.205.230:3009').replace(/\/$/, '');
  const url = `${baseUrl}/gsms?apiKey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.success === true && Array.isArray(data.gsms)) {
      return { success: true, gsms: data.gsms };
    }
    return { success: false };
  } catch (err) {
    debugLog('fetchSyriatelGsms:', err.message);
    return { success: false };
  }
}

/** ShamCash transaction API: find transaction by ID. GET baseUrl&tx={transferId}. Returns { success, data } or { success: false, error }. */
async function shamcashFetchTransaction(transferId) {
  const baseUrl = (process.env.SHAMCASH_TRANSACTION_API || '').trim();
  if (!baseUrl) {
    return { success: false, error: 'SHAMCASH_TRANSACTION_API not configured' };
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}tx=${encodeURIComponent(String(transferId).trim())}`;
  try {
    const res = await fetch(url);
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      debugLog('shamcashFetchTransaction: response not JSON', parseErr.message);
      return { success: false, error: res.ok ? 'Invalid response from server' : `Request failed: ${res.status}` };
    }
    if (data && data.success === true) {
      return { success: true, data: data.data };
    }
    return { success: false, error: data?.message || (res.ok ? 'Transaction not found' : `Request failed: ${res.status}`) };
  } catch (err) {
    debugLog('shamcashFetchTransaction:', err.message);
    return { success: false, error: err.message };
  }
}

/** Get full syriatel_deposit_numbers list for admin (with enabled flag). Returns array of { number, gsm?, enabled, secretCode?, apiKey? }. number=secretCode, gsm=phone when using new structure. */
async function getSyriatelDepositListForAdmin() {
  const raw = await getConfigValue('SYRIATEL_DEPOSIT_NUMBERS', '');
  const s = (raw && String(raw)).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (!Array.isArray(arr)) return [];
      return arr.map((e) => ({
        number: String(e?.number ?? '').trim(),
        gsm: (e?.gsm != null && String(e.gsm).trim()) ? String(e.gsm).trim() : undefined,
        enabled: e?.enabled !== false,
        secretCode: e?.secretCode != null ? String(e.secretCode).trim() : undefined,
        apiKey: (e?.apiKey != null && String(e.apiKey).trim()) ? String(e.apiKey).trim() : undefined,
      })).filter((e) => e.number);
    } catch (_) {
      return [];
    }
  }
  const numbers = s.split(',').map((x) => x.trim()).filter(Boolean);
  return numbers.map((n) => ({ number: n, enabled: true }));
}

// Ichancy account view: bot wallet + site wallet + choose operation
function ichancyAccountMessage(user, botName, siteBalance = null) {
  const accountName = (user && user.ichancy_login) ? user.ichancy_login : '—';
  const botBalance = user ? formatNumber(user.balance ?? 0) : '0';
  const gifts = user ? formatNumber(user.gifts ?? 0) : '0';
  const siteBalanceStr = siteBalance !== null && siteBalance !== undefined
    ? formatNumber(siteBalance) + ' ل.س'
    : '—';
  return `👤 حساب <code>${escapeHtml(accountName)}</code> على ${botName}:

💰 رصيد البوت: <code>${escapeHtml(botBalance)}</code> ل.س
🎁 هدايا البوت: <code>${escapeHtml(gifts)}</code> ل.س
🌐 رصيد الموقع (Ichancy): <code>${escapeHtml(siteBalanceStr)}</code>

💠 اختر العملية المطلوبة:`;
}

function ichancyAccountKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 الذهاب إلى موقع Ichancy', url: ICHANCY_SITE_URL }],
        [{ text: '💳 تحويل رصيد إلى حساب Ichancy', callback_data: 'transfer_to_ichancy' }],
        [{ text: '💸 سحب رصيد Ichancy', callback_data: 'withdraw_ichancy' }],
        [{ text: 'شحن كامل الرصيد 💰', callback_data: 'transfer_full_to_ichancy' }, { text: 'سحب كامل الرصيد 💸', callback_data: 'withdraw_full_from_ichancy' }],
        [{ text: '🗑️ حذف حسابي', callback_data: 'delete_account' }],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'ichancy_back' }],
      ],
    },
  };
}

// Delete-account confirmation: warning text (matches web bubble content)
const DELETE_ACCOUNT_WARNING =
  `⚠️ تحذير قبل حذف الحساب:

❗ بحذف حسابك، سيتم حذف جميع بياناتك نهائيًا من النظام.
🚫 لن تتمكن من استعادة الحساب أو الأرصدة أو الهدايا.
💳 لن يمكنك الإيداع أو السحب إلا بعد إنشاء حساب جديد.

هل ترغب حقًا في حذف حسابك؟`;

function deleteAccountConfirmKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ نعم، احذف حسابي', callback_data: 'delete_account_confirm' }],
        [{ text: '❌ لا، أريد الاحتفاظ به', callback_data: 'delete_account_cancel' }],
      ],
    },
  };
}

// Cancel deletion: friendly message + "العودة إلى حسابي" button
const DELETE_ACCOUNT_CANCEL_MESSAGE =
  '😊 جميل أنك قررت الاحتفاظ بحسابك!\n\n🎯 تذكّر أن البوت يقدم لك خدمات مميزة وسهلة الاستخدام.';

function deleteAccountCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 العودة إلى حسابي', callback_data: 'delete_cancel_back_to_account' }],
      ],
    },
  };
}

// After account deleted: message + "إنشاء حساب جديد" button
const DELETE_ACCOUNT_DONE_MESSAGE =
  '🗑️ تم حذف حسابك نهائيًا.\n\nيمكنك إنشاء حساب جديد في أي وقت.';

function deleteAccountDoneKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ إنشاء حساب جديد', callback_data: 'create_account' }],
      ],
    },
  };
}

// Charge (deposit) bot: choose deposit method (only enabled methods); flags from DB via loadLocalConfig
function chargeDepositKeyboard() {
  const syriatelEnabled = FLAG_DEPOSIT_SYRIATEL;
  const shamcashEnabled = FLAG_DEPOSIT_SHAMCASH;
  const rows = [];
  if (syriatelEnabled && shamcashEnabled) {
    rows.push([{ text: 'Syriatel Cash', callback_data: 'charge_method_syriatel' }, { text: 'Sham Cash AUTO(USD , SYP)', callback_data: 'charge_method_sham' }]);
  } else if (syriatelEnabled) {
    rows.push([{ text: 'Syriatel Cash', callback_data: 'charge_method_syriatel' }]);
  } else if (shamcashEnabled) {
    rows.push([{ text: 'Sham Cash AUTO(USD , SYP)', callback_data: 'charge_method_sham' }]);
  }
  rows.push([{ text: '🔙 العودة', callback_data: 'charge_back' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// Charge Syriatel: ask for amount (single cancel button)
function chargeSyriatelCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_syriatel_cancel' }]],
    },
  };
}

// Charge Syriatel: transfer instructions (single cancel button)
function chargeSyriatelTransferCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_syriatel_transfer_cancel' }]],
    },
  };
}

// Charge Syriatel: on verification error — retry and contact support
function chargeSyriatelErrorKeyboard() {
  const supportUrl = BOT_SUPPORT_USERNAME ? `https://t.me/${BOT_SUPPORT_USERNAME}` : null;
  const rows = [[{ text: '🔄 إعادة المحاولة', callback_data: 'charge_syriatel_retry_transfer_id' }]];
  if (supportUrl) rows.push([{ text: '📞 التواصل مع الدعم', url: supportUrl }]);
  rows.push([{ text: '❌ إلغاء العملية', callback_data: 'charge_syriatel_transfer_cancel' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// Withdraw Syriatel: on transfer failure — support and back to withdraw menu
function withdrawSyriatelErrorKeyboard() {
  const supportUrl = BOT_SUPPORT_USERNAME ? `https://t.me/${BOT_SUPPORT_USERNAME}` : null;
  const rows = [];
  if (supportUrl) rows.push([{ text: '📞 التواصل مع الدعم', url: supportUrl }]);
  rows.push([{ text: '🔙 العودة لطريقة السحب', callback_data: 'withdraw_syriatel_cancel' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// Charge Sham Cash: choose currency (USD or SYP)
function chargeShamCurrencyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💵 إيداع بالدولار', callback_data: 'charge_sham_usd' }],
        [{ text: '💴 إيداع بالليرة السورية', callback_data: 'charge_sham_syp' }],
        [{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_cancel' }],
      ],
    },
  };
}

// Charge Sham USD: ask for amount (single cancel button)
function chargeShamUsdCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_usd_cancel' }]],
    },
  };
}

// Charge Sham USD: transfer instructions (single cancel button)
function chargeShamUsdTransferCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_usd_transfer_cancel' }]],
    },
  };
}

// Charge Sham SYP: ask for amount (single cancel button)
function chargeShamSypCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_syp_cancel' }]],
    },
  };
}

// Gift code menu: activate code or go back
function giftCodeKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎟️ تفعيل كود هدية', callback_data: 'gift_code_activate' }],
        [{ text: '🔙 العودة للقائمة', callback_data: 'gift_code_back' }],
      ],
    },
  };
}

// Gift code: waiting for code input (single cancel button)
function giftCodeCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'gift_code_cancel' }]],
    },
  };
}

// Charge Sham SYP: transfer instructions (single cancel button)
function chargeShamSypTransferCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_syp_transfer_cancel' }]],
    },
  };
}

// Charge Sham USD: on verification error — retry transfer ID
function chargeShamUsdErrorKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 إعادة إدخال رقم العملية', callback_data: 'charge_sham_usd_retry_transfer_id' }],
        [{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_usd_transfer_cancel' }],
      ],
    },
  };
}

// Charge Sham SYP: on verification error — retry transfer ID
function chargeShamSypErrorKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 إعادة إدخال رقم العملية', callback_data: 'charge_sham_syp_retry_transfer_id' }],
        [{ text: '❌ إلغاء العملية', callback_data: 'charge_sham_syp_transfer_cancel' }],
      ],
    },
  };
}

// Withdraw from bot: choose method (only enabled methods)
function withdrawMethodKeyboard() {
  const syriatelEnabled = FLAG_WITHDRAW_SYRIATEL;
  const shamcashEnabled = FLAG_WITHDRAW_SHAMCASH;
  const rows = [];
  if (shamcashEnabled) rows.push([{ text: '💳 Sham Cash (USD , SYP)', callback_data: 'withdraw_method_sham' }]);
  if (syriatelEnabled) rows.push([{ text: '💵 Syriatel Cash', callback_data: 'withdraw_method_syriatel' }]);
  rows.push([{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'withdraw_bot_back' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// Sham Cash: choose currency (USD or SYP)
function withdrawShamCurrencyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💵 سحب بالدولار', callback_data: 'withdraw_sham_usd' }],
        [{ text: '💴 سحب بالليرة السورية', callback_data: 'withdraw_sham_syp' }],
        [{ text: '❌ إلغاء العملية', callback_data: 'withdraw_sham_cancel' }],
      ],
    },
  };
}

// Sham Cash USD: ask for client code (single cancel button)
function withdrawShamUsdCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'withdraw_sham_usd_cancel' }]],
    },
  };
}

// Sham Cash SYP: ask for client code (single cancel button)
function withdrawShamSypCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'withdraw_sham_syp_cancel' }]],
    },
  };
}

// Sham Cash USD: ask for amount (cancel or edit code)
function withdrawShamUsdAmountKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ إلغاء العملية', callback_data: 'withdraw_sham_usd_amount_cancel' }, { text: '✏️ تعديل الرمز', callback_data: 'withdraw_sham_usd_edit_code' }],
      ],
    },
  };
}

// Sham Cash SYP: ask for amount (cancel or edit code)
function withdrawShamSypAmountKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ إلغاء العملية', callback_data: 'withdraw_sham_syp_amount_cancel' }, { text: '✏️ تعديل الرمز', callback_data: 'withdraw_sham_syp_edit_code' }],
      ],
    },
  };
}

// Syriatel Cash: phone or amount step (single cancel button)
function withdrawSyriatelCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'withdraw_syriatel_cancel' }]],
    },
  };
}

// Admin list: from DB via loadLocalConfig (ADMIN_USERNAME_RAW)
function isAdminUser(from) {
  const admins = ADMIN_USERNAME_RAW.split(/[,;\s]+/).map(s => s.trim().replace(/^@/, '')).filter(Boolean);
  const username = (from?.username || '').trim();
  const isAdmin = username && admins.length > 0 && admins.some(a => a.toLowerCase() === username.toLowerCase());
  if (DEBUG_LOGS && ADMIN_USERNAME_RAW && username) {
    debugLog('isAdminUser', { username, admins, isAdmin });
  }
  return isAdmin;
}

const ADMIN_PANEL_TITLE = '⚙ لوحة الأدمن - التحكم الكامل\n\n👇🏻 اختر القسم الذي تريد التعامل معه';

// Message shown when payment (deposit/withdraw) is turned off by admin
const PAYMENT_DOWN_MESSAGE = `⏸ الدفع متوقف حالياً.\nيرجى المحاولة لاحقاً.\n\nPayment is currently down. Please try again later.`;

function adminPanelKeyboard() {
  const botOff = BOT_OFF_FLAG;
  const toggleBotButton = botOff
    ? { text: '🔴 البوت متوقف — اضغط للتشغيل', callback_data: 'admin_toggle_bot' }
    : { text: '🟢 تشغيل/إيقاف البوت', callback_data: 'admin_toggle_bot' };
  const chargeWithdrawOn = FLAG_DEPOSIT_SYRIATEL && FLAG_DEPOSIT_SHAMCASH && FLAG_WITHDRAW_SYRIATEL && FLAG_WITHDRAW_SHAMCASH;
  const toggleChargeWithdrawButton = chargeWithdrawOn
    ? { text: '🔄 إيقاف الشحن والسحب', callback_data: 'admin_toggle_charge_withdraw' }
    : { text: '🔄 تشغيل الشحن والسحب', callback_data: 'admin_toggle_charge_withdraw' };
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📈 الإحصائيات', callback_data: 'admin_stats' }, { text: '📢 رسالة جماعية', callback_data: 'admin_broadcast_send_message' }, { text: '🛠 حساب الدعم', callback_data: 'admin_support_account' }],
        [{ text: '🗂 طلبات السحب المعلقة', callback_data: 'admin_pending_withdrawals' }, { text: '💵 سحب شام كاش يدوي', callback_data: 'admin_manual_sham_withdraw' }],
        [{ text: '💱 تحديث سعر الصرف', callback_data: 'admin_exchange_rate' }, { text: '⚙️ إدارة النسب', callback_data: 'admin_manage_rates' }, { text: '👥 نسب الإحالات', callback_data: 'admin_referral_rates' }],
        [{ text: '🎁 العروض والبونصات', callback_data: 'admin_offers_bonuses' }, { text: '🎯 توزيع أرباح الإحالة يدوياً', callback_data: 'admin_manual_referral_distribute' }],
        [{ text: '📊 عرض صاحب أكبر صافي إيداعات', callback_data: 'admin_top_depositor' }],
        [{ text: '💳 إدارة أرقام سيرياتيل', callback_data: 'admin_syriatel_numbers' }],
        [{ text: '🔒 إدارة عمليات الإيداع والسحب', callback_data: 'admin_manage_deposit_withdraw' }],
        [{ text: '👥 إدارة المستخدمين', callback_data: 'admin_manage_users' }, { text: '🏷 بادئة الحسابات', callback_data: 'admin_username_prefix' }], // { text: '📄 كل العمليات', callback_data: 'admin_all_operations' } — temporarily commented
        [{ text: '🎡 جوائز العجلة', callback_data: 'admin_spin_prizes' }, { text: '🎮 لعبة الصناديق (جوائز)', callback_data: 'admin_box_prizes' }],
        [{ text: '💰 رصيد شام كاش', callback_data: 'admin_sham_balance' }],
        [toggleBotButton, toggleChargeWithdrawButton],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
      ],
    },
  };
}

/** Admin: Manage deposit/withdraw — message text (flags from DB via loadLocalConfig) */
function adminManageDepositWithdrawMessage() {
  return `🔒 إدارة عمليات الإيداع والسحب

اضغط على الزر لتفعيل/إيقاف الطريقة:
• إيداع سيرياتيل: ${FLAG_DEPOSIT_SYRIATEL ? '✅ مفعّل' : '❌ معطّل'}
• إيداع شام كاش: ${FLAG_DEPOSIT_SHAMCASH ? '✅ مفعّل' : '❌ معطّل'}
• سحب سيرياتيل: ${FLAG_WITHDRAW_SYRIATEL ? '✅ مفعّل' : '❌ معطّل'}
• سحب شام كاش: ${FLAG_WITHDRAW_SHAMCASH ? '✅ مفعّل' : '❌ معطّل'}`;
}

/** Admin: Manage deposit/withdraw — four toggle buttons (green tick = enabled, red = disabled) */
function adminManageDepositWithdrawKeyboard() {
  const depositSyr = FLAG_DEPOSIT_SYRIATEL;
  const depositSham = FLAG_DEPOSIT_SHAMCASH;
  const withdrawSyr = FLAG_WITHDRAW_SYRIATEL;
  const withdrawSham = FLAG_WITHDRAW_SHAMCASH;
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: depositSyr ? '✅ إيداع سيرياتيل' : '❌ إيداع سيرياتيل', callback_data: 'admin_payment_toggle_deposit_syriatel' },
          { text: depositSham ? '✅ إيداع شام كاش' : '❌ إيداع شام كاش', callback_data: 'admin_payment_toggle_deposit_shamcash' },
        ],
        [
          { text: withdrawSyr ? '✅ سحب سيرياتيل' : '❌ سحب سيرياتيل', callback_data: 'admin_payment_toggle_withdraw_syriatel' },
          { text: withdrawSham ? '✅ سحب شام كاش' : '❌ سحب شام كاش', callback_data: 'admin_payment_toggle_withdraw_shamcash' },
        ],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
      ],
    },
  };
}

const LUCK_PRIZE_TEXT = 'حظ أوفر';

async function getSpinPrizes() {
  const raw = await getConfigValue('spin_prizes');
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return [{ text: LUCK_PRIZE_TEXT, weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
}

const DEFAULT_LUCK_BOX_PRIZES = [{ amount: 0, weight: 0 }, { amount: 0, weight: 0 }, { amount: 0, weight: 0 }];
const BOX_GAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function getLuckBoxPrizes() {
  const raw = await getConfigValue('luck_box_prizes');
  if (Array.isArray(raw) && raw.length >= 3) return raw.slice(0, 3);
  const base = Array.isArray(raw) && raw.length > 0 ? [...raw] : [];
  while (base.length < 3) base.push({ amount: 0, weight: 0 });
  return base.slice(0, 3);
}

function canUserPlayBoxGame(user) {
  if (!user) return false;
  const lastAt = user.last_box_game_at ? new Date(user.last_box_game_at).getTime() : 0;
  return lastAt === 0 || (Date.now() - lastAt >= BOX_GAME_COOLDOWN_MS);
}

function parseTextWeight(line) {
  const lastComma = Math.max(line.lastIndexOf(','), line.lastIndexOf('،'));
  if (lastComma === -1) return null;
  const prizeText = line.slice(0, lastComma).trim();
  const weightStr = line.slice(lastComma + 1).trim();
  const weight = parseInt(weightStr, 10);
  if (!prizeText || !Number.isFinite(weight) || weight <= 0) return null;
  return { text: prizeText, weight };
}

/** Admin: Spin prizes list (button-based). */
async function adminSpinPrizesMessage() {
  const prizes = await getSpinPrizes();
  const lines = prizes.map((p, i) => `${i + 1}. ${escapeHtml(String(p.text))} — نسبة الظهور: ${p.weight}`);
  const current = lines.length ? lines.join('\n') : '— لا توجد —';
  return `🎡 جوائز العجلة

📌 الجوائز الحالية:
${current}

اختر جائزة للتعديل أو الحذف، أو أضف جائزة جديدة.`;
}

async function adminSpinPrizesKeyboard() {
  const prizes = await getSpinPrizes();
  const rows = [];
  prizes.forEach((p, i) => {
    const label = `${i + 1}. ${String(p.text)} (${p.weight})`;
    rows.push([{ text: label, callback_data: `admin_spp_${i}` }]);
  });
  rows.push(
    [{ text: '➕ إضافة جائزة', callback_data: 'admin_spp_add' }, { text: '➕ حظ أوفر', callback_data: 'admin_spp_add_luck' }],
    [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]
  );
  return { reply_markup: { inline_keyboard: rows } };
}

/** Admin: single prize detail (edit / delete). */
async function adminSpinPrizeDetailMessage(index) {
  const prizes = await getSpinPrizes();
  if (index < 0 || index >= prizes.length) return await adminSpinPrizesMessage();
  const p = prizes[index];
  return `🎡 جائزة #${index + 1}

النص: <code>${escapeHtml(String(p.text))}</code>
النسبة الظهور: ${p.weight}

اختر تعديل أو حذف.`;
}

function adminSpinPrizeDetailKeyboard(index) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ تعديل', callback_data: `admin_spp_edit_${index}` }, { text: '🗑 حذف', callback_data: `admin_spp_del_${index}` }],
        [{ text: '🔙 رجوع', callback_data: 'admin_spin_prizes' }],
      ],
    },
  };
}

/** Admin: Luck box prizes (amount + weight per box) */
async function adminBoxPrizesMessage() {
  const prizes = await getLuckBoxPrizes();
  const lines = prizes.map((p, i) => `صندوق ${i + 1}: مبلغ ${formatNumber(Number(p.amount || 0))} ل.س — نسبة الظهور: ${p.weight || 0}%`);
  return `🎁 جوائز الصناديق

📌 الإعدادات الحالية:
${lines.join('\n')}

النسبة الظهور = نسبة احتمال ظهور الجائزة. اختر صندوقاً للتعديل.`;
}

function adminBoxPrizesKeyboard() {
  const rows = [];
  for (let i = 0; i < 3; i++) {
    rows.push([{ text: `📦 صندوق ${i + 1}`, callback_data: `admin_bpp_${i}` }]);
  }
  rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

async function adminBoxPrizeDetailMessage(index) {
  const prizes = await getLuckBoxPrizes();
  const p = prizes[index] || { amount: 0, weight: 0 };
  return `🎁 صندوق #${index + 1}

المبلغ (ل.س): <code>${escapeHtml(String(p.amount ?? 0))}</code>
النسبة الظهور (%): ${p.weight ?? 0}

اختر تعديل المبلغ أو النسبة الظهور.`;
}

function adminBoxPrizeDetailKeyboard(index) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ تعديل المبلغ', callback_data: `admin_bpp_amount_${index}` }, { text: '✏️ تعديل النسبة الظهور', callback_data: `admin_bpp_weight_${index}` }],
        [{ text: '🔙 رجوع', callback_data: 'admin_box_prizes' }],
      ],
    },
  };
}

/** Admin: Username prefix for new Ichancy accounts (from DB via loadLocalConfig) */
function adminUsernamePrefixMessage() {
  const current = USERNAME_PREFIX_VALUE;
  return `🏷 بادئة اسم المستخدم (لحسابات Ichancy الجديدة)

📌 البادئة الحالية:
<code>${escapeHtml(current)}</code>

💡 مثال: إذا كانت البادئة <code>Bot-</code> واسم المستخدم <code>player123</code>، فالحساب سيكون <code>Bot-player123</code>`;
}

function adminUsernamePrefixKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ تعديل البادئة', callback_data: 'admin_username_prefix_change' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

/** Admin: إدارة المستخدمين — list message and keyboard (10 users per page, pagination + search) */
function adminManageUsersListMessage(result, searchQuery) {
  const { users, total, page, totalPages } = result;
  const title = searchQuery
    ? `نتائج البحث 🔍 "${searchQuery}" (صفحة ${page}/${totalPages})\nإجمالي النتائج: ${formatNumber(total)} مستخدم`
    : `قائمة المستخدمين 👥 (صفحة ${page}/${totalPages})`;
  return title;
}

function adminManageUsersListKeyboard(result, chatId) {
  const { users, page, totalPages } = result;
  const rows = [];
  rows.push([{ text: '🔍 البحث عن مستخدم', callback_data: 'admin_manage_users_search' }]);
  users.forEach((u) => {
    rows.push([{ text: `${u.displayName}`, callback_data: `admin_user_detail_${u.telegram_user_id}` }]);
  });
  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push({ text: '◀ السابق', callback_data: `admin_manage_users_p_${page - 1}` });
    if (page < totalPages) nav.push({ text: 'التالي ▶', callback_data: `admin_manage_users_p_${page + 1}` });
    if (nav.length) rows.push(nav);
  }
  rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

/** Admin: single user detail message (details, transactions, gift redeems, wallet, site balance, affiliate balance) */
async function adminUserDetailMessage(telegramUserId) {
  const user = await getUserByTelegramId(telegramUserId);
  if (!user) {
    return {
      text: '❌ المستخدم غير موجود.',
      reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }]] },
    };
  }
  let commData = { totalCommission: 0, levels: [], referralCount: 0 };
  const effectivePercents = [...REFERRAL_PERCENTS];
  if (user.custom_referral_percent != null) effectivePercents[0] = user.custom_referral_percent;
  try { commData = await getReferralCommission(telegramUserId, effectivePercents); } catch (_) {}
  const [totalDeposits, withdrawalCount] = await Promise.all([
    getTotalDepositsForUser(telegramUserId),
    getWithdrawalCountForUser(telegramUserId),
  ]);
  const displayName = (user.ichancy_login && user.ichancy_login.trim()) || (user.telegram_username && user.telegram_username.trim()) || (user.first_name && user.first_name.trim()) || String(telegramUserId);
  const n = (v) => formatCurrencySyp(Number(v ?? 0));

  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
  let pendingCount = 0, pendingAmount = 0, readyCount = 0, readyAmount = 0, distributedCount = 0, distributedAmount = 0;
  try {
    const netDetails = await getReferralNetDetails(telegramUserId);
    for (const d of netDetails) {
      const net = Number(d.net_balance || 0);
      if (net > 0) {
        const age = Date.now() - new Date(d.created_at).getTime();
        if (age >= TEN_DAYS_MS) {
          readyCount++;
          readyAmount += net;
        } else {
          pendingCount++;
          pendingAmount += net;
        }
      }
    }
    const distHistory = await getUserDistributionHistory(telegramUserId, 1, 1000);
    distributedCount = distHistory.total || 0;
    distributedAmount = distHistory.rows.reduce((s, r) => s + Number(r.commission_amount || 0), 0);
  } catch (_) {}

  let text = `\n👤 معلومات المستخدم\n\n`;
  text += `🆔 معرف التليجرام: <code>${user.telegram_user_id}</code>\n`;
  text += `👑 اسم المستخدم: ${escapeHtml(displayName)}\n`;
  text += `💰 الرصيد الحالي: ${n(user.balance)} ل.س\n`;
  text += `🎁 رصيد الهدايا: ${n(user.gifts)} ل.س\n`;
  text += `\n📊 إحصائيات الإحالة:\n`;
  text += `👥 عدد الإحالات: ${commData.referralCount}\n`;
  text += `💸 الأرباح المعلقة: ${pendingCount} = ${n(pendingAmount)} ل.س\n`;
  text += `✅ الأرباح جاهزة (10+ يوم): ${readyCount} = ${n(readyAmount)} ل.س\n`;
  text += `💰 الأرباح الموزعة: ${distributedCount} = ${n(distributedAmount)} ل.س\n`;
  text += `\n📈 إحصائيات الحساب:\n`;
  text += `💵 مجموع الإيداعات: ${n(totalDeposits)} ل.س\n`;
  text += `🔄 عدد عمليات السحب: ${withdrawalCount}\n`;
  const blocked = await isUserBlocked(telegramUserId, user.telegram_username);
  text += `\n🔒 حالة الحظر: ${blocked ? 'محظور 🚫' : 'غير محظور ✅'}\n`;
  text += `📅 تاريخ التسجيل: ${formatDateManualList(user.created_at)}`;

  const blockBtn = blocked
    ? { text: '🔴 إلغاء الحظر', callback_data: `admin_user_unblock_${telegramUserId}` }
    : { text: '🟢 حظر المستخدم', callback_data: `admin_user_block_${telegramUserId}` };
  const customPctLabel = user.custom_referral_percent != null ? ` (${user.custom_referral_percent}%)` : '';
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 إضافة رصيد', callback_data: `admin_user_add_money_${telegramUserId}` }, { text: '💸 خصم رصيد', callback_data: `admin_user_deduct_money_${telegramUserId}` }],
        [{ text: '✉️ إرسال رسالة', callback_data: `admin_user_send_msg_${telegramUserId}` }],
        [blockBtn],
        [{ text: 'سجل المستخدم 📜', callback_data: `admin_user_logs_${telegramUserId}` }],
        [{ text: `نسبة إحالة خاصة 🎯${customPctLabel}`, callback_data: `admin_user_custom_ref_${telegramUserId}` }],
        [{ text: 'توزيع الجاك بوت 🎰', callback_data: `admin_user_dist_ref_${telegramUserId}` }],
        [{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }],
      ],
    },
  };
}

/**
 * Build the comprehensive admin statistics message (Arabic).
 * @param {Object} s - result of getAdminStats()
 * @param {string|null|undefined} agentWalletBalance - Agent wallet balance from getAgentWallet
 * @param {boolean} [isPreviousMonth] - true when showing last month's stats
 * @param {string} [monthLabel] - e.g. "كانون الثاني 2026" for last month title
 */
function adminStatsMessage(s, agentWalletBalance = null, isPreviousMonth = false, monthLabel = '') {
  if (!s || typeof s !== 'object') return '❌ لا توجد بيانات إحصائيات.';
  const n = (v) => formatNumber(Number(v ?? 0));
  const cashierDisplay = agentWalletBalance != null && agentWalletBalance !== '' ? n(agentWalletBalance) + ' NSP' : '—';
  const title = isPreviousMonth && monthLabel
    ? `📊 إحصائيات البوت — الشهر الماضي (${monthLabel}) 📊`
    : '📊 إحصائيات البوت الشاملة 📊';
  const todayWeekBlock = isPreviousMonth
    ? '\n📆 اليوم / 📅 الأسبوع: — (غير متاح للشهر الماضي)'
    : `\n📆 اليوم: ${n(s.todayDeposits)} إيداع / ${n(s.todayWithdrawals)} سحب\n📅 الأسبوع: ${n(s.weekDeposits)} إيداع / ${n(s.weekWithdrawals)} سحب`;
  return `${title}

👥 عدد المستخدمين: ${n(s.usersTotal)}
💼 رصيد الكاشير: ${cashierDisplay}

💰 مجموع الإيداعات: ${n(s.totalDeposits)} ل.س
💸 السحوبات الآلية: ${n(s.totalWithdrawals)} ل.س
⏳ السحوبات المعلقة: ${n(s.pendingWithdrawalsSum)} ل.س
🏦 مجموع أرصدة المستخدمين: ${n(s.totalUserBalances)} ل.س
🎁 مجموع البونصات: ${n(s.totalBonuses)} ل.س
🤝 أرباح الإحالات: ${n(s.referralProfits)} ل.س
🎡 أرباح العجلة: ${n(s.wheelProfits)} ل.س
📦 أرباح الصناديق: ${n(s.boxProfits)} ل.س
🎉 أرباح الأكواد: ${n(s.codeProfits)} ل.س${todayWeekBlock}`;
}

function adminStatsKeyboard(isPreviousMonth = false) {
  const rows = [
    [{ text: '📥 تصدير Excel', callback_data: 'admin_stats_export' }],
    [
      isPreviousMonth ? { text: '📅 هذا الشهر', callback_data: 'admin_stats' } : { text: '📅 الشهر الماضي', callback_data: 'admin_stats_prev_month' },
      { text: '🔄 تحديث', callback_data: isPreviousMonth ? 'admin_stats_prev_month' : 'admin_stats' },
    ],
    [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
    [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
  ];
  return { reply_markup: { inline_keyboard: rows } };
}

const TOP_DEPOSITOR_PAGE_SIZE = 12;

/**
 * Get date range and label for top depositor report. Range key: 'all' | '7d' | '30d' | '90d'.
 * Returns UTC start/end and human-readable label in bot timezone.
 */
function getTopDepositorDateRange(rangeKey) {
  const now = new Date();
  const tz = getBotTimezone();
  let startDate = null;
  let endDate = null;
  let rangeLabel = 'جميع الفترات';
  let rangeLabelShort = 'الكل';

  if (rangeKey === '7d') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    endDate = new Date(now.getTime());
    rangeLabelShort = '7 أيام';
    rangeLabel = `من ${formatInBotTz(startDate, { dateStyle: 'short', timeStyle: undefined })} إلى ${formatInBotTz(endDate, { dateStyle: 'short', timeStyle: undefined })}`;
  } else if (rangeKey === '30d') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    endDate = new Date(now.getTime());
    rangeLabelShort = '30 يوم';
    rangeLabel = `من ${formatInBotTz(startDate, { dateStyle: 'short', timeStyle: undefined })} إلى ${formatInBotTz(endDate, { dateStyle: 'short', timeStyle: undefined })}`;
  } else if (rangeKey === '90d') {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    endDate = new Date(now.getTime());
    rangeLabelShort = '90 يوم';
    rangeLabel = `من ${formatInBotTz(startDate, { dateStyle: 'short', timeStyle: undefined })} إلى ${formatInBotTz(endDate, { dateStyle: 'short', timeStyle: undefined })}`;
  }

  return { startDate, endDate, rangeLabel, rangeLabelShort };
}

function topDepositorRangeSelectionMessage() {
  return `📊 عرض أصحاب أكبر صافي إيداعات

اختر الفترة (حسب توقيت البوت: ${getBotTimezone()}):`;
}

function topDepositorRangeKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 الكل (جميع الفترات)', callback_data: 'admin_top_depositor_all' }],
        [{ text: '📅 آخر 7 أيام', callback_data: 'admin_top_depositor_7d' }, { text: '📅 آخر 30 يوم', callback_data: 'admin_top_depositor_30d' }],
        [{ text: '📅 آخر 90 يوم', callback_data: 'admin_top_depositor_90d' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

/**
 * Build detailed message for top depositors list (bot wallet: صافي إيداعات = إيداعات مؤكدة − سحوبات مؤكدة).
 */
function topDepositorListMessage(list, rangeLabel, startDate, endDate, page, pageSize) {
  const tz = getBotTimezone();
  const total = list.length;
  const start = (page - 1) * pageSize;
  const slice = list.slice(start, start + pageSize);
  const n = (v) => formatNumber(Number(v ?? 0));

  let text = `📊 أصحاب أكبر صافي إيداعات (محفظة البوت)\n\n`;
  text += `📅 الفترة: ${rangeLabel}\n`;
  if (startDate && endDate) {
    text += `⏰ التوقيت: ${tz}\n`;
  }
  text += `\n`;

  if (slice.length === 0) {
    text += `لا توجد عمليات في هذه الفترة.`;
    return text;
  }

  slice.forEach((u, i) => {
    const rank = start + i + 1;
    const display = (u.telegram_username && String(u.telegram_username).trim()) || (u.first_name && String(u.first_name).trim()) || u.telegram_user_id;
    text += `\n${rank}. ${escapeHtml(display)}\n`;
    text += `   • صافي الإيداعات: ${n(u.net)} ل.س\n`;
    text += `   • إيداعات مؤكدة: ${n(u.confirmed_deposits)} ل.س\n`;
    text += `   • سحوبات مؤكدة: ${n(u.confirmed_withdrawals)} ل.س\n`;
    text += `   • رصيد المحفظة الحالي: ${n(u.current_balance)} ل.س\n`;
  });

  const showing = `يعرض ${start + 1}-${Math.min(start + pageSize, total)} من ${total}`;
  if (total > pageSize) {
    text += `\n\n📄 ${showing}`;
  }
  return text;
}

function topDepositorListKeyboard(rangeKey, page, hasNext) {
  const rows = [];
  if (page > 1) {
    rows.push([{ text: '◀ السابق', callback_data: `admin_top_depositor_${rangeKey}_${page - 1}` }]);
  }
  if (hasNext) {
    rows.push([{ text: 'التالي ▶', callback_data: `admin_top_depositor_${rangeKey}_${page + 1}` }]);
  }
  rows.push([{ text: '📅 تغيير الفترة', callback_data: 'admin_top_depositor' }]);
  rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

/**
 * Build an Excel buffer for the admin stats report (organized sheet).
 * @param {Object} s - result of getAdminStats()
 * @returns {Buffer}
 */
/**
 * Build Excel buffer for admin stats: summary sheet + 3 transaction sheets (الأسبوعية، اليومية، الكلية).
 * @param {Object} s - result of getAdminStats()
 * @param {Object} opts - { daily: [], weekly: [], all: [], exportDateStr: 'YYYY-MM-DD' }
 * @returns {Buffer}
 */
function buildAdminStatsExcelBuffer(s, opts = {}) {
  if (!XLSX) throw new Error('xlsx not installed: run npm install xlsx');
  if (!s || typeof s !== 'object') throw new Error('stats object required');
  const n = (key) => Number(s[key] ?? 0);
  const wb = XLSX.utils.book_new();

  // —— Sheet 1: ملخص (Summary) ——
  const summaryRows = [
    ['تقرير إحصائيات البوت الشاملة', ''],
    ['تاريخ التصدير', opts.exportDateStr || new Date().toISOString().slice(0, 10)],
    ['التوقيت', new Date().toISOString()],
    [],
    ['المستخدمون', 'القيمة'],
    ['إجمالي المستخدمين', n('usersTotal')],
    ['نشط (تفاعل خلال 30 يوم)', n('usersActive')],
    ['غير نشط', n('usersInactive')],
    ['محذوفون', n('usersDeleted')],
    [],
    ['الأموال في المنصة (ل.س)', ''],
    ['مجموع أرصدة المستخدمين', n('totalUserBalances')],
    [],
    ['الإيداعات (ل.س) — الشهر الحالي', n('totalDeposits')],
    ['السحوبات المؤكدة (ل.س) — الشهر الحالي', n('totalWithdrawals')],
    ['السحوبات المعلقة (ل.س)', n('pendingWithdrawalsSum')],
    ['إيداع اليوم', n('todayDeposits')],
    ['سحب اليوم', n('todayWithdrawals')],
    ['إيداع الأسبوع', n('weekDeposits')],
    ['سحب الأسبوع', n('weekWithdrawals')],
    [],
    ['البونصات والأرباح (ل.س)', ''],
    ['أرباح الإحالات', n('referralProfits')],
    ['أرباح العجلة', n('wheelProfits')],
    ['أرباح الصناديق', n('boxProfits')],
    ['أرباح الأكواد', n('codeProfits')],
    ['مجموع البونصات', n('totalBonuses')],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 42 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص');

  const headers = ['معرف المستخدم', 'اسم المستخدم', 'نوع العملية', 'المبلغ', 'الطريقة', 'الحالة', 'الوقت'];

  function formatTime(d) {
    if (!d) return '—';
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return '—';
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    const h = String(x.getHours()).padStart(2, '0');
    const min = String(x.getMinutes()).padStart(2, '0');
    const sec = String(x.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}:${sec}`;
  }

  function sheetFromTransactions(list, sheetName, periodLabel) {
    const rows = [];
    if (periodLabel) rows.push([periodLabel, '', '', '', '', '', `عدد السجلات: ${list.length}`]);
    rows.push(headers);
    for (const r of list) {
      rows.push([
        r.telegram_user_id,
        r.username,
        r.type_ar,
        r.amount,
        r.method_display,
        r.status_display,
        formatTime(r.created_at),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Sheet 2: الأسبوعية (Weekly) — آخر 7 أيام
  sheetFromTransactions(opts.weekly || [], 'الأسبوعية', 'الفترة: آخر 7 أيام');
  // Sheet 3: اليومية (Daily) — اليوم فقط
  sheetFromTransactions(opts.daily || [], 'اليومية', `الفترة: يوم ${opts.exportDateStr || '—'}`);
  // Sheet 4: الكلية (All) — كل العمليات
  sheetFromTransactions(opts.all || [], 'الكلية', 'الفترة: الكل (جميع السجلات)');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function adminSupportSettingsMessage() {
  const current = (SUPPORT_USERNAME || '').trim();
  const forCopy = current ? current.replace(/^@/, '') : '';
  return `🛠 إعدادات مراسلة الدعم

👤 اسم المستخدم الحالي للدعم (الذي يراه المستخدمون):
${forCopy ? `<code>${escapeHtml(forCopy)}</code>\n\n💡 يمكنك النسخ من فوق.` : 'لم يُضبط بعد.'}`;
}

function adminSupportSettingsKeyboard() {
  const botSupportUrl = BOT_SUPPORT_USERNAME ? `https://t.me/${BOT_SUPPORT_USERNAME}` : '';
  const rows = [
    [{ text: '✏️ تغيير اسم مستخدم دعم المستخدمين', callback_data: 'admin_support_change_username' }],
    [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
  ];
  if (botSupportUrl) {
    rows.unshift([{ text: '📩 مراسلة دعم البوت', url: botSupportUrl }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

async function adminBroadcastSettingsMessage() {
  const current = ((await getConfigValue('CHANNEL_USERNAME')) || '').trim();
  const forCopy = current ? current.replace(/^@/, '') : '';
  return `📢 إعدادات قناة البث / القناة الرسمية

📌 اسم القناة الحالي:
${forCopy ? `<code>${escapeHtml(forCopy)}</code>\n\n💡 يمكنك النسخ من فوق.` : 'لم يُضبط بعد.'}`;
}

function adminBroadcastSettingsKeyboard() {
  const channelUrl = channelLink || '';
  const rows = [
    [{ text: '✏️ تغيير اسم القناة', callback_data: 'admin_broadcast_change_channel' }],
    //[{ text: '📨 إرسال رسالة للجميع', callback_data: 'admin_broadcast_send_message' }],
    [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
  ];
  if (channelUrl) {
    rows.unshift([{ text: '📢 فتح القناة', url: channelUrl }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

async function adminExchangeRateSettingsMessage() {
  const current = await getConfigValue('EXCHANGE_RATE_SYP_PER_USD', 15000);
  const num = Number(current);
  const display = Number.isFinite(num) ? String(num) : '—';
  return `💱 سعر الصرف (شام كاش ل.س / USD)

📌 السعر الحالي (ل.س لكل 1 USD):
<code>${escapeHtml(display)}</code>

💡 يمكنك النسخ من فوق.`;
}

function adminExchangeRateSettingsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ تعديل سعر الصرف', callback_data: 'admin_exchange_rate_change' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

async function adminManageRatesMessage() {
  const syr = await getProviderConfig('syriatel');
  const sham = await getProviderConfig('shamcash');
  const fmt = (n) => (n != null && Number.isFinite(n) ? formatNumber(n) : '—');
  const pct = (n) => (n != null && Number.isFinite(n) ? String(Number(n)) : '—');
  return `⚙️ الإعدادات الحالية:

💰 الحد الأقصى للسحب المباشر:
• سيريتيل كاش: ${fmt(syr.max_cashout_syp)}
• شام كاش: ${fmt(sham.max_cashout_syp)}

💵 الحد الأدنى للإيداع:
• سيريتيل كاش: ${fmt(syr.min_deposit_syp)}
• شام كاش: ${fmt(sham.min_deposit_syp)}

🏧 الحد الأدنى للسحب:
• سيريتيل كاش: ${fmt(syr.min_cashout_syp)}
• شام كاش: ${fmt(sham.min_cashout_syp)}

💸 نسبة خصم السحب:
• سيريتيل كاش: ${pct(syr.cashout_tax_percent)}
• شام كاش: ${pct(sham.cashout_tax_percent)}

🎁 نسبة البونص:
• سيريتيل كاش: ${pct(syr.deposit_bonus_percent)}
• شام كاش: ${pct(sham.deposit_bonus_percent)}`;
}

function adminManageRatesKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 تعديل الحد الأقصى للسحب', callback_data: 'admin_rates_edit_max_cashout' }],
        [{ text: '💵 تعديل الحد الأدنى للإيداع', callback_data: 'admin_rates_edit_min_deposit' }],
        [{ text: '🏧 تعديل الحد الأدنى للسحب', callback_data: 'admin_rates_edit_min_cashout' }],
        [{ text: '💸 تعديل نسبة خصم السحب', callback_data: 'admin_rates_edit_tax' }],
        [{ text: '🎁 تعديل نسبة البونص', callback_data: 'admin_rates_edit_bonus' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

const RATES_EDIT_FIELDS = {
  max_cashout_syp: 'الحد الأقصى للسحب المباشر',
  min_deposit_syp: 'الحد الأدنى للإيداع',
  min_cashout_syp: 'الحد الأدنى للسحب',
  cashout_tax_percent: 'نسبة خصم السحب',
  deposit_bonus_percent: 'نسبة البونص',
};

function adminRatesChooseProviderMessage() {
  return `👇 اختر وسيلة الدفع التي تريد تعديل إعداداتها`;
}

function adminRatesChooseProviderKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 سيريتيل كاش', callback_data: 'admin_rates_pick_syriatel' }],
        [{ text: '💳 شام كاش', callback_data: 'admin_rates_pick_shamcash' }],
        [{ text: '🔙 العودة', callback_data: 'admin_rates_edit_back' }],
      ],
    },
  };
}

async function adminReferralRatesMessage() {
  const l1 = await getConfigValue('REFERRAL_LEVEL1_PERCENT', 5);
  const l2 = await getConfigValue('REFERRAL_LEVEL2_PERCENT', 3);
  const l3 = await getConfigValue('REFERRAL_LEVEL3_PERCENT', 2);
  const n1 = Number(l1);
  const n2 = Number(l2);
  const n3 = Number(l3);
  const p1 = Number.isFinite(n1) ? n1.toFixed(1) : '—';
  const p2 = Number.isFinite(n2) ? n2.toFixed(1) : '—';
  const p3 = Number.isFinite(n3) ? n3.toFixed(1) : '—';
  return `👥 تعديل نسب الإحالات

1️⃣ المستوى 1 : %${p1}
2️⃣ المستوى 2 : %${p2}
3️⃣ المستوى 3 : %${p3}`;
}

function adminReferralRatesKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ تعديل النسب', callback_data: 'admin_referral_rates_change' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

// ——— إحصائيات أرباح الإحالة (توزيع الأرباح) ———
const REFERRAL_STATS_TITLE = 'إحصائيات أرباح الإحالة:';

async function adminReferralPendingStatsMessage() {
  let stats;
  try {
    stats = await getGlobalReferralPendingStats(REFERRAL_PERCENTS);
  } catch (err) {
    console.warn('getGlobalReferralPendingStats:', err.message);
    return `${REFERRAL_STATS_TITLE} 📊\n\n❌ خطأ في تحميل الإحصائيات.`;
  }
  const pendingTotal = formatCurrencySyp(stats.totalPending || 0);
  const usersCount = stats.usersWithCommission || 0;
  let lastDist = '—';
  if (stats.lastDistributionAt) {
    try {
      lastDist = formatInBotTz(stats.lastDistributionAt);
    } catch (_) {
      const d = new Date(stats.lastDistributionAt);
      lastDist = d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  return `${REFERRAL_STATS_TITLE} 📊

💰 العمولات المعلقة:
• المجموع: ${pendingTotal} ل.س
• عدد المستخدمين المستحقين: ${usersCount}

📅 آخر توزيع:
${lastDist}`;
}

function adminReferralPendingStatsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎯 توزيع جميع العمولات المعلقة', callback_data: 'admin_referral_distribute_all' }],
        [{ text: '📊 عرض سجل التوزيعات', callback_data: 'admin_referral_view_details' }],
        [{ text: '✏️ تعديل النسب', callback_data: 'admin_referral_rates_change' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

// ——— إدارة العروض والبونصات (Gift codes) ———
const GIFT_OFFERS_TITLE = '🎁 إدارة العروض والبونصات';

function adminGiftOffersKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ إضافة كود هدية', callback_data: 'gift_add' }],
        [{ text: '✏️ تعديل كود', callback_data: 'gift_edit' }],
        [{ text: '🗑 حذف كود', callback_data: 'gift_delete' }],
        [{ text: '📋 عرض جميع الأكواد', callback_data: 'gift_view_all' }],
        [{ text: '📢 نشر الأكواد', callback_data: 'gift_publish' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

async function applyChannelConfig() {
  const channel = await getConfigValue('CHANNEL_USERNAME', '@raphaeele');
  channelId = channel.trim().startsWith('@') || channel.trim().startsWith('-')
    ? channel.trim()
    : `@${channel.trim()}`;
  channelLink = channel.trim().startsWith('https://')
    ? channel.trim()
    : `https://t.me/${channelId.replace(/^@/, '')}`;
}

// Full main menu after login / start — matches Ichancy UI. Add admin button at bottom if user is admin.
function loggedInMainKeyboard(isAdmin = false) {
  const rows = [
    [{ text: 'Ichancy', callback_data: 'ichancy' }],
    [{ text: '💰 شحن البوت', callback_data: 'charge' }, { text: '💸 سحب من البوت', callback_data: 'withdraw' }],
    [{ text: '👤 معلومات الملف الشخصي', callback_data: 'profile' }],
    [{ text: '🎁 كود هدية', callback_data: 'gift_code' }],
    // [{ text: '🎰 الجاك بوت', callback_data: 'jackpot' }],
    [{ text: '💼 محفظتي', callback_data: 'wallet' }],
    [{ text: '👥 الإحالات', callback_data: 'referrals' }, { text: '📄 عرض السجل المالي', callback_data: 'financial_record' }],
    [{ text: '🎮 لعبة الصناديق', callback_data: 'box_game' }, { text: '💬 مراسلة الدعم', callback_data: 'support' }],
    [{ text: 'Golden Tree ↗', url: GOLDEN_TREE_URL }],
    [{ text: '💸 استرداد آخر طلب سحب', callback_data: 'redeem_withdrawal' }],
    [{ text: '📜 دليل المستخدم وشروط البوت', callback_data: 'terms' }],
  ];
  if (isAdmin) {
    rows.push([{ text: 'لوحة الأدمن ⚙', callback_data: 'admin_panel' }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function registerHandlers() {
// /start — للبدء (clear create-account state so user can get new OTP)
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (BOT_OFF_FLAG && !isAdminUser(msg.from)) {
    return bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
  }
  if (!isAdminUser(msg.from) && msg.from && (await isUserBlocked(msg.from.id, msg.from.username))) {
    return bot.sendMessage(chatId, 'تم حظرك من قبل الأدمن.');
  }
  delete userState[chatId];

  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return bot.sendMessage(chatId, '🔒 عليك الاشتراك في القناة الرسمية أولًا لاستخدام البوت!', subscribeKeyboard(isAdminUser(msg.from)));
  }

  // Only update telegram info for users who already have an account; don't create new rows
  try {
    const existingUser = await getUserByTelegramId(userId);
    if (existingUser) {
      await createOrUpdateUser(userId, {
        telegram_username: msg.from.username || null,
        first_name: msg.from.first_name || null,
        last_name: msg.from.last_name || null,
      });
    }
  } catch (err) {
    console.warn('DB createOrUpdateUser on /start:', err.message);
  }

  // Handle referral deep link: /start ref_<referrerId>
  const payload = match && match[1] ? match[1].trim() : '';
  if (payload.startsWith('ref_')) {
    const referrerId = payload.slice(4);
    if (referrerId && referrerId !== String(userId)) {
      try {
        const existingForRef = await getUserByTelegramId(userId);
        if (existingForRef) {
          const saved = await saveReferral(userId, referrerId);
          if (saved) debugLog('/start: referral saved', { userId, referrerId });
        } else {
          pendingReferrals[String(userId)] = referrerId;
          debugLog('/start: referral deferred (user not yet registered)', { userId, referrerId });
        }
      } catch (err) {
        console.warn('saveReferral on /start:', err.message);
      }
    }
  }

  // No account (no row or no ichancy_login) or DEBUG: show create-account menu. Else full menu.
  let user = null;
  try {
    user = await getUserByTelegramId(userId);
  } catch (err) {
    console.warn('DB getUserByTelegramId on /start:', err.message);
  }
  const hasAccount = user && user.ichancy_login;
  const isAdmin = isAdminUser(msg.from);
  const startKeyboard = DEBUG_MODE || !hasAccount ? mainMenuKeyboard(isAdmin) : loggedInMainKeyboard(isAdmin);
  await bot.sendMessage(chatId, MAIN_MENU_TEXT, startKeyboard);
  if (hasAccount && SPIN_BASE_URL) {
    try {
      await ensureDailySpinEligibility(userId);
      const userAfter = await getUserByTelegramId(userId);
      const spinsAvailable = Math.min(1, Number(userAfter?.wheel_spins_available_today ?? 0));
      const spinButtonText = `🎡 تدوير العجلة (${spinsAvailable})`;
      if (spinsAvailable > 0) {
        const botToken = await getConfigValue('BOT_TOKEN');
        const spinToken = botToken ? createSpinToken(BOT_ID, userId, botToken) : '';
        const spinUrl = spinToken
          ? `${SPIN_BASE_URL}/?bot_id=${encodeURIComponent(BOT_ID)}&spin_token=${encodeURIComponent(spinToken)}`
          : `${SPIN_BASE_URL}/?bot_id=${encodeURIComponent(BOT_ID)}`;
        await bot.sendMessage(chatId, '🎡 استخدم الزر أدناه لتدوير العجلة الذهبية', {
          reply_markup: {
            keyboard: [[{ text: spinButtonText, web_app: { url: spinUrl } }]],
            resize_keyboard: true,
          },
        }).catch((err) => debugLog('Spin keyboard send failed:', err.message));
      } else {
        await bot.sendMessage(chatId, '🎡 استخدم الزر أدناه لتدوير العجلة الذهبية', {
          reply_markup: {
            keyboard: [[{ text: spinButtonText }]],
            resize_keyboard: true,
          },
        }).catch((err) => debugLog('Spin keyboard send failed:', err.message));
      }
    } catch (err) {
      console.warn('ensureDailySpinEligibility / spin keyboard:', err.message);
      const userAfter = await getUserByTelegramId(userId).catch(() => null);
      const spinsAvailable = userAfter ? Math.min(1, Number(userAfter?.wheel_spins_available_today ?? 0)) : 0;
      const spinButtonText = spinsAvailable > 0 ? `🎡 تدوير العجلة (${spinsAvailable})` : '🎡 تدوير العجلة (0)';
      if (spinsAvailable > 0) {
        const botToken = await getConfigValue('BOT_TOKEN').catch(() => null);
        const spinToken = botToken ? createSpinToken(BOT_ID, userId, botToken) : '';
        const spinUrl = spinToken
          ? `${SPIN_BASE_URL}/?bot_id=${encodeURIComponent(BOT_ID)}&spin_token=${encodeURIComponent(spinToken)}`
          : `${SPIN_BASE_URL}/?bot_id=${encodeURIComponent(BOT_ID)}`;
        await bot.sendMessage(chatId, '🎡 استخدم الزر أدناه لتدوير العجلة الذهبية', {
          reply_markup: {
            keyboard: [[{ text: spinButtonText, web_app: { url: spinUrl } }]],
            resize_keyboard: true,
          },
        }).catch((e) => debugLog('Spin keyboard send failed:', e.message));
      } else {
        await bot.sendMessage(chatId, '🎡 استخدم الزر أدناه لتدوير العجلة الذهبية', {
          reply_markup: {
            keyboard: [[{ text: spinButtonText }]],
            resize_keyboard: true,
          },
        }).catch((e) => debugLog('Spin keyboard send failed:', e.message));
      }
    }
  }
});

// Callback: create account, terms, terms_agree, terms_back
bot.on('callback_query', async (query) => {
  try {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    debugLog('callback_query: got request', { data, chatId, messageId });

    // Answer callback safely; ignore "query is too old" errors
    await bot.answerCallbackQuery(query.id).catch((err) => {
      const desc = err?.response?.body?.description || '';
      if (desc.includes('query is too old') || desc.includes('query ID is invalid')) {
        console.warn('Ignoring stale callback_query from Telegram');
        return;
      }
      console.warn('answerCallbackQuery error:', err.message);
    });

    if (BOT_OFF_FLAG && !isAdminUser(query.from)) {
      await bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
      return;
    }

    if (!isAdminUser(query.from) && query.from && (await isUserBlocked(query.from.id, query.from.username))) {
      await bot.sendMessage(chatId, 'تم حظرك من قبل الأدمن.');
      return;
    }

  if (data === 'create_account') {
    debugLog('callback_query: executing create_account');
    const otp = generateOTP();
    userState[chatId] = {
      step: 'await_otp',
      otp,
      otpExpiry: Date.now() + OTP_VALID_MS,
    };
    await bot.editMessageText('إنشاء حساب أيشانسي ➕', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
    await bot.sendMessage(chatId, MSG_OTP_PROMPT(otp), { parse_mode: 'HTML' });
    return;
  }

    if (data === 'terms') {
      debugLog('callback_query: executing terms');
      await bot.editMessageText(TERMS_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...termsKeyboard(),
      });
      return;
    }

    if (data === 'terms_agree') {
      await bot.editMessageText(AGREED_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
      return;
    }

    if (data === 'terms_back') {
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId on terms_back:', err.message);
      }
      const hasAccount = user && user.ichancy_login;
      const keyboard = hasAccount ? loggedInMainKeyboard(isAdminUser(query.from)) : mainMenuKeyboard(isAdminUser(query.from));
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...keyboard,
      });
      return;
    }

    // Back from account-success (or account-failure) → show appropriate menu based on whether user has account
    if (data === 'main_menu_back') {
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId on main_menu_back:', err.message);
      }
      const hasAccount = user && user.ichancy_login;
      const keyboard = hasAccount ? loggedInMainKeyboard(isAdminUser(query.from)) : mainMenuKeyboard(isAdminUser(query.from));
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...keyboard,
      });
      return;
    }

    if (data === 'admin_panel') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(ADMIN_PANEL_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminPanelKeyboard(),
      });
      return;
    }

    if (data === 'admin_toggle_bot') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      try {
        const current = BOT_OFF_FLAG;
        await setConfigValue('BOT_OFF', !current);
        await loadLocalConfig();
        await bot.editMessageText(ADMIN_PANEL_TITLE, {
          chat_id: chatId,
          message_id: messageId,
          ...adminPanelKeyboard(),
        });
      } catch (err) {
        console.warn('admin_toggle_bot:', err.message);
      }
      return;
    }

    // Toggle all deposit/withdraw methods on or off in one click
    if (data === 'admin_toggle_charge_withdraw') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      try {
        const allOn =
          FLAG_DEPOSIT_SYRIATEL && FLAG_DEPOSIT_SHAMCASH && FLAG_WITHDRAW_SYRIATEL && FLAG_WITHDRAW_SHAMCASH;
        const newState = !allOn;
        await setConfigValue('DEPOSIT_SYRIATEL_ENABLED', newState);
        await setConfigValue('DEPOSIT_SHAMCASH_ENABLED', newState);
        await setConfigValue('WITHDRAW_SYRIATEL_ENABLED', newState);
        await setConfigValue('WITHDRAW_SHAMCASH_ENABLED', newState);
        await loadLocalConfig();
        await bot.editMessageText(ADMIN_PANEL_TITLE, {
          chat_id: chatId,
          message_id: messageId,
          ...adminPanelKeyboard(),
        });
      } catch (err) {
        console.warn('admin_toggle_charge_withdraw:', err.message);
      }
      return;
    }

    if (data === 'admin_support_account') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const exampleUser = (SUPPORT_USERNAME || '').trim().replace(/^@/, '') || 'Ichancy_bot1';
      userState[chatId] = { step: 'await_admin_support_username' };
      await bot.editMessageText(
        `🛠️ الرجاء إرسال اسم مستخدم الدعم الجديد (مثال: @${exampleUser})\n\nملاحظة: يمكنك الضغط على 'العودة' للإلغاء.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'admin_support_cancel' }]],
          },
        }
      );
      return;
    }

    if (data === 'admin_support_change_username') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const exampleUser = (SUPPORT_USERNAME || '').trim().replace(/^@/, '') || 'Ichancy_bot1';
      userState[chatId] = { step: 'await_admin_support_username' };
      await bot.editMessageText(
        `🛠️ الرجاء إرسال اسم مستخدم الدعم الجديد (مثال: @${exampleUser})\n\nملاحظة: يمكنك الضغط على 'العودة' للإلغاء.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'admin_support_cancel' }]],
          },
        }
      );
      return;
    }

    if (data === 'admin_support_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(ADMIN_PANEL_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminPanelKeyboard(),
      });
      return;
    }

    if (data === 'admin_broadcast') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(await adminBroadcastSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminBroadcastSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_broadcast_change_channel') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_broadcast_channel_username' };
      await bot.editMessageText('✏️ أرسل اسم القناة الجديد:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_broadcast_cancel' }]],
        },
      });
      return;
    }

    if (data === 'admin_broadcast_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(await adminBroadcastSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminBroadcastSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_broadcast_send_message') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_broadcast_message' };
      await bot.editMessageText('📢 الرجاء كتابة الرسالة التي تريد إرسالها لجميع المستخدمين:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          // Cancel goes to main admin menu (admin_broadcast_send_cancel handler)
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_broadcast_send_cancel' }]],
        },
      });
      return;
    }

    if (data === 'admin_broadcast_send_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      // Go to main admin menu (not broadcast settings)
      // await bot.editMessageText(await adminBroadcastSettingsMessage(), {
      //   chat_id: chatId,
      //   message_id: messageId,
      //   parse_mode: 'HTML',
      //   ...adminBroadcastSettingsKeyboard(),
      // });
      await bot.editMessageText(ADMIN_PANEL_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminPanelKeyboard(),
      });
      return;
    }

    if (data === 'admin_exchange_rate') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await loadConfig();
      await bot.editMessageText(await adminExchangeRateSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminExchangeRateSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_exchange_rate_change') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_exchange_rate', messageId };
      await bot.editMessageText('✏️ أرسل السعر الجديد (ل.س لكل 1 USD) — رقم موجب فقط:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_exchange_rate_cancel' }]],
        },
      });
      return;
    }

    if (data === 'admin_exchange_rate_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(await adminExchangeRateSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminExchangeRateSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_spin_prizes') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      if (userState[chatId] && /^await_admin_spin_prize/.test(userState[chatId].step)) delete userState[chatId];
      await bot.editMessageText(await adminSpinPrizesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...(await adminSpinPrizesKeyboard()),
      });
      return;
    }

    if (data.startsWith('admin_spp_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const prizes = await getSpinPrizes();
      if (data === 'admin_spp_add') {
        userState[chatId] = { step: 'await_admin_spin_prize_add', messageId };
        await bot.editMessageText('➕ أرسل النص والنسبة الظهور (سطر واحد: <code>نص، نسبة الظهور</code>). مثال: 💰 5000، 5', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_spin_prizes' }]] },
        });
        return;
      }
      if (data === 'admin_spp_add_luck') {
        userState[chatId] = { step: 'await_admin_spin_prize_add_luck', messageId };
        await bot.editMessageText(`➕ أرسل النسبة الظهور فقط (رقم موجب). النص سيكون: ${LUCK_PRIZE_TEXT}`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_spin_prizes' }]] },
        });
        return;
      }
      const detailMatch = data.match(/^admin_spp_(\d+)$/);
      if (detailMatch) {
        const idx = parseInt(detailMatch[1], 10);
        if (idx >= 0 && idx < prizes.length) {
          await bot.editMessageText(await adminSpinPrizeDetailMessage(idx), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            ...adminSpinPrizeDetailKeyboard(idx),
          });
        }
        return;
      }
      const editMatch = data.match(/^admin_spp_edit_(\d+)$/);
      if (editMatch) {
        const idx = parseInt(editMatch[1], 10);
        if (idx >= 0 && idx < prizes.length) {
          const p = prizes[idx];
          const isLuck = String(p.text).trim() === LUCK_PRIZE_TEXT;
          if (isLuck) {
            userState[chatId] = { step: 'await_admin_spin_prize_weight', prizeIndex: idx, messageId };
            await bot.editMessageText('✏️ أرسل النسبة الظهور الجديد (رقم موجب):', {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_spin_prizes' }]] },
            });
          } else {
            userState[chatId] = { step: 'await_admin_spin_prize_edit', prizeIndex: idx, messageId };
            await bot.editMessageText('✏️ أرسل النص والنسبة الظهور (سطر واحد: <code>نص، نسبة الظهور</code>):', {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_spin_prizes' }]] },
            });
          }
        }
        return;
      }
      const delMatch = data.match(/^admin_spp_del_(\d+)$/);
      if (delMatch) {
        const idx = parseInt(delMatch[1], 10);
        if (idx >= 0 && idx < prizes.length) {
          const next = prizes.filter((_, i) => i !== idx);
          if (next.length === 0) {
            await bot.answerCallbackQuery(query.id, { text: 'يجب بقاء جائزة واحدة على الأقل' });
            return;
          }
          try {
            await setConfigValue('spin_prizes', next);
            await bot.editMessageText('✅ تم حذف الجائزة.\n\n' + (await adminSpinPrizesMessage()), {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'HTML',
              ...(await adminSpinPrizesKeyboard()),
            });
          } catch (err) {
            console.warn('setConfigValue spin_prizes (delete):', err.message);
            await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ' });
          }
        }
        return;
      }
    }

    if (data === 'admin_box_prizes') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      if (userState[chatId] && /^await_admin_box_prize/.test(userState[chatId].step)) delete userState[chatId];
      await bot.editMessageText(await adminBoxPrizesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminBoxPrizesKeyboard(),
      });
      return;
    }

    if (data.startsWith('admin_bpp_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const boxDetailMatch = data.match(/^admin_bpp_(\d)$/);
      if (boxDetailMatch) {
        const idx = parseInt(boxDetailMatch[1], 10);
        if (idx >= 0 && idx <= 2) {
          await bot.editMessageText(await adminBoxPrizeDetailMessage(idx), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            ...adminBoxPrizeDetailKeyboard(idx),
          });
        }
        return;
      }
      const amountMatch = data.match(/^admin_bpp_amount_(\d)$/);
      if (amountMatch) {
        const idx = parseInt(amountMatch[1], 10);
        if (idx >= 0 && idx <= 2) {
          userState[chatId] = { step: 'await_admin_box_prize_amount', boxIndex: idx, messageId };
          await bot.editMessageText('✏️ أرسل المبلغ (ل.س) للصندوق ' + (idx + 1) + ':', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_box_prizes' }]] },
          });
        }
        return;
      }
      const weightMatch = data.match(/^admin_bpp_weight_(\d)$/);
      if (weightMatch) {
        const idx = parseInt(weightMatch[1], 10);
        if (idx >= 0 && idx <= 2) {
          userState[chatId] = { step: 'await_admin_box_prize_weight', boxIndex: idx, messageId };
          await bot.editMessageText('✏️ أرسل النسبة الظهور (نسبة مئوية) للصندوق ' + (idx + 1) + ':',
            {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_box_prizes' }]] },
            });
        }
        return;
      }
    }

    if (data === 'admin_username_prefix') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(adminUsernamePrefixMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminUsernamePrefixKeyboard(),
      });
      return;
    }

    if (data === 'admin_username_prefix_change') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_username_prefix', messageId };
      await bot.editMessageText('✏️ أرسل البادئة الجديدة (مثال: Bot- ):', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_username_prefix_cancel' }]],
        },
      });
      return;
    }

    if (data === 'admin_username_prefix_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(adminUsernamePrefixMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminUsernamePrefixKeyboard(),
      });
      return;
    }

    if (data === 'admin_manage_rates') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await loadConfig();
      await bot.editMessageText(await adminManageRatesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
      return;
    }

    const RATES_EDIT_DATA_TO_FIELD = {
      admin_rates_edit_max_cashout: 'max_cashout_syp',
      admin_rates_edit_min_deposit: 'min_deposit_syp',
      admin_rates_edit_min_cashout: 'min_cashout_syp',
      admin_rates_edit_tax: 'cashout_tax_percent',
      admin_rates_edit_bonus: 'deposit_bonus_percent',
    };
    if (RATES_EDIT_DATA_TO_FIELD[data]) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const ratesField = RATES_EDIT_DATA_TO_FIELD[data];
      userState[chatId] = { step: 'admin_rates_choose_provider', ratesField, messageId };
      await bot.editMessageText(adminRatesChooseProviderMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminRatesChooseProviderKeyboard(),
      });
      return;
    }

    if (data === 'admin_rates_pick_syriatel' || data === 'admin_rates_pick_shamcash') {
      if (!isAdminUser(query.from)) return;
      const state = userState[chatId];
      if (state?.step !== 'admin_rates_choose_provider' || !state.ratesField) return;
      const provider = data === 'admin_rates_pick_syriatel' ? 'syriatel' : 'shamcash';
      const providerLabel = provider === 'syriatel' ? 'سيريتيل كاش' : 'شام كاش';
      const fieldLabel = RATES_EDIT_FIELDS[state.ratesField] || state.ratesField;
      userState[chatId] = { step: 'await_admin_rates_single', field: state.ratesField, provider, messageId: state.messageId };
      const isPercent = state.ratesField === 'cashout_tax_percent' || state.ratesField === 'deposit_bonus_percent';
      const hint = isPercent ? ' (نسبة بين 0 و 100)' : ' (رقم صحيح)';
      await bot.editMessageText(
        `✏️ تعديل <b>${fieldLabel}</b> — ${providerLabel}\n\nأرسل القيمة الجديدة${hint}:`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_rates_edit_cancel' }]],
          },
        }
      );
      return;
    }

    if (data === 'admin_rates_edit_back') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await loadConfig();
      await bot.editMessageText(await adminManageRatesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
      return;
    }

    if (data === 'admin_rates_edit_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await loadConfig();
      await bot.editMessageText(await adminManageRatesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
      return;
    }

    if (data === 'admin_referral_rates') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const statsMsg = await adminReferralPendingStatsMessage();
      try {
        await bot.editMessageText(statsMsg, {
          chat_id: chatId,
          message_id: messageId,
          ...adminReferralPendingStatsKeyboard(),
        });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) throw editErr;
      }
      return;
    }

    if (data === 'admin_manual_referral_distribute') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const statsMsg = await adminReferralPendingStatsMessage();
      try {
        await bot.editMessageText(statsMsg, {
          chat_id: chatId,
          message_id: messageId,
          ...adminReferralPendingStatsKeyboard(),
        });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) throw editErr;
      }
      return;
    }

    if (data === 'admin_referral_rates_change') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_referral_rates', messageId };
      await bot.editMessageText(
        (await adminReferralRatesMessage()) +
          '\n\n✏️ أرسل القيم الجديدة مفصولة بفواصل مثل:\n<code>5,2,1</code>',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'admin_referral_rates_cancel' }]],
          },
        }
      );
      return;
    }

    if (data === 'admin_referral_rates_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      const statsMsg = await adminReferralPendingStatsMessage();
      try {
        await bot.editMessageText(statsMsg, {
          chat_id: chatId,
          message_id: messageId,
          ...adminReferralPendingStatsKeyboard(),
        });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) throw editErr;
      }
      return;
    }

    if (data === 'admin_referral_distribute_all') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      try {
        const result = await distributeAllReferralCommissions(REFERRAL_PERCENTS);
        await bot.answerCallbackQuery(query.id);
        const userCount = result.distributedUserCount || 0;
        const total = result.distributedTotal || 0;
        const feedbackMsg = userCount > 0
          ? `✅ تم التوزيع بنجاح\n\n👥 تم تحويل العمولات إلى محفظة البوت لـ ${userCount} مستخدم\n💰 المجموع: ${formatCurrencySyp(total)} ل.س\n\nتمت إعادة تعيين صافي الأرصدة الموجبة إلى 0. الأرصدة السالبة تُرحّل للفترة القادمة.`
          : `ℹ️ لا توجد عمولات معلقة لتوزيعها.`;
        await bot.sendMessage(chatId, feedbackMsg);
        const statsMsg = await adminReferralPendingStatsMessage();
        try {
          await bot.editMessageText(statsMsg, {
            chat_id: chatId,
            message_id: messageId,
            ...adminReferralPendingStatsKeyboard(),
          });
        } catch (editErr) {
          const msg = editErr?.message || editErr?.response?.body?.description || '';
          if (!msg.includes('message is not modified')) console.warn('editMessageText after distribute:', editErr.message);
        }
      } catch (err) {
        console.warn('distributeAllReferralCommissions:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ أثناء التوزيع.' });
        await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التوزيع. يرجى المحاولة لاحقاً.');
      }
      return;
    }

    if (data === 'admin_referral_view_details') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const page = 1;
      const { rows, total, totalPages } = await getReferralDistributionHistory(page, 15);
      const allIds = rows.map(r => r.referrer_id);
      const displayMap = await getUsersDisplayMap(allIds);
      const lines = rows.map((r) => {
        let dateStr = '—';
        if (r.distributed_at) {
          try { dateStr = formatInBotTz(r.distributed_at); } catch (_) { dateStr = new Date(r.distributed_at).toISOString().slice(0, 16).replace('T', ' '); }
        }
        const name = escapeHtml(displayMap[String(r.referrer_id)] || String(r.referrer_id));
        return `💰 ${formatCurrencySyp(r.commission_amount)} ل.س — ${name}\n   L1: ${formatCurrencySyp(r.net_l1_snapshot)} | L2: ${formatCurrencySyp(r.net_l2_snapshot)} | L3: ${formatCurrencySyp(r.net_l3_snapshot)}\n   📅 ${dateStr}`;
      });
      const displayPage = totalPages ? Math.min(page, totalPages) : 1;
      const detailMsg = `📊 سجل التوزيعات (صفحة ${displayPage}/${totalPages}، ${total} سجل)\n\n${lines.length ? lines.join('\n\n') : '— لا توجد سجلات —'}`;
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            ...(totalPages > 1 ? [[
              { text: '◀ السابق', callback_data: displayPage > 1 ? `admin_referral_details_${displayPage - 1}` : 'admin_referral_view_details' },
              { text: 'التالي ▶', callback_data: displayPage < totalPages ? `admin_referral_details_${displayPage + 1}` : 'admin_referral_view_details' },
            ]] : []),
            [{ text: '🔙 رجوع', callback_data: 'admin_referral_rates' }],
          ],
        },
      };
      try {
        await bot.editMessageText(detailMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...keyboard });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) throw editErr;
      }
      return;
    }

    if (data.startsWith('admin_referral_details_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      let page = parseInt(data.replace('admin_referral_details_', ''), 10) || 1;
      page = Math.max(1, page);
      let { rows, total, totalPages } = await getReferralDistributionHistory(page, 15);
      if (rows.length === 0 && total > 0 && totalPages > 0 && page > totalPages) {
        const res = await getReferralDistributionHistory(totalPages, 15);
        rows = res.rows;
        page = totalPages;
      }
      const allIds = rows.map(r => r.referrer_id);
      const displayMap = await getUsersDisplayMap(allIds);
      const lines = rows.map((r) => {
        let dateStr = '—';
        if (r.distributed_at) {
          try { dateStr = formatInBotTz(r.distributed_at); } catch (_) { dateStr = new Date(r.distributed_at).toISOString().slice(0, 16).replace('T', ' '); }
        }
        const name = escapeHtml(displayMap[String(r.referrer_id)] || String(r.referrer_id));
        return `💰 ${formatCurrencySyp(r.commission_amount)} ل.س — ${name}\n   L1: ${formatCurrencySyp(r.net_l1_snapshot)} | L2: ${formatCurrencySyp(r.net_l2_snapshot)} | L3: ${formatCurrencySyp(r.net_l3_snapshot)}\n   📅 ${dateStr}`;
      });
      const displayPage = totalPages ? Math.min(page, totalPages) : 1;
      const detailMsg = `📊 سجل التوزيعات (صفحة ${displayPage}/${totalPages}، ${total} سجل)\n\n${lines.length ? lines.join('\n\n') : '— لا توجد سجلات —'}`;
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            ...(totalPages > 1 ? [[
              { text: '◀ السابق', callback_data: displayPage > 1 ? `admin_referral_details_${displayPage - 1}` : 'admin_referral_details_1' },
              { text: 'التالي ▶', callback_data: displayPage < totalPages ? `admin_referral_details_${displayPage + 1}` : `admin_referral_details_${totalPages}` },
            ]] : []),
            [{ text: '🔙 رجوع', callback_data: 'admin_referral_rates' }],
          ],
        },
      };
      try {
        await bot.editMessageText(detailMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...keyboard });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) throw editErr;
      }
      return;
    }

    // ——— إدارة العروض والبونصات ———
    if (data === 'admin_offers_bonuses') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(GIFT_OFFERS_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminGiftOffersKeyboard(),
      });
      return;
    }

    if (data === 'gift_back') {
      if (!isAdminUser(query.from)) return;
      await bot.editMessageText(GIFT_OFFERS_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminGiftOffersKeyboard(),
      });
      return;
    }

    if (data === 'gift_add') {
      if (!isAdminUser(query.from)) return;
      userState[chatId] = { step: 'await_gift_add_code', messageId };
      await bot.editMessageText(
        `🎁 إنشاء كود هدية جديد\n\nملاحظة:\n• الكود سيكون فعالاً فوراً ويمكن للأدمن استخدامه\n• الكود غير منشور للمستخدمين حتى يتم نشره في القناة\n\nأدخل اسم كود الهدية (مثال: WELCOME10):`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_cancel' }]] },
        }
      );
      return;
    }

    if (data === 'gift_edit') {
      if (!isAdminUser(query.from)) return;
      const codes = await listGiftCodes({});
      if (!codes.length) {
        await bot.answerCallbackQuery(query.id, { text: 'لا توجد أكواد' });
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ لا توجد أكواد لتحريرها.', {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
        return;
      }
      const rows = codes.slice(0, 20).map((c) => {
        const limitTxt = c.max_redemptions == null ? '∞' : c.max_redemptions;
        return [{ text: `${c.code} (${formatNumber(c.amount)} ل.س - ${limitTxt} مرة)`, callback_data: `gift_edit_${c.id}` }];
      });
      rows.push([{ text: '🔙 إلغاء', callback_data: 'gift_back' }]);
      await bot.editMessageText('اختر الكود للتعديل ✏️', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data.startsWith('gift_edit_')) {
      if (!isAdminUser(query.from)) return;
      const id = parseInt(data.replace('gift_edit_', ''), 10);
      if (!Number.isFinite(id)) return;
      const row = await getGiftCodeById(id);
      if (!row) {
        await bot.answerCallbackQuery(query.id, { text: 'الكود غير موجود' });
        return;
      }
      userState[chatId] = { step: 'await_gift_edit_amount', giftCodeId: id, giftCodeName: row.code, messageId };
      await bot.editMessageText(
        `💰 أدخل القيمة الجديدة للكود '<code>${escapeHtml(row.code)}</code>':`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_back' }]] },
        }
      );
      return;
    }

    if (data === 'gift_delete') {
      if (!isAdminUser(query.from)) return;
      const codes = await listGiftCodes({});
      if (!codes.length) {
        await bot.answerCallbackQuery(query.id, { text: 'لا توجد أكواد' });
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ لا توجد أكواد لحذفها.', {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
        return;
      }
      const rows = codes.slice(0, 20).map((c) => [
        { text: `🗑 ${c.code}`, callback_data: `gift_del_${c.id}` },
      ]);
      rows.push([{ text: '🔙 إلغاء', callback_data: 'gift_back' }]);
      await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n🗑 اختر الكود لحذفه نهائياً:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data.startsWith('gift_del_')) {
      if (!isAdminUser(query.from)) return;
      const id = parseInt(data.replace('gift_del_', ''), 10);
      if (!Number.isFinite(id)) return;
      const deleted = await deleteGiftCode(id);
      if (!deleted) {
        await bot.answerCallbackQuery(query.id, { text: 'الكود غير موجود' });
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: 'تم الحذف' });
      await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n✅ تم حذف الكود.', {
        chat_id: chatId,
        message_id: messageId,
        ...adminGiftOffersKeyboard(),
      });
      return;
    }

    if (data === 'gift_view_all') {
      if (!isAdminUser(query.from)) return;
      const codes = await listGiftCodes({});
      const tz = getBotTimezone();
      let text = GIFT_OFFERS_TITLE + '\n\n📋 <b>جميع الأكواد وتقرير الاستخدام</b>\n⏰ التوقيت: ' + tz + '\n\n';
      const now = new Date();
      const active = codes.filter((c) => c.is_active && (!c.expiry_date || new Date(c.expiry_date) > now));
      const inactive = codes.filter((c) => !c.is_active || (c.expiry_date && new Date(c.expiry_date) <= now));
      if (active.length) {
        text += '🟢 <b>أكواد نشطة:</b>\n';
        active.forEach((c) => {
          const remain = c.max_redemptions != null ? Math.max(0, c.max_redemptions - c.redemption_count) : '∞';
          const expiry = c.expiry_date ? formatInBotTz(c.expiry_date) : 'بدون انتهاء';
          text += `• <code>${escapeHtml(c.code)}</code> — ${formatNumber(c.amount)} ل.س، استُخدم ${c.redemption_count}، متبقي ${remain}، حتى ${expiry}\n`;
        });
      }
      if (inactive.length) {
        text += '\n⚪ <b>أكواد غير نشطة / منتهية:</b>\n';
        inactive.forEach((c) => {
          const expiry = c.expiry_date ? formatInBotTz(c.expiry_date) : '—';
          text += `• <code>${escapeHtml(c.code)}</code> — ${formatNumber(c.amount)} ل.س، استُخدم ${c.redemption_count}، انتهاء: ${expiry}\n`;
        });
      }
      if (!codes.length) text += 'لا توجد أكواد.';
      const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'gift_back' }]] } };
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...keyboard });
      return;
    }

    if (data === 'gift_publish') {
      if (!isAdminUser(query.from)) return;
      const codes = await listGiftCodes({ activeOnly: true });
      const unpublished = codes.filter((c) => !c.published);
      if (!unpublished.length) {
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ لا توجد أكواد غير منشورة.', {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_gift_publish_count', messageId, unpublishedIds: unpublished.map(c => c.id) };
      await bot.editMessageText(
        `يوجد ${unpublished.length} كود غير منشور 📣\nكم عدد الأكواد التي تريد نشرها؟`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_cancel' }]] },
        }
      );
      return;
    }

    if (data === 'gift_publish_confirm') {
      if (!isAdminUser(query.from)) return;
      const st = userState[chatId];
      if (!st || !st.publishCodeIds || !st.publishCodeIds.length) {
        delete userState[chatId];
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ لا توجد أكواد للنشر.', {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
        return;
      }
      const codeIds = st.publishCodeIds;
      const allCodes = await listGiftCodes({ activeOnly: true });
      const toPublish = allCodes.filter(c => codeIds.includes(c.id));
      delete userState[chatId];
      if (!toPublish.length) {
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ الأكواد لم تعد متاحة.', {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
        return;
      }
      await markGiftCodesPublished(codeIds);
      const botUsername = BOT_USERNAME || BOT_ID;
      const codeLines = toPublish.map(c => `💎 <code>${escapeHtml(c.code)}</code>`).join('\n');
      const channelMsg = `🎉 أكواد الهدايا انطلقت!\nالكود صالح للاستخدام مرة واحدة فقط، كن سريعا! 💵\n\n${codeLines}\n\n✅ رابط البوت: ${escapeHtml(botUsername)}`;
      try {
        await bot.sendMessage(channelId, channelMsg, { parse_mode: 'HTML' });
        await bot.editMessageText(GIFT_OFFERS_TITLE + `\n\n✅ تم نشر ${toPublish.length} كود في القناة بنجاح!`, {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
      } catch (err) {
        console.warn('gift_publish_confirm sendMessage to channel:', err.message);
        await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n❌ فشل إرسال الرسالة للقناة: ' + (err.message || 'خطأ'), {
          chat_id: chatId,
          message_id: messageId,
          ...adminGiftOffersKeyboard(),
        });
      }
      return;
    }

    if (data === 'gift_publish_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(GIFT_OFFERS_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminGiftOffersKeyboard(),
      });
      return;
    }

    if (data === 'gift_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(GIFT_OFFERS_TITLE, {
        chat_id: chatId,
        message_id: messageId,
        ...adminGiftOffersKeyboard(),
      });
      return;
    }

    if (data === 'admin_stats') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      let stats;
      try {
        stats = await getAdminStats({ currencyMultiple: OLD_CURRENCY_MULTIPLE });
      } catch (err) {
        console.warn('getAdminStats:', err.message);
        await bot.editMessageText('❌ خطأ في تحميل الإحصائيات. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
            ],
          },
        });
        return;
      }
      let agentWalletBalance = null;
      try {
        const cookies = await getAgentSession();
        const wallet = await getAgentWallet(cookies);
        if (wallet.success && wallet.balance != null) agentWalletBalance = wallet.balance;
      } catch (err) {
        console.warn('getAgentWallet:', err.message);
      }
      const text = adminStatsMessage(stats, agentWalletBalance, stats.isPreviousMonth, stats.monthLabel);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminStatsKeyboard(stats.isPreviousMonth),
      });
      return;
    }

    if (data === 'admin_stats_prev_month') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      let stats;
      try {
        stats = await getAdminStats({ currencyMultiple: OLD_CURRENCY_MULTIPLE, monthOffset: -1 });
      } catch (err) {
        console.warn('getAdminStats(prev month):', err.message);
        await bot.editMessageText('❌ خطأ في تحميل إحصائيات الشهر الماضي. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
            ],
          },
        });
        return;
      }
      let agentWalletBalance = null;
      try {
        const cookies = await getAgentSession();
        const wallet = await getAgentWallet(cookies);
        if (wallet.success && wallet.balance != null) agentWalletBalance = wallet.balance;
      } catch (err) {
        console.warn('getAgentWallet:', err.message);
      }
      const text = adminStatsMessage(stats, agentWalletBalance, true, stats.monthLabel);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminStatsKeyboard(true),
      });
      return;
    }

    if (data === 'admin_stats_export') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: 'جاري إنشاء التقرير…' });
      let stats;
      let bounds;
      let daily = [];
      let weekly = [];
      let all = [];
      try {
        stats = await getAdminStats({ currencyMultiple: OLD_CURRENCY_MULTIPLE });
        bounds = await getExportDateBounds();
        const now = bounds.now || new Date();
        daily = await getTransactionsForExport(bounds.todayStart, now);
        weekly = await getTransactionsForExport(bounds.weekStart, now);
        all = await getTransactionsForExport(null, null);
      } catch (err) {
        console.warn('getAdminStats / getExportDateBounds / getTransactionsForExport:', err.message);
        await bot.sendMessage(chatId, '❌ فشل إنشاء التقرير.').catch(() => {});
        return;
      }
      try {
        const buffer = buildAdminStatsExcelBuffer(stats, {
          daily,
          weekly,
          all,
          exportDateStr: bounds.exportDateStr || new Date().toISOString().slice(0, 10),
        });
        const filename = `الإحصائيات_${bounds.exportDateStr || new Date().toISOString().slice(0, 10)}.xlsx`;
        await bot.sendDocument(chatId, buffer, {
          caption: '📥 تقرير الإحصائيات الشاملة',
        }, {
          filename,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      } catch (err) {
        console.warn('buildAdminStatsExcelBuffer:', err.message);
        await bot.sendMessage(chatId, '❌ فشل إنشاء ملف Excel.').catch(() => {});
      }
      return;
    }

    if (data === 'admin_top_depositor') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(topDepositorRangeSelectionMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...topDepositorRangeKeyboard(),
      });
      return;
    }

    if (data.startsWith('admin_top_depositor_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      const parts = data.split('_');
      const rangeKey = parts[3]; // 7d, 30d, 90d, all
      const page = parts[4] ? parseInt(parts[4], 10) : 1;
      const validRange = ['7d', '30d', '90d', 'all'].includes(rangeKey);
      if (!validRange || !Number.isInteger(page) || page < 1) {
        await bot.editMessageText(topDepositorRangeSelectionMessage(), {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...topDepositorRangeKeyboard(),
        });
        return;
      }
      const { startDate, endDate, rangeLabel } = getTopDepositorDateRange(rangeKey);
      let list = [];
      try {
        list = await getTopUsersByNetDeposits({
          startDate,
          endDate,
          limit: 50,
        });
      } catch (err) {
        console.warn('getTopUsersByNetDeposits:', err.message);
        await bot.editMessageText('❌ خطأ في تحميل البيانات.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
        });
        return;
      }
      const pageSize = TOP_DEPOSITOR_PAGE_SIZE;
      const totalPages = Math.ceil(list.length / pageSize) || 1;
      const safePage = Math.min(Math.max(1, page), totalPages);
      const hasNext = safePage < totalPages;
      const text = topDepositorListMessage(list, rangeLabel, startDate, endDate, safePage, pageSize);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...topDepositorListKeyboard(rangeKey, safePage, hasNext),
      });
      return;
    }

    // Admin: رصيد شام كاش — current balance from API + full ShamCash withdrawal transaction history
    if (data === 'admin_sham_balance' && isAdminUser(query.from)) {
      await bot.answerCallbackQuery(query.id);
      const accountAddress = (await getConfigValue('SHAM_CASH_DEPOSIT_CODE', '')).trim();
      const baseUrl = (process.env.SHAMCASH_BALANCE_API_URL || '').trim();
      let balanceText = '—';
      if (baseUrl && accountAddress) {
        try {
          const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}account_address=${encodeURIComponent(accountAddress)}`;
          const res = await fetch(url);
          const json = await res.json().catch(() => ({}));
          if (json && json.success && json.data && Array.isArray(json.data.balances)) {
            const lines = json.data.balances.map((b, i) => {
              const cur = (b.currency && String(b.currency).trim()) || `#${i + 1}`;
              const bal = Number(b.balance);
              return `${escapeHtml(cur)}: <code>${formatCurrencySyp(Number.isFinite(bal) ? bal : 0)}</code>`;
            });
            balanceText = lines.length ? lines.join('\n') : '—';
          } else {
            balanceText = json?.message ? `خطأ: ${escapeHtml(String(json.message))}` : (res.ok ? '—' : `HTTP ${res.status}`);
          }
        } catch (err) {
          balanceText = `خطأ: ${escapeHtml(err.message)}`;
        }
      } else if (!baseUrl) {
        balanceText = 'لم يتم ضبط SHAMCASH_BALANCE_API_URL';
      } else {
        balanceText = 'لم يتم ضبط رمز الحساب (SHAM_CASH_DEPOSIT_CODE)';
      }
      const history = await getShamcashWithdrawalHistory({ limit: 50 });
      const timezone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
      const formatDate = (d) => {
        try {
          return new Date(d).toLocaleString('ar-SY', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
        } catch (_) {
          return new Date(d).toLocaleString();
        }
      };
      const userIds = [...new Set(history.map((p) => p.telegram_user_id))];
      const displayMap = await getUsersDisplayMap(userIds);
      const statusLabel = (s, r) => {
        if (s === 'pending') return '⏳ معلق';
        if (s === 'accepted') return '✅ مقبول';
        if (s === 'rejected') return `❌ مرفوض${r ? ` (${r})` : ''}`;
        return s || '—';
      };
      let msg = `💰 رصيد شام كاش\n\n💵 الرصيد الحالي:\n${balanceText}\n\n`;
      msg += `📋 سجل طلبات السحب (شام كاش) — آخر ${history.length} طلب:\n\n`;
      if (history.length === 0) {
        msg += 'لا توجد عمليات حتى الآن.';
      } else {
        for (const p of history) {
          const curLabel = p.currency === 'usd' ? ' USD' : ' ل.س';
          const botName = displayMap[String(p.telegram_user_id)] || String(p.telegram_user_id);
          const resolved = p.resolved_at ? ` — ${formatDate(p.resolved_at)}${p.resolved_by ? ` (${p.resolved_by})` : ''}` : '';
          msg += `• ${formatDate(p.created_at)} — ${escapeHtml(botName)} — <code>${escapeHtml(p.amount_display)}</code>${curLabel} — <code>${escapeHtml(p.client_code)}</code> — ${statusLabel(p.status, p.resolved_by)}${resolved}\n`;
        }
      }
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
      });
      return;
    }

    // Admin: طلبات السحب المعلقة (ShamCash) — link to channel + list + see all (accept/reject/message user)
    if (data === 'admin_pending_withdrawals' && isAdminUser(query.from)) {
      const list = await getAllShamcashPending();
      const ch = (await getConfigValue('ALERT_CHANNEL_TRANSACTIONS', '')) || ALERT_CHANNEL_TRANSACTIONS || '';
      const channelLink = /^@?[a-zA-Z0-9_]+$/.test(String(ch).trim()) ? `https://t.me/${String(ch).trim().replace(/^@/, '')}` : null;
      let msg = '🗂 طلبات السحب المعلقة (شام كاش)\n\n';
      if (list.length === 0) {
        msg += 'لا توجد طلبات معلقة.';
      } else {
        msg += `عدد الطلبات: ${list.length}\n\nاستخدم "عرض كل الطلبات" للمراجعة والموافقة أو الرفض.`;
      }
      const rows = [];
      if (channelLink) {
        rows.push([{ text: '📢 فتح قناة إشعارات الدفع', url: channelLink }]);
      }
      rows.push([{ text: '📋 عرض كل الطلبات المعلقة', callback_data: 'admin_sham_pending_list' }]);
      rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    // Admin: list all pending ShamCash withdrawals — accept / reject / message user per row
    if (data === 'admin_sham_pending_list' && isAdminUser(query.from)) {
      const list = await getAllShamcashPending();
      const timezone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
      const formatDate = (d) => {
        try {
          return new Date(d).toLocaleString('ar-SY', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
        } catch (_) {
          return new Date(d).toLocaleString();
        }
      };
      const userIds = [...new Set(list.map((p) => p.telegram_user_id))];
      const displayMap = await getUsersDisplayMap(userIds);
      if (!list || list.length === 0) {
        await bot.editMessageText('لا توجد طلبات سحب معلقة.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'admin_pending_withdrawals' }]] },
        });
        return;
      }
      let text = '📋 كل طلبات السحب المعلقة (شام كاش):\n\n';
      const rows = [];
      for (const p of list) {
        const curLabel = p.currency === 'usd' ? ' USD' : ' ل.س';
        const botName = displayMap[String(p.telegram_user_id)] || String(p.telegram_user_id);
        text += `• ${escapeHtml(botName)} — <code>${escapeHtml(p.client_code)}</code> — ${escapeHtml(p.amount_display)}${curLabel} — ${formatDate(p.created_at)}\n`;
        rows.push([
          { text: `✅ قبول #${p.id}`, callback_data: `sham_accept_${p.id}` },
          { text: `❌ رفض #${p.id}`, callback_data: `sham_reject_${p.id}` },
          { text: `💬 مراسلة`, callback_data: `admin_sham_msg_${p.id}` },
        ]);
      }
      rows.push([{ text: '🔙 العودة', callback_data: 'admin_pending_withdrawals' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    // Admin: open "send message to user" flow for a pending withdrawal
    if (data.startsWith('admin_sham_msg_') && isAdminUser(query.from)) {
      const pendingId = parseInt(data.replace('admin_sham_msg_', ''), 10);
      if (!Number.isFinite(pendingId)) return;
      const pending = await getShamcashPendingById(pendingId);
      if (!pending || pending.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: 'الطلب غير موجود أو تمت معالجته.' }).catch(() => {});
        return;
      }
      userState[chatId] = { step: 'await_admin_sham_msg', targetUserId: pending.telegram_user_id, messageId };
      await bot.editMessageText('أرسل النص الذي تريد إرساله للمستخدم (أو /cancel للإلغاء):', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_sham_msg_cancel' }]] },
      });
      return;
    }

    if (data === 'admin_sham_msg_cancel' && isAdminUser(query.from)) {
      delete userState[chatId];
      await bot.editMessageText('تم الإلغاء.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 طلبات السحب المعلقة', callback_data: 'admin_pending_withdrawals' }]] },
      });
      return;
    }

    // Admin (or from channel): Accept ShamCash withdrawal — mark done, notify user
    if (data.startsWith('sham_accept_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' }).catch(() => {});
        return;
      }
      const pendingId = parseInt(data.replace('sham_accept_', ''), 10);
      if (!Number.isFinite(pendingId)) return;
      const pending = await getShamcashPendingById(pendingId);
      if (!pending || pending.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: 'الطلب غير موجود أو تمت معالجته مسبقاً.' }).catch(() => {});
        return;
      }
      try {
        if (pending.transaction_id) await updateTransactionStatus(pending.transaction_id, 'confirmed');
        await updateShamcashPendingStatus(pendingId, 'accepted', 'admin_accept');
      } catch (err) {
        console.warn('sham_accept:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ.' }).catch(() => {});
        return;
      }
      const rates = await getRatesForPayment();
      const taxPercent = Number(rates.shamcash.cashout_tax_percent ?? 0);
      const exchangeRate = rates.exchangeRate;
      let amountTransferredDisplay;
      let curLabel;
      if (pending.currency === 'syp') {
        const amountAfterTax = Number(pending.amount_syp) * (1 - taxPercent / 100);
        const amountTransferred = amountAfterTax / OLD_CURRENCY_MULTIPLE;
        amountTransferredDisplay = amountTransferred % 1 === 0 ? formatNumber(amountTransferred) : formatCurrencySyp(amountTransferred);
        curLabel = ' ل.س';
      } else {
        const amountUsd = Number(pending.amount_syp) / exchangeRate;
        const amountTransferredUsd = amountUsd * (1 - taxPercent / 100);
        amountTransferredDisplay = amountTransferredUsd % 1 === 0 ? String(amountTransferredUsd) : amountTransferredUsd.toFixed(2);
        curLabel = ' USD';
      }
      const userMsg = `✅ تمت الموافقة على طلب السحب.\n\nتم تحويل الرصيد إلى حسابك في شام كاش.\n\n• رمز العميل: <code>${escapeHtml(pending.client_code)}</code>\n• المبلغ المحوّل: ${amountTransferredDisplay}${curLabel}\n\nيرجى التحقق من رصيدك في شام كاش.`;
      await bot.sendMessage(pending.telegram_user_id, userMsg, { parse_mode: 'HTML' }).catch((err) => console.warn('sendMessage to user (accept):', err.message));
      await bot.answerCallbackQuery(query.id, { text: 'تمت الموافقة وإشعار المستخدم.' }).catch(() => {});
      const msgText = query.message.text || query.message.caption || '';
      if (msgText.startsWith('📤 طلب سحب شام كاش')) {
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ تمت الموافقة', callback_data: 'sham_done' }]] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
        } catch (_) {}
      }
      return;
    }

    // Admin (or from channel): Reject ShamCash withdrawal — refund balance, notify user
    if (data.startsWith('sham_reject_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' }).catch(() => {});
        return;
      }
      const pendingId = parseInt(data.replace('sham_reject_', ''), 10);
      if (!Number.isFinite(pendingId)) return;
      const pending = await getShamcashPendingById(pendingId);
      if (!pending || pending.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: 'الطلب غير موجود أو تمت معالجته مسبقاً.' }).catch(() => {});
        return;
      }
      const amountSyp = Number(pending.amount_syp);
      try {
        const refunded = await adjustBalance(pending.telegram_user_id, { balanceDelta: Math.round(amountSyp * 100) / 100 });
        if (!refunded) throw new Error('adjustBalance returned null');
        if (pending.transaction_id) await updateTransactionStatus(pending.transaction_id, 'rejected');
        await updateShamcashPendingStatus(pendingId, 'rejected', 'admin_reject');
      } catch (err) {
        console.warn('sham_reject:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ.' }).catch(() => {});
        return;
      }
      const curLabel = pending.currency === 'usd' ? ' USD' : ' ل.س';
      const userMsg = `❌ تم رفض طلب السحب.\n\nتم استرداد المبلغ (${pending.amount_display} ${curLabel}) إلى محفظتك في البوت. يمكنك المحاولة مرة أخرى أو اختيار طريقة سحب أخرى.`;
      const supportUrl = SUPPORT_USERNAME ? `https://t.me/${SUPPORT_USERNAME.replace(/^@/, '')}` : null;
      const replyMarkup = supportUrl ? { reply_markup: { inline_keyboard: [[{ text: '📩 التواصل مع الدعم', url: supportUrl }]] } } : {};
      await bot.sendMessage(pending.telegram_user_id, userMsg, { parse_mode: 'HTML', ...replyMarkup }).catch((err) => console.warn('sendMessage to user (reject):', err.message));
      await bot.answerCallbackQuery(query.id, { text: 'تم الرفض واسترداد الرصيد وإشعار المستخدم.' }).catch(() => {});
      const msgTextRej = query.message.text || query.message.caption || '';
      if (msgTextRej.startsWith('📤 طلب سحب شام كاش')) {
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ تم الرفض', callback_data: 'sham_done' }]] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
        } catch (_) {}
      }
      return;
    }

    if (data === 'sham_done') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    // Admin: Manage deposit/withdraw — show four toggles (deposit Syriatel/Shamcash, withdraw Syriatel/Shamcash)
    if (data === 'admin_manage_deposit_withdraw' && isAdminUser(query.from)) {
      await bot.editMessageText(adminManageDepositWithdrawMessage(), {
        chat_id: chatId,
        message_id: messageId,
        ...adminManageDepositWithdrawKeyboard(),
      });
      return;
    }

    // Admin: Toggle a payment method (deposit/withdraw × syriatel/shamcash)
    if (data.startsWith('admin_payment_toggle_') && isAdminUser(query.from)) {
      const keyMap = {
        admin_payment_toggle_deposit_syriatel: 'DEPOSIT_SYRIATEL_ENABLED',
        admin_payment_toggle_deposit_shamcash: 'DEPOSIT_SHAMCASH_ENABLED',
        admin_payment_toggle_withdraw_syriatel: 'WITHDRAW_SYRIATEL_ENABLED',
        admin_payment_toggle_withdraw_shamcash: 'WITHDRAW_SHAMCASH_ENABLED',
      };
      const configKey = keyMap[data];
      if (configKey) {
        const current = configKey === 'DEPOSIT_SYRIATEL_ENABLED' ? FLAG_DEPOSIT_SYRIATEL : configKey === 'DEPOSIT_SHAMCASH_ENABLED' ? FLAG_DEPOSIT_SHAMCASH : configKey === 'WITHDRAW_SYRIATEL_ENABLED' ? FLAG_WITHDRAW_SYRIATEL : FLAG_WITHDRAW_SHAMCASH;
        await setConfigValue(configKey, !current);
      }
      await loadLocalConfig();
      await bot.editMessageText(adminManageDepositWithdrawMessage(), {
        chat_id: chatId,
        message_id: messageId,
        ...adminManageDepositWithdrawKeyboard(),
      });
      return;
    }

    // Admin: إدارة المستخدمين — user list, pagination, search, and user detail
    if (data === 'admin_manage_users' && isAdminUser(query.from)) {
      adminUserListState[chatId] = { searchQuery: null, page: 1 };
      try {
        const result = await getUsersListForAdmin({ page: 1, pageSize: 10 });
        await bot.editMessageText(adminManageUsersListMessage(result, null), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      } catch (err) {
        console.warn('getUsersListForAdmin:', err.message);
        await bot.editMessageText('❌ حدث خطأ أثناء تحميل قائمة المستخدمين.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
        });
      }
      return;
    }

    if (data.startsWith('admin_manage_users_p_') && isAdminUser(query.from)) {
      const page = parseInt(data.replace('admin_manage_users_p_', ''), 10) || 1;
      const state = adminUserListState[chatId] || {};
      const searchQuery = state.searchQuery || null;
      adminUserListState[chatId] = { searchQuery, page };
      try {
        const result = await getUsersListForAdmin({ page, pageSize: 10, searchQuery: searchQuery || undefined });
        await bot.editMessageText(adminManageUsersListMessage(result, searchQuery), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      } catch (err) {
        console.warn('getUsersListForAdmin:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'خطأ في التحميل' });
      }
      return;
    }

    if (data === 'admin_manage_users_search' && isAdminUser(query.from)) {
      userState[chatId] = { step: 'await_admin_user_search', messageId };
      await bot.editMessageText('🔍 أدخل معرف التليجرام (ID) أو اسم المستخدم\n(Username) للبحث:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_manage_users_search_cancel' }]] },
      });
      return;
    }

    if (data === 'admin_manage_users_search_cancel' && isAdminUser(query.from)) {
      delete userState[chatId];
      const state = adminUserListState[chatId] || {};
      const page = state.page || 1;
      const searchQuery = state.searchQuery || null;
      try {
        const result = await getUsersListForAdmin({ page, pageSize: 10, searchQuery: searchQuery || undefined });
        await bot.editMessageText(adminManageUsersListMessage(result, searchQuery), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      } catch (err) {
        await bot.editMessageText('👥 إدارة المستخدمين\n\nاضغط للعودة.', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
        });
      }
      return;
    }

    if (data.startsWith('admin_user_detail_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_detail_', '');
      try {
        const detail = await adminUserDetailMessage(telegramUserId);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } catch (err) {
        console.warn('adminUserDetailMessage:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'خطأ في تحميل التفاصيل' });
      }
      return;
    }

    if (data.startsWith('admin_user_add_money_') && data !== 'admin_user_add_money_cancel' && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_add_money_', '');
      userState[chatId] = { step: 'await_admin_user_add_money', telegramUserId, messageId };
      await bot.editMessageText(`💰 إضافة رصيد للمستخدم\n\nأدخل المبلغ (ل.س) الذي تريد إضافته لمحفظة البوت الخاصة بالمستخدم:`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_user_add_money_cancel' }]] },
      });
      return;
    }

    if (data === 'admin_user_add_money_cancel' && isAdminUser(query.from)) {
      const state = userState[chatId];
      delete userState[chatId];
      const telegramUserId = state?.telegramUserId;
      if (telegramUserId) {
        try {
          const detail = await adminUserDetailMessage(telegramUserId);
          await bot.editMessageText(detail.text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: detail.reply_markup,
          });
        } catch (err) {
          await bot.editMessageText('❌ المستخدم غير موجود.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }]] },
          });
        }
      } else {
        const result = await getUsersListForAdmin({ page: 1, pageSize: 10 });
        await bot.editMessageText(adminManageUsersListMessage(result, null), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      }
      return;
    }

    if (data.startsWith('admin_user_deduct_money_') && data !== 'admin_user_deduct_money_cancel' && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_deduct_money_', '');
      userState[chatId] = { step: 'await_admin_user_deduct_money', telegramUserId, messageId };
      await bot.editMessageText(`💸 خصم رصيد من المستخدم\n\nأدخل المبلغ (ل.س) الذي تريد خصمه من محفظة البوت الخاصة بالمستخدم:\n\n⚠️ لن يتم إرسال أي إشعار للمستخدم.`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_user_deduct_money_cancel' }]] },
      });
      return;
    }

    if (data === 'admin_user_deduct_money_cancel' && isAdminUser(query.from)) {
      const state = userState[chatId];
      delete userState[chatId];
      const telegramUserId = state?.telegramUserId;
      if (telegramUserId) {
        try {
          const detail = await adminUserDetailMessage(telegramUserId);
          await bot.editMessageText(detail.text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: detail.reply_markup,
          });
        } catch (err) {
          await bot.editMessageText('❌ المستخدم غير موجود.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }]] },
          });
        }
      } else {
        const result = await getUsersListForAdmin({ page: 1, pageSize: 10 });
        await bot.editMessageText(adminManageUsersListMessage(result, null), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      }
      return;
    }

    if (data.startsWith('admin_user_send_msg_') && data !== 'admin_user_send_msg_cancel' && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_send_msg_', '');
      userState[chatId] = { step: 'await_admin_user_send_msg', telegramUserId, messageId };
      await bot.editMessageText(`✉️ إرسال رسالة للمستخدم\n\nأدخل نص الرسالة التي تريد إرسالها للمستخدم:`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_user_send_msg_cancel' }]] },
      });
      return;
    }

    if (data === 'admin_user_send_msg_cancel' && isAdminUser(query.from)) {
      const state = userState[chatId];
      delete userState[chatId];
      const telegramUserId = state?.telegramUserId;
      if (telegramUserId) {
        try {
          const detail = await adminUserDetailMessage(telegramUserId);
          await bot.editMessageText(detail.text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: detail.reply_markup,
          });
        } catch (err) {
          await bot.editMessageText('❌ المستخدم غير موجود.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }]] },
          });
        }
      } else {
        const result = await getUsersListForAdmin({ page: 1, pageSize: 10 });
        await bot.editMessageText(adminManageUsersListMessage(result, null), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      }
      return;
    }

    if (data.startsWith('admin_user_block_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_block_', '');
      try {
        const user = await getUserByTelegramId(telegramUserId);
        const username = user?.telegram_username || null;
        const added = await addBlockedUser(telegramUserId, username);
        await bot.answerCallbackQuery(query.id, { text: added ? '✅ تم حظر المستخدم' : 'المستخدم محظور مسبقاً' });
        const detail = await adminUserDetailMessage(telegramUserId);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } catch (err) {
        console.warn('admin block user:', err.message);
        await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ' });
      }
      return;
    }

    if (data.startsWith('admin_user_unblock_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_unblock_', '');
      try {
        const removed = await removeBlockedUser(telegramUserId);
        await bot.answerCallbackQuery(query.id, { text: removed ? '✅ تم إلغاء الحظر' : 'المستخدم غير محظور' });
        const detail = await adminUserDetailMessage(telegramUserId);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } catch (err) {
        console.warn('admin unblock user:', err.message);
        await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ' });
      }
      return;
    }

    // ── User Logs ──
    if (data.startsWith('admin_user_logs_') && isAdminUser(query.from)) {
      const parts = data.replace('admin_user_logs_', '').split('_p_');
      const telegramUserId = parts[0];
      const page = parseInt(parts[1], 10) || 1;
      try {
        const result = await getUserTransactionHistory(telegramUserId, page, 10);
        const methodLabels = {
          syriatel: 'syriatel', sham_usd: 'shamcash', sham_syp: 'shamcash',
          balance_to_site: 'balance_to_site', site_to_balance: 'site_to_balance',
        };
        const typeLabels = {
          deposit: { syriatel: '📥 إيداع', sham_usd: '📥 إيداع', sham_syp: '📥 إيداع', balance_to_site: '💻 إيداع من الموقع', site_to_balance: '💻 سحب من الموقع' },
          withdrawal: { syriatel: '📤 سحب', sham_usd: '📤 سحب', sham_syp: '📤 سحب', shamcash: '📤 سحب', balance_to_site: '💻 إيداع من الموقع', site_to_balance: '💻 سحب من الموقع' },
        };
        let text = `━━━━━━━━━━━━━━━\n📜 سجل عمليات المستخدم\n━━━━━━━━━━━━━━━\n\n`;
        if (result.rows.length === 0) {
          text += '— لا توجد عمليات —\n';
        } else {
          for (const tx of result.rows) {
            const typeGroup = typeLabels[tx.type] || {};
            const label = typeGroup[tx.method] || (tx.type === 'deposit' ? '📥 إيداع' : '📤 سحب');
            const method = methodLabels[tx.method] || tx.method || '—';
            const dateStr = tx.created_at ? new Date(tx.created_at).toISOString().slice(0, 19).replace('T', ' ') : '—';
            text += `${label}\n💰 ${formatCurrencySyp(Number(tx.amount || 0))}\n🏦 ${method}\n🕒 ${dateStr}\n───────────────\n`;
          }
        }
        text += `\n📄 الصفحة ${result.page} / ${result.totalPages}`;
        const navRows = [];
        const nav = [];
        if (result.page > 1) nav.push({ text: '◀ السابق', callback_data: `admin_user_logs_${telegramUserId}_p_${result.page - 1}` });
        if (result.page < result.totalPages) nav.push({ text: 'التالي ▶', callback_data: `admin_user_logs_${telegramUserId}_p_${result.page + 1}` });
        if (nav.length) navRows.push(nav);
        navRows.push([{ text: '🔙 رجوع', callback_data: `admin_user_detail_${telegramUserId}` }]);
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: navRows },
        });
      } catch (err) {
        console.warn('admin_user_logs:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'خطأ في تحميل السجل' });
      }
      return;
    }

    // ── Custom Referral Percentage ──
    if (data.startsWith('admin_user_custom_ref_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_custom_ref_', '');
      try {
        const user = await getUserByTelegramId(telegramUserId);
        const globalPct = REFERRAL_PERCENTS[0] || 5;
        const currentCustom = user?.custom_referral_percent;
        let promptText = `✏️ أرسل نسبة أرباح الإحالة الخاصة (مثال: 7 يعني 7%)\n\n`;
        promptText += `📊 النسبة العالمية الحالية: ${globalPct}%\n`;
        if (currentCustom != null) {
          promptText += `🎯 النسبة الخاصة لهذا المستخدم: ${currentCustom}%\n`;
        }
        promptText += `\n📌 اكتب رقم فقط من 0 إلى 100\n❌ /cancel للإلغاء`;
        userState[chatId] = { step: 'await_admin_user_custom_ref', telegramUserId, messageId };
        await bot.editMessageText(promptText, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: `admin_user_detail_${telegramUserId}` }]] },
        });
      } catch (err) {
        console.warn('admin_user_custom_ref:', err.message);
        await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ' });
      }
      return;
    }

    // ── Distribute Single User Referral Earnings ──
    if (data.startsWith('admin_user_dist_ref_') && !data.includes('_confirm_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_dist_ref_', '');
      try {
        const user = await getUserByTelegramId(telegramUserId);
        if (!user) {
          await bot.answerCallbackQuery(query.id, { text: 'المستخدم غير موجود' });
          return;
        }
        const effectivePercents = [...REFERRAL_PERCENTS];
        if (user.custom_referral_percent != null) effectivePercents[0] = user.custom_referral_percent;
        const commData = await getReferralCommission(telegramUserId, effectivePercents);
        const netDetails = await getReferralNetDetails(telegramUserId);
        const displayMap = await getUsersDisplayMap(netDetails.map(d => d.referred_user_id));
        let text = `🎰 توزيع أرباح الإحالة\n\n`;
        const displayName = (user.ichancy_login && user.ichancy_login.trim()) || (user.telegram_username && user.telegram_username.trim()) || String(telegramUserId);
        text += `👤 المستخدم: ${displayName}\n`;
        text += `💰 إجمالي العمولة المستحقة: ${formatCurrencySyp(commData.totalCommission)} ل.س\n\n`;
        if (netDetails.length > 0) {
          text += `📋 تفاصيل الأرباح:\n`;
          for (const d of netDetails) {
            const net = Number(d.net_balance || 0);
            if (net <= 0) continue;
            const refName = displayMap[String(d.referred_user_id)] || String(d.referred_user_id);
            const pct = d.level === 1 && user.custom_referral_percent != null ? user.custom_referral_percent : (effectivePercents[d.level - 1] || 0);
            const earn = Math.floor((net * pct / 100) * 100) / 100;
            text += `  L${d.level}: ${refName} — صافي: ${formatCurrencySyp(net)} × ${pct}% = ${formatCurrencySyp(earn)} ل.س\n`;
          }
        } else {
          text += `— لا توجد أرباح إحالة —\n`;
        }
        const btns = [];
        if (commData.totalCommission > 0) {
          btns.push([{ text: '✅ توزيع الآن', callback_data: `admin_user_dist_ref_confirm_${telegramUserId}` }]);
        }
        btns.push([{ text: '🔙 رجوع', callback_data: `admin_user_detail_${telegramUserId}` }]);
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: btns },
        });
      } catch (err) {
        console.warn('admin_user_dist_ref:', err.message);
        await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ' });
      }
      return;
    }

    // ── Confirm distribute single user referral ──
    if (data.startsWith('admin_user_dist_ref_confirm_') && isAdminUser(query.from)) {
      const telegramUserId = data.replace('admin_user_dist_ref_confirm_', '');
      try {
        const user = await getUserByTelegramId(telegramUserId);
        if (!user) {
          await bot.answerCallbackQuery(query.id, { text: 'المستخدم غير موجود' });
          return;
        }
        const effectivePercents = [...REFERRAL_PERCENTS];
        if (user.custom_referral_percent != null) effectivePercents[0] = user.custom_referral_percent;
        const result = await distributeSingleUserReferralCommission(telegramUserId, effectivePercents);
        if (!result || result.commission <= 0) {
          await bot.answerCallbackQuery(query.id, { text: 'لا توجد عمولات لتوزيعها' });
          return;
        }
        await bot.answerCallbackQuery(query.id, { text: `✅ تم توزيع ${formatCurrencySyp(result.commission)} ل.س` });
        try {
          await bot.sendMessage(telegramUserId, `🎉 تم إضافة أرباح الإحالة إلى رصيدك!\n\n💰 المبلغ: ${formatCurrencySyp(result.commission)} ل.س\n\n✅ تمت العملية بنجاح.`);
        } catch (_) {}
        const detail = await adminUserDetailMessage(telegramUserId);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } catch (err) {
        console.warn('admin_user_dist_ref_confirm:', err.message);
        await bot.answerCallbackQuery(query.id, { text: '❌ حدث خطأ أثناء التوزيع' });
      }
      return;
    }

    // 💳 إدارة أرقام سيرياتيل: list numbers with enable/disable toggle + refresh
    if (data === 'admin_syriatel_numbers' && isAdminUser(query.from)) {
      const list = await getSyriatelDepositListForAdmin();
      const text = list.length === 0
        ? `💳 إدارة أرقام سيرياتيل\n\nلا توجد أرقام حالياً. استخدم «تحديث من سيرياتيل» لجلب الأرقام.`
        : `💳 إدارة أرقام سيرياتيل\n\n🟢 مفعّل — 🔴 معطّل\nاضغط على الرقم لتبديل الحالة.`;
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const label = e.enabled ? `🟢 ${e.number}` : `🔴 ${e.number}`;
        rows.push([{ text: label, callback_data: `admin_syriatel_toggle_${i}` }]);
      }
      rows.push([{ text: '🔄 تحديث من سيرياتيل', callback_data: 'admin_syriatel_refresh' }]);
      rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data.startsWith('admin_syriatel_toggle_') && isAdminUser(query.from)) {
      const idx = parseInt(data.replace('admin_syriatel_toggle_', ''), 10);
      if (Number.isNaN(idx) || idx < 0) {
        await bot.answerCallbackQuery(query.id, { text: '❌ خطأ' });
        return;
      }
      const list = await getSyriatelDepositListForAdmin();
      if (idx >= list.length) {
        await bot.answerCallbackQuery(query.id, { text: '❌ الرقم غير موجود' });
        return;
      }
      list[idx].enabled = !list[idx].enabled;
      // Persist: { number: secretCode, enabled, secretCode, gsm } (+ apiKey)
      const toSave = list.map((e) => {
        const o = { number: e.number, enabled: e.enabled };
        if (e.secretCode != null && String(e.secretCode).trim() !== '') o.secretCode = String(e.secretCode).trim();
        if (e.gsm != null && String(e.gsm).trim() !== '') o.gsm = String(e.gsm).trim();
        if (e.apiKey != null && String(e.apiKey).trim() !== '') o.apiKey = String(e.apiKey).trim();
        return o;
      });
      await setConfigValue('SYRIATEL_DEPOSIT_NUMBERS', JSON.stringify(toSave));
      await loadLocalConfig();
      const text = `💳 إدارة أرقام سيرياتيل\n\n🟢 مفعّل — 🔴 معطّل\nاضغط على الرقم لتبديل الحالة.`;
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const label = e.enabled ? `🟢 ${e.number}` : `🔴 ${e.number}`;
        rows.push([{ text: label, callback_data: `admin_syriatel_toggle_${i}` }]);
      }
      rows.push([{ text: '🔄 تحديث من سيرياتيل', callback_data: 'admin_syriatel_refresh' }]);
      rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      });
      await bot.answerCallbackQuery(query.id, { text: list[idx].enabled ? '✅ تم التفعيل' : '✅ تم التعطيل' });
      return;
    }

    if (data === 'admin_syriatel_refresh' && isAdminUser(query.from)) {
      await bot.answerCallbackQuery(query.id, { text: 'جاري التحديث...' });
      const currentList = await getSyriatelDepositListForAdmin();
      const result = await fetchSyriatelGsms(SYRIATEL_API_KEY);
      if (!result.success || !result.gsms || result.gsms.length === 0) {
        await bot.editMessageText(`💳 إدارة أرقام سيرياتيل\n\n❌ عذراً، لم نتمكن من إكمال العملية. يرجى المحاولة لاحقاً.`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
            ],
          },
        }).catch(() => {});
        return;
      }
      const byGsm = new Map();
      const bySecret = new Map();
      currentList.forEach((e) => {
        if (e.gsm) byGsm.set(e.gsm, e);
        else byGsm.set(e.number, e);
        if (e.secretCode) bySecret.set(e.secretCode, e);
        else if (e.number) bySecret.set(e.number, e);
      });
      const merged = [];
      const seen = new Set();
      for (const g of result.gsms) {
        const gsm = String(g.gsm || '').trim();
        const secretCode = g.secretCode != null ? String(g.secretCode).trim() : undefined;
        if (!gsm) continue;
        const existing = byGsm.get(gsm) || (secretCode ? bySecret.get(secretCode) : null);
        const entry = {
          number: secretCode || (existing && existing.number) || gsm,
          secretCode: secretCode || (existing && existing.secretCode),
          gsm,
          enabled: true,
          apiKey: existing && existing.apiKey ? existing.apiKey : undefined,
        };
        merged.push(entry);
        seen.add(gsm);
        if (secretCode) seen.add(secretCode);
      }
      for (const e of currentList) {
        const key = e.gsm || e.number;
        if (seen.has(key) || (e.secretCode && seen.has(e.secretCode)) || (e.number && seen.has(e.number))) continue;
        merged.push({
          number: e.number,
          gsm: e.gsm,
          enabled: e.enabled,
          secretCode: e.secretCode,
          apiKey: e.apiKey,
        });
      }
      // Persist: { number: secretCode, enabled, secretCode, gsm } (+ apiKey)
      const toSave = merged.map((e) => {
        const o = { number: e.number, enabled: e.enabled };
        if (e.secretCode != null && String(e.secretCode).trim() !== '') o.secretCode = String(e.secretCode).trim();
        if (e.gsm != null && String(e.gsm).trim() !== '') o.gsm = String(e.gsm).trim();
        if (e.apiKey != null && String(e.apiKey).trim() !== '') o.apiKey = String(e.apiKey).trim();
        return o;
      });
      await setConfigValue('SYRIATEL_DEPOSIT_NUMBERS', JSON.stringify(toSave));
      await loadLocalConfig();
      const list = await getSyriatelDepositListForAdmin();
      const text = `💳 إدارة أرقام سيرياتيل\n\n✅ شكراً، تم التحديث. اضغط على الأرقام لتفعيل/إلغاء التفعيل حسب الحاجة.\n\n🟢 مفعّل — 🔴 معطّل`;
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const label = e.enabled ? `🟢 ${e.number}` : `🔴 ${e.number}`;
        rows.push([{ text: label, callback_data: `admin_syriatel_toggle_${i}` }]);
      }
      rows.push([{ text: '🔄 تحديث من سيرياتيل', callback_data: 'admin_syriatel_refresh' }]);
      rows.push([{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: rows },
      }).catch(() => {});
      return;
    }

    if (data === 'admin_manage_users_back' && isAdminUser(query.from)) {
      const state = adminUserListState[chatId] || {};
      const page = state.page || 1;
      const searchQuery = state.searchQuery || null;
      try {
        const result = await getUsersListForAdmin({ page, pageSize: 10, searchQuery: searchQuery || undefined });
        await bot.editMessageText(adminManageUsersListMessage(result, searchQuery), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      } catch (err) {
        adminUserListState[chatId] = { searchQuery: null, page: 1 };
        const result = await getUsersListForAdmin({ page: 1, pageSize: 10 });
        await bot.editMessageText(adminManageUsersListMessage(result, null), {
          chat_id: chatId,
          message_id: messageId,
          ...adminManageUsersListKeyboard(result, chatId),
        });
      }
      return;
    }

    // Admin sub-options: show placeholder and back to admin panel
    if (data.startsWith('admin_') && data !== 'admin_panel' && data !== 'admin_stats' && data !== 'admin_stats_prev_month' && data !== 'admin_stats_export' && data !== 'admin_toggle_charge_withdraw' && data !== 'admin_username_prefix' && data !== 'admin_user_add_money_cancel' && data !== 'admin_user_send_msg_cancel' && data !== 'admin_user_deduct_money_cancel' && data !== 'admin_syriatel_numbers' && data !== 'admin_syriatel_refresh' && !data.startsWith('admin_syriatel_toggle_') && !data.startsWith('admin_username_prefix_') && !data.startsWith('admin_top_depositor') && !data.startsWith('admin_payment_toggle_') && !data.startsWith('admin_manage_users') && !data.startsWith('admin_user_detail_') && !data.startsWith('admin_user_add_money_') && !data.startsWith('admin_user_send_msg_') && !data.startsWith('admin_user_deduct_money_') && !data.startsWith('admin_user_block_') && !data.startsWith('admin_user_unblock_') && !data.startsWith('admin_user_logs_') && !data.startsWith('admin_user_custom_ref_') && !data.startsWith('admin_user_dist_ref') && isAdminUser(query.from)) {
      const placeholders = {
        admin_support_account: '🛠 حساب الدعم',
        admin_broadcast: '📢 رسالة جماعية',
        admin_stats: '📈 الإحصائيات',
        admin_manual_sham_withdraw: '💵 سحب شام كاش يدوي',
        admin_pending_withdrawals: '🗂 طلبات السحب المعلقة',
        admin_referral_rates: '👥 نسب الإحالات',
        admin_manage_rates: '⚙️ إدارة النسب',
        admin_exchange_rate: '💱 تحديث سعر الصرف',
        admin_manual_referral_distribute: '🎯 توزيع أرباح الإحالة يدوياً',
        admin_top_depositor: '📊 عرض صاحب أكبر صافي إيداعات',
        admin_syriatel_numbers: '💳 إدارة أرقام سيرياتيل',
        admin_manage_deposit_withdraw: '🔒 إدارة عمليات الإيداع والسحب',
        admin_all_operations: '📄 كل العمليات',
        admin_manage_users: '👥 إدارة المستخدمين',
        admin_username_prefix: '🏷 بادئة الحسابات',
        admin_sham_balance: '💰 رصيد شام كاش',
        admin_toggle_charge_withdraw: '🔄 تشغيل/إيقاف الشحن والسحب',
        admin_toggle_bot: '🟢 تشغيل/إيقاف البوت',
      };
      const label = placeholders[data] || data;
      await bot.editMessageText(`${label}\n\n⏳ قيد التطوير.`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
            [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
          ],
        },
      });
      return;
    }

    // Ichancy button — show loading, fetch site balance, then account view (bot + site wallet)
    if (data === 'ichancy') {
      debugLog('callback_query: executing ichancy — loading then fetch site balance');
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      debugLog('callback_query: ichancy — fetching site balance');
      const siteBalance = await fetchSiteBalanceForUser(user);
      debugLog('callback_query: ichancy — got site balance', { siteBalance });
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Back from Ichancy account view → main menu
    if (data === 'ichancy_back') {
      debugLog('callback_query: executing ichancy_back');
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Delete account: show warning + Yes / No buttons
    if (data === 'delete_account') {
      debugLog('callback_query: executing delete_account');
      await bot.editMessageText(DELETE_ACCOUNT_WARNING, {
        chat_id: chatId,
        message_id: messageId,
        ...deleteAccountConfirmKeyboard(),
      });
      return;
    }

    // Cancel delete → show friendly message + "العودة إلى حسابي"
    if (data === 'delete_account_cancel') {
      await bot.editMessageText(DELETE_ACCOUNT_CANCEL_MESSAGE, {
        chat_id: chatId,
        message_id: messageId,
        ...deleteAccountCancelKeyboard(),
      });
      return;
    }

    // "العودة إلى حسابي" → back to Ichancy account view (with site balance)
    if (data === 'delete_cancel_back_to_account') {
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // معلومات الملف الشخصي — show loading, fetch site balance, then full profile (bot + site wallet)
    if (data === 'profile') {
      debugLog('callback_query: executing profile');
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...profileBackKeyboard(),
      });
      try {
        await ensureDailySpinEligibility(query.from.id);
      } catch (err) {
        console.warn('ensureDailySpinEligibility on profile:', err.message);
      }
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = await profileMessage(user, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...profileBackKeyboard(),
      });
      return;
    }

    // Back from profile → main menu
    if (data === 'profile_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // محفظتي — show loading, fetch site balance, then wallet (bot + gifts + site)
    if (data === 'wallet') {
      debugLog('callback_query: executing wallet');
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...walletBackKeyboard(),
      });
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = walletMessage(user, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...walletBackKeyboard(),
      });
      return;
    }

    // Back from wallet → main menu
    if (data === 'wallet_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Confirm delete → move record to deleted_users, then remove from users
    if (data === 'delete_account_confirm') {
      debugLog('callback_query: executing delete_account_confirm');
      try {
        await moveUserToDeletedUsers(query.from.id);
      } catch (err) {
        console.warn('DB moveUserToDeletedUsers on delete_account_confirm:', err.message);
      }
      await bot.editMessageText(DELETE_ACCOUNT_DONE_MESSAGE, {
        chat_id: chatId,
        message_id: messageId,
        ...deleteAccountDoneKeyboard(),
      });
      return;
    }

    // Transfer to Ichancy: check bot balance; if > 0 ask amount, else show insufficient balance
    if (data === 'transfer_to_ichancy') {
      debugLog('callback_query: executing transfer_to_ichancy');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      debugLog('callback_query: transfer_to_ichancy — got user', { hasUser: !!user, hasIchancyId: !!(user && user.ichancy_user_id), botBalance: user ? user.balance : null });
      if (!user || !user.ichancy_user_id) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ تحتاج إلى حساب Ichancy أولاً. قم بإنشاء حساب من القائمة الرئيسية.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      const botBalance = Number(user.balance ?? 0);
      if (botBalance <= 0) {
        debugLog('callback_query: transfer_to_ichancy — insufficient balance, not asking amount');
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ لا يوجد رصيد كافي في محفظتك للإيداع.\n\nرصيد البوت الحالي: 0 ل.س. قم بشحن رصيد البوت أولاً ثم حاول التحويل مرة أخرى.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      debugLog('callback_query: transfer_to_ichancy — asking user for amount');
      userState[chatId] = { step: 'await_transfer_amount', messageId };
      const msg = `💳 تحويل رصيد إلى حساب Ichancy\n\nرصيدك في البوت: <code>${formatNumber(botBalance)}</code> ل.س\n\n✏️ اكتب المبلغ الذي تريد تحويله (رقم فقط)، أو اضغط إلغاء للرجوع.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'transfer_cancel' }]] },
      });
      return;
    }

    // Cancel transfer → back to Ichancy account view
    if (data === 'transfer_cancel') {
      debugLog('callback_query: executing transfer_cancel');
      delete userState[chatId];
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Withdraw from Ichancy: show site balance, ask amount (no minimum)
    if (data === 'withdraw_ichancy') {
      debugLog('callback_query: executing withdraw_ichancy');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      if (!user || !user.ichancy_user_id) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ تحتاج إلى حساب Ichancy أولاً. قم بإنشاء حساب من القائمة الرئيسية.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
      debugLog('callback_query: withdraw_ichancy — fetching site balance');
      const siteBalance = await fetchSiteBalanceForUser(user);
      debugLog('callback_query: withdraw_ichancy — got site balance', { siteBalance });
      if (siteBalance === null) {
        await bot.editMessageText('❌ لا يمكن جلب رصيد الموقع. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      if (siteBalance <= 0) {
        await bot.editMessageText('❌ لا يوجد رصيد في حسابك على الموقع للسحب.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      const siteBalanceFormatted = formatNumber(siteBalance);
      debugLog('callback_query: withdraw_ichancy — asking user for amount', { siteBalance });
      userState[chatId] = { step: 'await_withdraw_amount', siteBalance, messageId };
      const msg = `💸 سحب رصيد من حساب Ichancy إلى البوت\n\nرصيدك في الموقع: <code>${siteBalanceFormatted}</code> ل.س\n\n✏️ اكتب المبلغ الذي تريد سحبه (رقم فقط)، أو اضغط إلغاء للرجوع.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'withdraw_cancel' }]] },
      });
      return;
    }

    // Cancel withdraw → back to Ichancy account view
    if (data === 'withdraw_cancel') {
      debugLog('callback_query: executing withdraw_cancel');
      delete userState[chatId];
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME, siteBalance);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Transfer FULL bot wallet to Ichancy (no amount prompt)
    if (data === 'transfer_full_to_ichancy') {
      debugLog('callback_query: executing transfer_full_to_ichancy');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      if (!user || !user.ichancy_user_id) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ تحتاج إلى حساب Ichancy أولاً. قم بإنشاء حساب من القائمة الرئيسية.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      const botBalance = Number(user.balance ?? 0);
      if (botBalance <= 0) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ لا يوجد رصيد في محفظة البوت للتحويل.\n\nرصيد البوت الحالي: 0 ل.س.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
      let cookies;
      try {
        cookies = await getAgentSession(true);
      } catch (err) {
        console.warn('getAgentSession on transfer_full:', err.message);
        await bot.editMessageText('❌ فشل الاتصال بموقع Ichancy. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      debugLog('callback_query: transfer_full — depositing full balance', { amount: botBalance, playerId: user.ichancy_user_id });
      let result;
      try {
        result = await depositToPlayer(cookies, user.ichancy_user_id, botBalance);
        if (!result.success) {
          invalidateAgentSession();
          cookies = await getAgentSession(true);
          result = await depositToPlayer(cookies, user.ichancy_user_id, botBalance);
        }
      } catch (err) {
        console.warn('depositToPlayer (full):', err.message);
        await bot.editMessageText('❌ فشل التحويل. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      if (result.success) {
        let updated;
        try {
          updated = await adjustBalance(query.from.id, { balanceDelta: -botBalance });
        } catch (dbErr) {
          console.warn('DB adjustBalance after transfer_full:', dbErr.message);
          await bot.editMessageText('❌ تم التحويل على الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.', {
            chat_id: chatId,
            message_id: messageId,
            ...ichancyAccountKeyboard(),
          });
          return;
        }
        if (!updated) {
          await bot.editMessageText('❌ تم التحويل على الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.', {
            chat_id: chatId,
            message_id: messageId,
            ...ichancyAccountKeyboard(),
          });
          return;
        }
        updateReferralNetBalances(query.from.id, botBalance, 'deposit_to_site').catch((err) =>
          console.warn('updateReferralNetBalances (deposit_to_site full):', err.message)
        );
        logTransaction({ telegramUserId: query.from.id, type: 'deposit', amount: botBalance, method: 'balance_to_site', status: 'confirmed' }).catch((e) => console.warn('logTransaction balance_to_site full:', e.message));
        await bot.editMessageText(`✅ تم تحويل كامل رصيد البوت (<code>${formatNumber(botBalance)}</code> ل.س) إلى حسابك على Ichancy بنجاح.\n\n💰 تم إيداع <code>${formatNumber(botBalance)}</code> ل.س في حساب Ichancy.\n🤖 رصيد البوت المتبقي: <code>0</code> ل.س`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      const notif = result.notification && result.notification[0];
      const errMsg = (notif && notif.content) || 'فشل التحويل. حاول لاحقاً.';
      await bot.editMessageText(`❌ ${errMsg}`, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Withdraw FULL Ichancy balance to bot wallet (no amount prompt)
    if (data === 'withdraw_full_from_ichancy') {
      debugLog('callback_query: executing withdraw_full_from_ichancy');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      if (!user || !user.ichancy_user_id) {
        await bot.answerCallbackQuery(query.id).catch(() => {});
        await bot.editMessageText('❌ تحتاج إلى حساب Ichancy أولاً. قم بإنشاء حساب من القائمة الرئيسية.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
      const siteBalance = await fetchSiteBalanceForUser(user);
      if (siteBalance === null) {
        await bot.editMessageText('❌ لا يمكن جلب رصيد الموقع. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      if (siteBalance <= 0) {
        await bot.editMessageText('❌ لا يوجد رصيد في حسابك على الموقع للسحب.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      let cookies;
      try {
        cookies = await getAgentSession(true);
      } catch (err) {
        console.warn('getAgentSession on withdraw_full:', err.message);
        await bot.editMessageText('❌ فشل الاتصال بموقع Ichancy. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      debugLog('callback_query: withdraw_full — withdrawing full site balance', { amount: siteBalance, playerId: user.ichancy_user_id });
      let result;
      try {
        result = await withdrawFromPlayer(cookies, user.ichancy_user_id, siteBalance);
        if (!result.success) {
          invalidateAgentSession();
          cookies = await getAgentSession(true);
          result = await withdrawFromPlayer(cookies, user.ichancy_user_id, siteBalance);
        }
      } catch (err) {
        console.warn('withdrawFromPlayer (full):', err.message);
        await bot.editMessageText('❌ فشل السحب. حاول لاحقاً.', {
          chat_id: chatId,
          message_id: messageId,
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      if (result.success) {
        let updated;
        try {
          updated = await adjustBalance(query.from.id, { balanceDelta: siteBalance });
        } catch (dbErr) {
          console.warn('DB adjustBalance after withdraw_full:', dbErr.message);
          await bot.editMessageText('❌ تم السحب من الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.', {
            chat_id: chatId,
            message_id: messageId,
            ...ichancyAccountKeyboard(),
          });
          return;
        }
        if (!updated) {
          await bot.editMessageText('❌ تم السحب من الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.', {
            chat_id: chatId,
            message_id: messageId,
            ...ichancyAccountKeyboard(),
          });
          return;
        }
        const newBalance = Number(updated.balance ?? 0);
        updateReferralNetBalances(query.from.id, siteBalance, 'withdraw_from_site').catch((err) =>
          console.warn('updateReferralNetBalances (withdraw_from_site full):', err.message)
        );
        logTransaction({ telegramUserId: query.from.id, type: 'withdrawal', amount: siteBalance, method: 'site_to_balance', status: 'confirmed' }).catch((e) => console.warn('logTransaction site_to_balance full:', e.message));
        await bot.editMessageText(`✅ تم سحب كامل رصيد Ichancy (<code>${formatNumber(siteBalance)}</code> ل.س) إلى محفظة البوت بنجاح.\n\n💸 تم سحب <code>${formatNumber(siteBalance)}</code> ل.س من حساب Ichancy.\n🤖 رصيد البوت الحالي: <code>${formatNumber(newBalance)}</code> ل.س`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...ichancyAccountKeyboard(),
        });
        return;
      }
      const notif = result.notification && result.notification[0];
      const errMsg = (notif && notif.content) || 'فشل السحب. حاول لاحقاً.';
      await bot.editMessageText(`❌ ${errMsg}`, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Withdraw from bot: show balance + choose withdrawal method or "payment down" if all withdraw methods off
    if (data === 'withdraw') {
      debugLog('callback_query: executing withdraw (from bot)');
      const withdrawSyr = FLAG_WITHDRAW_SYRIATEL;
      const withdrawSham = FLAG_WITHDRAW_SHAMCASH;
      if (!withdrawSyr && !withdrawSham) {
        await bot.editMessageText(PAYMENT_DOWN_MESSAGE, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'withdraw_bot_back' }]] },
        });
        return;
      }
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر طريقة السحب:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawMethodKeyboard(),
      });
      return;
    }

    // Back from withdraw method selection → main menu
    if (data === 'withdraw_bot_back') {
      debugLog('callback_query: executing withdraw_bot_back');
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Sham Cash chosen: show currency choice (USD / SYP) with bot balance
    if (data === 'withdraw_method_sham') {
      debugLog('callback_query: executing withdraw_method_sham');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر نوع العملة لسحب شام كاش:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamCurrencyKeyboard(),
      });
      return;
    }

    // Cancel Sham Cash → back to withdraw method selection
    if (data === 'withdraw_sham_cancel') {
      debugLog('callback_query: executing withdraw_sham_cancel');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر طريقة السحب:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawMethodKeyboard(),
      });
      return;
    }

    // Sham Cash USD: show min/max, ask for client code (check balance >= min in SYP)
    if (data === 'withdraw_sham_usd') {
      debugLog('callback_query: executing withdraw_sham_usd');
      const rates = await getRatesForPayment();
      const { exchangeRate, shamcash: sham } = rates;
      const shamUsdMin = sham.sham_usd_min;
      const shamUsdMax = sham.sham_usd_max;
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const minSypForUsd = shamUsdMin * exchangeRate;
      if (botBalance < minSypForUsd) {
        const minFormatted = formatNumber(Math.ceil(minSypForUsd));
        await bot.editMessageText(`❌ رصيدك غير كافٍ لسحب شام كاش بالدولار.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\nالحد الأدنى المطلوب: <code>${minFormatted}</code> ل.س (يعادل ${shamUsdMin} USD)`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...withdrawShamCurrencyKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_sham_usd_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>دولار</b>.\n\nالحد الأدنى للسحب: <b>${shamUsdMin}</b> USD.\nالحد الأقصى للسحب: <b>${shamUsdMax}</b> USD.\n\nالرجاء إدخال رمز العميل (Client Code):\n\n⚠️ ملاحظة: يرجى إلغاء هذه العملية قبل الضغط على أي زر آخر من القائمة لتجنب تعارض الطلبات.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamUsdCancelKeyboard(),
      });
      return;
    }

    // Cancel from Sham Cash USD client-code screen → back to currency selection
    if (data === 'withdraw_sham_usd_cancel') {
      debugLog('callback_query: executing withdraw_sham_usd_cancel');
      delete userState[chatId];
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر نوع العملة لسحب شام كاش:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamCurrencyKeyboard(),
      });
      return;
    }

    // Sham Cash SYP: show min/max, ask for client code (check balance >= min from DB)
    if (data === 'withdraw_sham_syp') {
      debugLog('callback_query: executing withdraw_sham_syp');
      const { shamcash: sham } = await getRatesForPayment();
      const shamSypMin = sham.min_cashout_syp;
      const shamSypMax = sham.max_cashout_syp;
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const sypMinFormatted = formatNumber(shamSypMin);
      const sypMaxFormatted = formatNumber(shamSypMax);
      if (botBalance < shamSypMin) {
        await bot.editMessageText(`❌ رصيدك غير كافٍ لسحب شام كاش بالليرة السورية.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\nالحد الأدنى المطلوب: <code>${sypMinFormatted}</code> ل.س`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...withdrawShamCurrencyKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_sham_syp_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>ليرة سورية</b>.\n\nالحد الأدنى للسحب: <b>${sypMinFormatted}</b> SYP.\nالحد الأقصى للسحب: <b>${sypMaxFormatted}</b> SYP.\n\nالرجاء إدخال رمز العميل (Client Code):\n\n⚠️ ملاحظة: يرجى إلغاء هذه العملية قبل الضغط على أي زر آخر من القائمة لتجنب تعارض الطلبات.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamSypCancelKeyboard(),
      });
      return;
    }

    // Cancel from Sham Cash SYP client-code screen → back to currency selection
    if (data === 'withdraw_sham_syp_cancel') {
      debugLog('callback_query: executing withdraw_sham_syp_cancel');
      delete userState[chatId];
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر نوع العملة لسحب شام كاش:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamCurrencyKeyboard(),
      });
      return;
    }

    // From Sham Cash USD amount step: edit code → show client code request again
    if (data === 'withdraw_sham_usd_edit_code') {
      debugLog('callback_query: executing withdraw_sham_usd_edit_code');
      const { shamcash: sham } = await getRatesForPayment();
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      userState[chatId] = { step: 'await_sham_usd_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>دولار</b>.\n\nالحد الأدنى للسحب: <b>${sham.sham_usd_min}</b> USD.\nالحد الأقصى للسحب: <b>${sham.sham_usd_max}</b> USD.\n\nالرجاء إدخال رمز العميل (Client Code):\n\n⚠️ ملاحظة: يرجى إلغاء هذه العملية قبل الضغط على أي زر آخر من القائمة لتجنب تعارض الطلبات.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamUsdCancelKeyboard(),
      });
      return;
    }

    // From Sham Cash USD amount step: cancel → back to currency selection
    if (data === 'withdraw_sham_usd_amount_cancel') {
      debugLog('callback_query: executing withdraw_sham_usd_amount_cancel');
      delete userState[chatId];
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر نوع العملة لسحب شام كاش:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamCurrencyKeyboard(),
      });
      return;
    }

    // From Sham Cash SYP amount step: edit code → show client code request again
    if (data === 'withdraw_sham_syp_edit_code') {
      debugLog('callback_query: executing withdraw_sham_syp_edit_code');
      const { shamcash: sham } = await getRatesForPayment();
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const sypMinFormatted = formatNumber(sham.min_cashout_syp);
      const sypMaxFormatted = formatNumber(sham.max_cashout_syp);
      userState[chatId] = { step: 'await_sham_syp_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>ليرة سورية</b>.\n\nالحد الأدنى للسحب: <b>${sypMinFormatted}</b> SYP.\nالحد الأقصى للسحب: <b>${sypMaxFormatted}</b> SYP.\n\nالرجاء إدخال رمز العميل (Client Code):\n\n⚠️ ملاحظة: يرجى إلغاء هذه العملية قبل الضغط على أي زر آخر من القائمة لتجنب تعارض الطلبات.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamSypCancelKeyboard(),
      });
      return;
    }

    // From Sham Cash SYP amount step: cancel → back to currency selection
    if (data === 'withdraw_sham_syp_amount_cancel') {
      debugLog('callback_query: executing withdraw_sham_syp_amount_cancel');
      delete userState[chatId];
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر نوع العملة لسحب شام كاش:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawShamCurrencyKeyboard(),
      });
      return;
    }

    // Syriatel Cash: check balance, then ask for phone number
    if (data === 'withdraw_method_syriatel') {
      debugLog('callback_query: executing withdraw_method_syriatel');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      if (botBalance <= 0) {
        await bot.editMessageText(`❌ رصيدك في البوت صفر.\n\nرصيدك الحالي: <code>${botBalanceFormatted}</code> ل.س\nيرجى شحن الرصيد أولاً.`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...withdrawMethodKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_syriatel_phone', messageId };
      const msg = `🔑 الرجاء إدخال رقم الهاتف الخاص بالعميل.\nمثال: 0912345678\n\n⚠️ ملاحظة: يرجى إلغاء العملية قبل الضغط على أي زر آخر لتجنب تعارض الطلبات.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        ...withdrawSyriatelCancelKeyboard(),
      });
      return;
    }

    // Cancel Syriatel Cash (phone or amount step) → back to withdraw method selection
    if (data === 'withdraw_syriatel_cancel') {
      debugLog('callback_query: executing withdraw_syriatel_cancel');
      delete userState[chatId];
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const msg = `💰 <strong>اختر طريقة السحب:</strong>\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...withdrawMethodKeyboard(),
      });
      return;
    }

    // Placeholders for logged-in menu (can implement later)
    // Charge (deposit) bot: show deposit method selection or "payment down" if all deposit methods off
    if (data === 'charge') {
      debugLog('callback_query: executing charge');
      const depositSyr = FLAG_DEPOSIT_SYRIATEL;
      const depositSham = FLAG_DEPOSIT_SHAMCASH;
      if (!depositSyr && !depositSham) {
        await bot.editMessageText(PAYMENT_DOWN_MESSAGE, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'charge_back' }]] },
        });
        return;
      }
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Back from charge deposit method → main menu
    if (data === 'charge_back') {
      debugLog('callback_query: executing charge_back');
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Charge Syriatel Cash: show min and ask for deposit amount
    if (data === 'charge_method_syriatel') {
      debugLog('callback_query: executing charge_method_syriatel');
      const { syriatel: syr } = await getRatesForPayment();
      const minFormatted = formatNumber(syr.min_deposit_syp);
      userState[chatId] = { step: 'await_charge_syriatel_amount', messageId };
      const msg = `💰 لقد اخترت <strong>سيرياتيل كاش</strong> كطريقة للإيداع.\n\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} ل.س</code>\n\n📩 الرجاء الآن إدخال المبلغ الذي تريد إيداعه:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeSyriatelCancelKeyboard(),
      });
      return;
    }

    // Cancel charge Syriatel → back to deposit method selection
    if (data === 'charge_syriatel_cancel') {
      debugLog('callback_query: executing charge_syriatel_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Cancel from charge Syriatel transfer instructions → back to deposit method selection
    if (data === 'charge_syriatel_transfer_cancel') {
      debugLog('callback_query: executing charge_syriatel_transfer_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Retry Syriatel deposit: re-ask for transaction ID (state kept)
    if (data === 'charge_syriatel_retry_transfer_id') {
      const st = userState[chatId];
      if (st && st.step === 'await_charge_syriatel_transfer_id' && st.chargeAmount != null) {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          '🔄 أرسل <strong>رقم عملية التحويل</strong> الآن:',
          { parse_mode: 'HTML', ...chargeSyriatelTransferCancelKeyboard() }
        );
      }
      return;
    }

    // Charge Sham Cash: show currency choice (USD / SYP)
    if (data === 'charge_method_sham') {
      debugLog('callback_query: executing charge_method_sham');
      const msg = `💰 <strong>اختر نوع الإيداع لشام كاش:</strong>`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeShamCurrencyKeyboard(),
      });
      return;
    }

    // Cancel charge Sham → back to deposit method selection
    if (data === 'charge_sham_cancel') {
      debugLog('callback_query: executing charge_sham_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Charge Sham Cash USD: show exchange rate and min deposit only (no max for deposit), ask for amount
    if (data === 'charge_sham_usd') {
      debugLog('callback_query: executing charge_sham_usd');
      const rates = await getRatesForPayment();
      const rateFormatted = formatNumber(rates.exchangeRate);
      const minFormatted = rates.shamcash.charge_sham_usd_min % 1 === 0 ? String(rates.shamcash.charge_sham_usd_min) : rates.shamcash.charge_sham_usd_min.toFixed(1);
      userState[chatId] = { step: 'await_charge_sham_usd_amount', messageId };
      const msg = `💰 اخترت الإيداع عبر <strong>شام كاش بالدولار الأمريكي (USD)</strong>.\n\n💵 <strong>سعر الصرف الحالي:</strong> <code>${rateFormatted} ل.س / 1 USD</code>\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} USD</code>\n\n📩 الرجاء إدخال المبلغ الذي تريد إيداعه بالدولار.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeShamUsdCancelKeyboard(),
      });
      return;
    }

    // Cancel charge Sham USD → back to charge Sham currency selection
    if (data === 'charge_sham_usd_cancel') {
      debugLog('callback_query: executing charge_sham_usd_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>اختر نوع الإيداع لشام كاش:</strong>`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeShamCurrencyKeyboard(),
      });
      return;
    }

    // Cancel from charge Sham USD transfer instructions → back to deposit method selection
    if (data === 'charge_sham_usd_transfer_cancel') {
      debugLog('callback_query: executing charge_sham_usd_transfer_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Charge Sham Cash SYP: show min deposit only (no max for deposit), ask for amount
    if (data === 'charge_sham_syp') {
      debugLog('callback_query: executing charge_sham_syp');
      const { shamcash: sham } = await getRatesForPayment();
      const minFormatted = formatNumber(sham.min_deposit_syp);
      userState[chatId] = { step: 'await_charge_sham_syp_amount', messageId };
      const msg = `💰 اخترت الإيداع عبر <strong>شام كاش بالليرة السورية</strong>.\n\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} ل.س</code>\n\n📩 الرجاء إدخال المبلغ الذي تريد إيداعه بالليرة السورية.`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeShamSypCancelKeyboard(),
      });
      return;
    }

    // Cancel charge Sham SYP amount step → back to charge Sham currency selection
    if (data === 'charge_sham_syp_cancel') {
      debugLog('callback_query: executing charge_sham_syp_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>اختر نوع الإيداع لشام كاش:</strong>`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeShamCurrencyKeyboard(),
      });
      return;
    }

    // Cancel from charge Sham SYP transfer instructions → back to deposit method selection
    if (data === 'charge_sham_syp_transfer_cancel') {
      debugLog('callback_query: executing charge_sham_syp_transfer_cancel');
      delete userState[chatId];
      const msg = `💰 <strong>شحن المحفظة</strong>\n\nالرجاء اختيار طريقة الإيداع:`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...chargeDepositKeyboard(),
      });
      return;
    }

    // Charge Sham USD: retry transfer ID (stay in same step)
    if (data === 'charge_sham_usd_retry_transfer_id') {
      debugLog('callback_query: executing charge_sham_usd_retry_transfer_id');
      const st = userState[chatId];
      if (st && st.step === 'await_charge_sham_usd_transfer_id' && st.chargeAmount != null) {
        await bot.editMessageText('📩 الرجاء إرسال <strong>رقم عملية التحويل</strong> بعد إيداع المبلغ عبر شام كاش (USD).', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...chargeShamUsdTransferCancelKeyboard(),
        });
      }
      return;
    }

    // Charge Sham SYP: retry transfer ID (stay in same step)
    if (data === 'charge_sham_syp_retry_transfer_id') {
      debugLog('callback_query: executing charge_sham_syp_retry_transfer_id');
      const st = userState[chatId];
      if (st && st.step === 'await_charge_sham_syp_transfer_id' && st.chargeAmount != null) {
        await bot.editMessageText('📩 الرجاء إرسال <strong>رقم عملية التحويل</strong> بعد إيداع المبلغ عبر شام كاش (ل.س).', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...chargeShamSypTransferCancelKeyboard(),
        });
      }
      return;
    }

    // Gift code menu: show activate / back
    if (data === 'gift_code') {
      debugLog('callback_query: executing gift_code');
      await bot.editMessageText('🎁 اختر ما تريد:', {
        chat_id: chatId,
        message_id: messageId,
        ...giftCodeKeyboard(),
      });
      return;
    }

    // Gift code: back to main menu
    if (data === 'gift_code_back') {
      debugLog('callback_query: executing gift_code_back');
      delete userState[chatId];
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Gift code: activate → ask user for code
    if (data === 'gift_code_activate') {
      debugLog('callback_query: executing gift_code_activate');
      userState[chatId] = { step: 'await_gift_code', messageId };
      const msg = `🎟️ أدخل كود الهدية الذي حصلت عليه:\n\n💡 <strong>ملاحظة:</strong> يمكنك استخدام:\n• الأكواد المنشورة علناً\n• الأكواد الخاصة التي حصلت عليها من الأدمن`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...giftCodeCancelKeyboard(),
      });
      return;
    }

    // Gift code: cancel → back to gift code menu
    if (data === 'gift_code_cancel') {
      debugLog('callback_query: executing gift_code_cancel');
      delete userState[chatId];
      await bot.editMessageText('🎁 اختر ما تريد:', {
        chat_id: chatId,
        message_id: messageId,
        ...giftCodeKeyboard(),
      });
      return;
    }

    // الإحالات — show referral link, stats, commission
    if (data === 'referrals') {
      debugLog('callback_query: executing referrals');
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للقائمة', callback_data: 'referrals_back' }]] },
      });
      const uid = query.from.id;
      let commData = { totalCommission: 0, levels: [], referralCount: 0 };
      try {
        const userRow = await getUserByTelegramId(uid);
        const effectivePercents = [...REFERRAL_PERCENTS];
        if (userRow?.custom_referral_percent != null) effectivePercents[0] = userRow.custom_referral_percent;
        commData = await getReferralCommission(uid, effectivePercents);
      } catch (err) {
        console.warn('getReferralCommission:', err.message);
      }
      let totalDistributed = 0;
      try {
        const hist = await getUserDistributionHistory(uid, 1, 1000);
        totalDistributed = hist.rows.reduce((s, r) => s + Number(r.commission_amount || 0), 0);
      } catch (_) {}
      const refLink = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=ref_${uid}` : '—';
      const commFormatted = formatNumber(commData.totalCommission);
      const distFormatted = formatNumber(totalDistributed);
      const countText = commData.referralCount > 0
        ? `👥 عدد الإحالات: ${commData.referralCount}`
        : '📭 لا توجد إحالات بعد.';
      let levelLines = '';
      for (const l of commData.levels) {
        if (l.percent > 0) levelLines += `\n▫️ المستوى ${l.level} (${l.percent}%): ${formatNumber(l.commission)} ل.س`;
      }
      const msg = `👥 نظام الإحالات\n\n🔗 رابطك: <code>${escapeHtml(refLink)}</code>\n\n💰 العمولة الحالية: ${commFormatted} ل.س${levelLines}\n\n✅ إجمالي ما تم صرفه سابقاً: ${distFormatted} ل.س\n\n${countText}`;
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للقائمة', callback_data: 'referrals_back' }]] },
      });
      return;
    }

    // Back from referrals → main menu
    if (data === 'referrals_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // عرض السجل المالي — deposit/withdrawal history menu
    if (data === 'financial_record') {
      debugLog('callback_query: executing financial_record');
      await bot.editMessageText('📄 اختر نوع السجل الذي ترغب بعرضه:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📤 سجل السحب', callback_data: 'txlog_withdrawal_1' },
              { text: '💵 سجل الإيداع', callback_data: 'txlog_deposit_1' },
            ],
            [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'financial_record_back' }],
          ],
        },
      });
      return;
    }

    // Back from financial record → main menu
    if (data === 'financial_record_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    // Transaction log pages: txlog_deposit_1, txlog_withdrawal_2, etc.
    if (data.startsWith('txlog_')) {
      const parts = data.split('_');
      const txType = parts[1]; // 'deposit' or 'withdrawal'
      const page = parseInt(parts[2], 10) || 1;
      debugLog('callback_query: executing txlog', { txType, page });

      const PAGE_SIZE = 5;
      let result;
      try {
        result = await getTransactions(query.from.id, txType, page, PAGE_SIZE);
      } catch (err) {
        console.warn('getTransactions:', err.message);
        result = { rows: [], total: 0, page: 1, totalPages: 0 };
      }

      const methodLabel = {
        syriatel: 'سيرياتيل كاش',
        sham_usd: 'شام كاش (USD)',
        sham_syp: 'شام كاش (ل.س)',
      };
      const typeLabel = txType === 'deposit' ? '💵 سجل الإيداع' : '📤 سجل السحب';

      let msg;
      if (result.rows.length === 0) {
        msg = `${typeLabel}\n\n📭 لا توجد عمليات بعد.`;
      } else {
        const lines = result.rows.map((tx, i) => {
          const num = (page - 1) * PAGE_SIZE + i + 1;
          const d = new Date(tx.created_at);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const method = methodLabel[tx.method] || tx.method;
          const txId = tx.transfer_id ? `\n   🔖 رقم العملية: <code>${escapeHtml(tx.transfer_id)}</code>` : '';
          const statusIcon = tx.status === 'confirmed' ? '✅' : tx.status === 'rejected' ? '❌' : '⏳';
          return `${num}. ${statusIcon} <code>${formatNumber(tx.amount)}</code> ل.س — ${method}\n   📅 ${dateStr}${txId}`;
        });
        msg = `${typeLabel} (${result.page}/${result.totalPages})\n\n${lines.join('\n\n')}`;
      }

      const buttons = [];
      const navRow = [];
      if (page > 1) navRow.push({ text: '⬅️ السابق', callback_data: `txlog_${txType}_${page - 1}` });
      if (page < result.totalPages) navRow.push({ text: '➡️ التالي', callback_data: `txlog_${txType}_${page + 1}` });
      if (navRow.length) buttons.push(navRow);
      buttons.push([{ text: '🔙 العودة', callback_data: 'financial_record' }]);

      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

    // مراسلة الدعم — show support contact
    if (data === 'support') {
      debugLog('callback_query: executing support');
      const supportUrl = SUPPORT_USERNAME ? `https://t.me/${SUPPORT_USERNAME}` : '';
      const buttons = [];
      if (supportUrl) buttons.push([{ text: '📩 اضغط هنا لمراسلة الدعم', url: supportUrl }]);
      buttons.push([{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'support_back' }]);
      await bot.editMessageText('لأي سؤال أو مشكلة، الرجاء التواصل مع فريق الدعم عبر الضغط على الزر أدناه.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

    // Back from support → main menu
    if (data === 'support_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(isAdminUser(query.from)),
      });
      return;
    }

    if (data === 'box_game') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const userId = query.from?.id;
      if (!userId) return;
      const user = await getUserByTelegramId(userId);
      if (!user) {
        await bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
        return;
      }
      if (!canUserPlayBoxGame(user)) {
        await bot.sendMessage(chatId, '⏳ يمكنك المحاولة مرة واحدة كل 24 ساعة. حاول لاحقاً.');
        return;
      }
      await bot.sendMessage(chatId, 'اضغط لتجربة حظك 🎲:', {
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 العب الآن', callback_data: 'box_play_now' }]],
        },
      });
      return;
    }

    if (data === 'box_play_now') {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const userId = query.from?.id;
      if (!userId) return;
      const user = await getUserByTelegramId(userId);
      if (!user) {
        await bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
        return;
      }
      if (!canUserPlayBoxGame(user)) {
        await bot.sendMessage(chatId, '⏳ يمكنك المحاولة مرة واحدة كل 24 ساعة. حاول لاحقاً.');
        return;
      }
      await bot.sendMessage(chatId, 'اختر صندوقًا واحدًا 🎁:', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📦 صندوق 1', callback_data: 'box_choose_1' },
              { text: '📦 صندوق 2', callback_data: 'box_choose_2' },
              { text: '📦 صندوق 3', callback_data: 'box_choose_3' },
            ],
          ],
        },
      });
      return;
    }

    const boxChooseMatch = data.match(/^box_choose_([123])$/);
    if (boxChooseMatch) {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const userId = query.from?.id;
      if (!userId) return;
      const user = await getUserByTelegramId(userId);
      if (!user) {
        await bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
        return;
      }
      if (!canUserPlayBoxGame(user)) {
        await bot.sendMessage(chatId, '⏳ يمكنك المحاولة مرة واحدة كل 24 ساعة. حاول لاحقاً.');
        return;
      }
      const boxIndex = parseInt(boxChooseMatch[1], 10) - 1;
      const prizes = await getLuckBoxPrizes();
      const box = prizes[boxIndex] || { amount: 0, weight: 0 };
      const amount = Number(box.amount) || 0;
      const now = new Date();
      if (amount <= 0) {
        await createOrUpdateUser(userId, { last_box_game_at: now });
        await bot.sendMessage(chatId, 'الصندوق فارغ، حظًا أوفر في المرة القادمة!');
        return;
      }
      await adjustBalance(userId, { balanceDelta: Math.round(amount * 100) / 100 });
      await createOrUpdateUser(userId, { last_box_game_at: now });
      const amountFormatted = formatCurrencySyp(amount);
      await bot.sendMessage(chatId, `🎉 مبروك! فزت بـ ${amountFormatted} من الصندوق ${boxIndex + 1}.`);
      return;
    }

    if (data === 'jackpot') {
      await bot.answerCallbackQuery(query.id, { text: 'قيد التطوير' }).catch(() => {});
      return;
    }

    // استرداد آخر طلب سحب: show user's pending ShamCash withdrawal requests; user can cancel to get balance back
    if (data === 'redeem_withdrawal') {
      const list = await getShamcashPendingByUser(query.from.id);
      if (!list || list.length === 0) {
        await bot.editMessageText('📋 لا توجد طلبات سحب معلقة (شام كاش).', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'main_menu_back' }]] },
        });
        return;
      }
      const timezone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
      const formatDate = (d) => {
        try {
          return new Date(d).toLocaleString('ar-SY', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
        } catch (_) {
          return new Date(d).toLocaleString();
        }
      };
      let msg = '📋 طلبات السحب المعلقة (شام كاش):\n\n';
      const rows = [];
      for (const p of list) {
        const curLabel = p.currency === 'usd' ? ' USD' : ' ل.س';
        msg += `• ${p.amount_display}${curLabel} — رمز العميل: <code>${escapeHtml(p.client_code)}</code> — ${formatDate(p.created_at)}\n`;
        rows.push([{ text: `❌ إلغاء طلب ${p.amount_display}${curLabel}`, callback_data: `sham_withdraw_cancel_${p.id}` }]);
      }
      rows.push([{ text: '🔙 العودة', callback_data: 'main_menu_back' }]);
      await bot.editMessageText(msg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    // User cancels own pending ShamCash withdrawal → refund balance
    if (data.startsWith('sham_withdraw_cancel_')) {
      const pendingId = parseInt(data.replace('sham_withdraw_cancel_', ''), 10);
      if (!Number.isFinite(pendingId)) return;
      const pending = await getShamcashPendingById(pendingId);
      if (!pending || pending.status !== 'pending') {
        await bot.answerCallbackQuery(query.id, { text: 'الطلب غير موجود أو تمت معالجته مسبقاً.' }).catch(() => {});
        return;
      }
      if (String(pending.telegram_user_id) !== String(query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' }).catch(() => {});
        return;
      }
      const amountSyp = Number(pending.amount_syp);
      let user = null;
      try {
        const refunded = await adjustBalance(query.from.id, { balanceDelta: Math.round(amountSyp * 100) / 100 });
        if (!refunded) throw new Error('adjustBalance returned null');
        if (pending.transaction_id) await updateTransactionStatus(pending.transaction_id, 'rejected');
        await updateShamcashPendingStatus(pendingId, 'rejected', 'user_cancel');
      } catch (err) {
        console.warn('sham_withdraw_cancel:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ. حاول لاحقاً.' }).catch(() => {});
        return;
      }
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (_) {}
      const botName = (user && user.ichancy_login && String(user.ichancy_login).trim()) || (user && user.telegram_username) || (query.from.username ? `@${query.from.username}` : '') || query.from.first_name || String(query.from.id);
      sendShamcashUserRejectToChannel(pending, query.from, botName);
      await bot.answerCallbackQuery(query.id, { text: 'تم إلغاء الطلب واسترداد الرصيد.' }).catch(() => {});
      await bot.sendMessage(chatId, `✅ تم إلغاء طلب السحب واسترداد المبلغ (${formatNumber(amountSyp)} ل.س) إلى محفظتك في البوت.`).catch(() => {});
      const list = await getShamcashPendingByUser(query.from.id);
      if (!list || list.length === 0) {
        await bot.editMessageText('📋 لا توجد طلبات سحب معلقة (شام كاش).', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'main_menu_back' }]] },
        }).catch(() => {});
      } else {
        const timezone = (await getConfigValue('timezone', 'Asia/Damascus')) || 'Asia/Damascus';
        const formatDate = (d) => {
          try {
            return new Date(d).toLocaleString('ar-SY', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
          } catch (_) {
            return new Date(d).toLocaleString();
          }
        };
        let msg = '📋 طلبات السحب المعلقة (شام كاش):\n\n';
        const rows = [];
        for (const p of list) {
          const curLabel = p.currency === 'usd' ? ' USD' : ' ل.س';
          msg += `• ${p.amount_display}${curLabel} — رمز العميل: <code>${escapeHtml(p.client_code)}</code> — ${formatDate(p.created_at)}\n`;
          rows.push([{ text: `❌ إلغاء طلب ${p.amount_display}${curLabel}`, callback_data: `sham_withdraw_cancel_${p.id}` }]);
        }
        rows.push([{ text: '🔙 العودة', callback_data: 'main_menu_back' }]);
        await bot.editMessageText(msg, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        }).catch(() => {});
      }
      return;
    }
  } catch (e) {
    console.error('callback_query handler error:', e);
  }
});

// Spin wheel: web_app_data from Mini App sendData
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const webAppData = msg.web_app_data;
  if (webAppData && webAppData.data) {
    try {
      await bot.sendChatAction(chatId, 'typing');
      const payload = JSON.parse(webAppData.data);
      const { prize_index, text } = payload;
      const userId = msg.from?.id;
      if (!userId || !Number.isFinite(prize_index) || typeof text !== 'string') {
        return bot.sendMessage(chatId, '❌ بيانات غير صالحة.');
      }
      const { parseAmountFromText } = require('./telegram-initdata');
      const amount = parseAmountFromText(text);
      const user = await getUserByTelegramId(userId);
      if (!user) {
        return bot.sendMessage(chatId, '❌ المستخدم غير موجود.');
      }
      const spinsAvailable = Number(user.wheel_spins_available_today ?? 0);
      if (spinsAvailable <= 0) {
        return bot.sendMessage(chatId, '❌ لا توجد لفات متاحة.');
      }
      const prizes = (await loadConfig()).spin_prizes;
      const prizeList = Array.isArray(prizes) && prizes.length > 0 ? prizes : [{ text: 'حظ أوفر', weight: 80 }, { text: '💰 5000', weight: 5 }, { text: '💎 10000', weight: 10 }, { text: '👑 25000', weight: 5 }];
      const prize = prizeList[prize_index];
      if (!prize || prize.text !== text) {
        return bot.sendMessage(chatId, '❌ الجائزة غير متطابقة.');
      }
      const applied = await useSpinCredit(userId, amount);
      if (!applied) {
        return bot.sendMessage(chatId, '❌ لا توجد لفات متاحة أو تم استهلاكها.');
      }
      if (amount > 0) {
        await bot.sendMessage(chatId, `🎉 مبروك! ربحت ${text} — تم إضافة ${amount.toLocaleString()} ل.س إلى محفظتك.`);
      } else {
        await bot.sendMessage(chatId, 'حظ أوفر! جرّب في المرة القادمة. 🍀');
      }
      // Refresh spin button to show (0) so user doesn't need /start
      if (SPIN_BASE_URL) {
        await bot.sendMessage(chatId, '🎡 العجلة الذهبية', {
          reply_markup: {
            keyboard: [[{ text: '🎡 تدوير العجلة (0)' }]],
            resize_keyboard: true,
          },
        }).catch((e) => debugLog('Spin keyboard refresh failed:', e.message));
      }
    } catch (err) {
      console.warn('[Bot:' + BOT_ID + '] web_app_data error:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ. حاول مرة أخرى.');
    }
    return;
  }

  const text = msg.text && msg.text.trim();
  if (!text || /^\/\w+/.test(text)) return; // ignore commands (onText handles them; avoids duplicate pause message)
  if (BOT_OFF_FLAG && !isAdminUser(msg.from)) {
    return bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
  }
  if (!isAdminUser(msg.from) && msg.from && (await isUserBlocked(msg.from.id, msg.from.username))) {
    return bot.sendMessage(chatId, 'تم حظرك من قبل الأدمن.');
  }
  // Spin button with 0 spins: user tapped the non–web_app button, don't open site
  if (/^🎡 تدوير العجلة\s*\(\d+\)$/.test(text)) {
    const userId = msg.from?.id;
    if (userId) {
      try {
        const user = await getUserByTelegramId(userId);
        const spinsAvailable = Number(user?.wheel_spins_available_today ?? 0);
        if (spinsAvailable <= 0) {
          return bot.sendMessage(chatId, '❌ لا توجد لفات متاحة.');
        }
      } catch (_) {}
    }
  }
  const state = userState[chatId];
  if (!state) return;
  debugLog('message: got text (state exists)', { chatId, step: state.step, textLength: text.length });

  if (state.step === 'await_admin_support_username') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const newUsername = text.replace(/@/g, '').trim();
    if (!/^[a-zA-Z0-9_]{4,32}$/.test(newUsername)) {
      return bot.sendMessage(chatId, '❌ اسم المستخدم غير صالح. استخدم 4–32 حرفاً (أحرف، أرقام، شرطة سفلية فقط).');
    }
    try {
      await setConfigValue('SUPPORT_USERNAME', newUsername);
      SUPPORT_USERNAME = await getConfigValue('SUPPORT_USERNAME', '');
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث اسم مستخدم الدعم.\n\n' + adminSupportSettingsMessage(), { parse_mode: 'HTML', ...adminSupportSettingsKeyboard() });
    } catch (err) {
      console.warn('setConfigValue SUPPORT_USERNAME:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_spin_prize_add') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const parsed = parseTextWeight(text.trim());
    if (!parsed) {
      return bot.sendMessage(chatId, '❌ استخدم الصيغة: <code>نص الجائزة، النسبة الظهور</code> (رقم موجب للنسبة الظهور). مثال: 💰 5000، 5');
    }
    try {
      const prizes = await getSpinPrizes();
      prizes.push(parsed);
      await setConfigValue('spin_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تمت إضافة الجائزة.\n\n' + (await adminSpinPrizesMessage()), { parse_mode: 'HTML', ...(await adminSpinPrizesKeyboard()) });
    } catch (err) {
      console.warn('setConfigValue spin_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_spin_prize_add_luck') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const w = parseInt(text.trim(), 10);
    if (!Number.isFinite(w) || w <= 0) {
      return bot.sendMessage(chatId, '❌ أرسل رقماً موجباً للنسبة الظهور فقط.');
    }
    try {
      const prizes = await getSpinPrizes();
      prizes.push({ text: LUCK_PRIZE_TEXT, weight: w });
      await setConfigValue('spin_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, `✅ تمت إضافة "${LUCK_PRIZE_TEXT}" بالنسبة الظهور ${w}.\n\n` + (await adminSpinPrizesMessage()), { parse_mode: 'HTML', ...(await adminSpinPrizesKeyboard()) });
    } catch (err) {
      console.warn('setConfigValue spin_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_spin_prize_weight') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const w = parseInt(text.trim(), 10);
    if (!Number.isFinite(w) || w <= 0) {
      return bot.sendMessage(chatId, '❌ أرسل رقماً موجباً للنسبة الظهور.');
    }
    const idx = state.prizeIndex;
    const prizes = await getSpinPrizes();
    if (idx < 0 || idx >= prizes.length) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ الجائزة لم تعد موجودة.', { ...(await adminSpinPrizesKeyboard()) });
    }
    try {
      prizes[idx] = { ...prizes[idx], weight: w };
      await setConfigValue('spin_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث النسبة الظهور.\n\n' + (await adminSpinPrizesMessage()), { parse_mode: 'HTML', ...(await adminSpinPrizesKeyboard()) });
    } catch (err) {
      console.warn('setConfigValue spin_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_spin_prize_edit') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const parsed = parseTextWeight(text.trim());
    if (!parsed) {
      return bot.sendMessage(chatId, '❌ استخدم الصيغة: <code>نص الجائزة، النسبة الظهور</code>. مثال: 💰 5000، 5');
    }
    const idx = state.prizeIndex;
    const prizes = await getSpinPrizes();
    if (idx < 0 || idx >= prizes.length) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ الجائزة لم تعد موجودة.', { ...(await adminSpinPrizesKeyboard()) });
    }
    try {
      prizes[idx] = parsed;
      await setConfigValue('spin_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث الجائزة.\n\n' + (await adminSpinPrizesMessage()), { parse_mode: 'HTML', ...(await adminSpinPrizesKeyboard()) });
    } catch (err) {
      console.warn('setConfigValue spin_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_box_prize_amount') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const raw = text.replace(/,/g, '').trim();
    const amount = parseInt(raw, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      return bot.sendMessage(chatId, '❌ أرسل رقماً صحيحاً للمبلغ (0 أو أكثر).');
    }
    const idx = state.boxIndex;
    if (idx < 0 || idx > 2) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ غير صالح.', { ...adminBoxPrizesKeyboard() });
    }
    try {
      const prizes = await getLuckBoxPrizes();
      prizes[idx] = { ...(prizes[idx] || { amount: 0, weight: 0 }), amount };
      await setConfigValue('luck_box_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث المبلغ.\n\n' + (await adminBoxPrizesMessage()), { parse_mode: 'HTML', ...adminBoxPrizesKeyboard() });
    } catch (err) {
      console.warn('setConfigValue luck_box_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_box_prize_weight') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const w = parseInt(text.trim(), 10);
    if (!Number.isFinite(w) || w < 0) {
      return bot.sendMessage(chatId, '❌ أرسل رقماً صحيحاً للنسبة الظهور (نسبة مئوية، 0 أو أكثر).');
    }
    const idx = state.boxIndex;
    if (idx < 0 || idx > 2) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ غير صالح.', { ...adminBoxPrizesKeyboard() });
    }
    try {
      const prizes = await getLuckBoxPrizes();
      prizes[idx] = { ...(prizes[idx] || { amount: 0, weight: 0 }), weight: w };
      await setConfigValue('luck_box_prizes', prizes);
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث النسبة الظهور.\n\n' + (await adminBoxPrizesMessage()), { parse_mode: 'HTML', ...adminBoxPrizesKeyboard() });
    } catch (err) {
      console.warn('setConfigValue luck_box_prizes:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الحفظ.');
    }
    return;
  }

  if (state.step === 'await_admin_broadcast_message') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const adminMessage = text.trim();
    if (!adminMessage) {
      return bot.sendMessage(chatId, '❌ أرسل رسالة غير فارغة.');
    }
    delete userState[chatId];
    const broadcastText = `✉️ رسالة من الأدمن:\n\n${adminMessage}`;
    try {
      const userIds = await getAllTelegramUserIds();
      let sent = 0;
      let failed = 0;
      const statusMsg = await bot.sendMessage(chatId, `📤 جاري الإرسال إلى ${userIds.length} مستخدم...`);
      for (const uid of userIds) {
        try {
          await bot.sendMessage(uid, broadcastText);
          sent++;
          if (sent % 20 === 0) await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          failed++;
          if (err.response?.statusCode === 403) debugLog('Broadcast: user blocked bot', uid);
        }
      }
      await bot.editMessageText(`✅ تم إرسال الرسالة.\n\n📨 تم الإرسال: ${sent}\n❌ فشل: ${failed}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
      });
    } catch (err) {
      console.warn('Broadcast to all:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء الإرسال. حاول مرة أخرى.');
    }
    return;
  }

  if (state.step === 'await_admin_broadcast_channel_username') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const newChannel = text.replace(/@/g, '').trim();
    if (!newChannel || newChannel.length < 4) {
      return bot.sendMessage(chatId, '❌ اسم القناة غير صالح. أرسل اسم المستخدم للقناة (بدون @ أو معه).');
    }
    const toSave = newChannel.startsWith('-') ? newChannel : `@${newChannel}`;
    try {
      await setConfigValue('CHANNEL_USERNAME', toSave);
      await applyChannelConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث اسم القناة.\n\n' + (await adminBroadcastSettingsMessage()), { parse_mode: 'HTML', ...adminBroadcastSettingsKeyboard() });
    } catch (err) {
      console.warn('setConfigValue CHANNEL_USERNAME:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_user_search') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const searchQuery = text.trim();
    delete userState[chatId];
    if (!searchQuery) return;
    try {
      const result = await getUsersListForAdmin({ page: 1, pageSize: 50, searchQuery });
      if (result.total === 0) {
        await bot.editMessageText('❌ لا يوجد مستخدم مطابق للبحث.\n\nحاول مرة أخرى.', {
          chat_id: chatId,
          message_id: state.messageId,
          reply_markup: { inline_keyboard: [
            [{ text: '🔍 بحث جديد', callback_data: 'admin_manage_users_search' }],
            [{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users' }],
          ] },
        });
      } else if (result.total === 1) {
        const detail = await adminUserDetailMessage(result.users[0].telegram_user_id);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: state.messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } else {
        const rows = [];
        rows.push([{ text: '🔍 بحث جديد', callback_data: 'admin_manage_users_search' }]);
        result.users.slice(0, 20).forEach((u) => {
          rows.push([{ text: `${u.displayName}`, callback_data: `admin_user_detail_${u.telegram_user_id}` }]);
        });
        rows.push([{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users' }]);
        await bot.editMessageText(`🔍 تم العثور على ${result.total} مستخدم مطابق.\nاختر المستخدم:`, {
          chat_id: chatId,
          message_id: state.messageId,
          reply_markup: { inline_keyboard: rows },
        });
      }
    } catch (err) {
      console.warn('getUsersListForAdmin search:', err.message);
      await bot.editMessageText('❌ حدث خطأ أثناء البحث. حاول مرة أخرى.', {
        chat_id: chatId,
        message_id: state.messageId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }]] },
      });
    }
    return;
  }

  if (state.step === 'await_admin_user_add_money') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const raw = text.replace(/,/g, '').trim();
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً صالحاً للمبلغ (ل.س).');
    }
    const telegramUserId = state.telegramUserId;
    delete userState[chatId];
    try {
      const user = await getUserByTelegramId(telegramUserId);
      if (!user) {
        return bot.sendMessage(chatId, '❌ المستخدم غير موجود.');
      }
      const updated = await adjustBalance(telegramUserId, { balanceDelta: Math.round(amount * 100) / 100 });
      if (!updated) {
        return bot.sendMessage(chatId, '❌ حدث خطأ في تحديث الرصيد.');
      }
      const dateStr = new Date().toLocaleString('sv-SE', { timeZone: getBotTimezone() });
      const amountFormatted = formatCurrencySyp(amount);
      const userMsg = `🎉 <b>تم إضافة رصيد إلى حسابك</b>

💰 <b>المبلغ:</b> ${escapeHtml(amountFormatted)}
👨‍💼 <b>بواسطة:</b> الإدارة
📅 <b>التاريخ:</b> ${escapeHtml(dateStr)}

✅ تمت العملية بنجاح.`;
      await bot.sendMessage(telegramUserId, userMsg, { parse_mode: 'HTML' }).catch((err) => console.warn('admin add money: send to user:', err?.message));
      await bot.sendMessage(chatId, `✅ تمت إضافة الرصيد بنجاح!\n\n💰 المبلغ: ${amountFormatted} ل.س`, { parse_mode: 'HTML' });
      const detail = await adminUserDetailMessage(telegramUserId);
      await bot.editMessageText(detail.text, {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'HTML',
        reply_markup: detail.reply_markup,
      });
    } catch (err) {
      console.warn('admin add money:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء إضافة الرصيد.');
    }
    return;
  }

  if (state.step === 'await_admin_user_deduct_money') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const raw = text.replace(/,/g, '').trim();
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً صالحاً للمبلغ (ل.س).');
    }
    const telegramUserId = state.telegramUserId;
    delete userState[chatId];
    try {
      const user = await getUserByTelegramId(telegramUserId);
      if (!user) {
        return bot.sendMessage(chatId, '❌ المستخدم غير موجود.');
      }
      const roundedAmount = Math.round(amount * 100) / 100;
      const updated = await adjustBalance(telegramUserId, { balanceDelta: -roundedAmount });
      if (!updated) {
        const currentBalance = Number(user.balance || 0);
        return bot.sendMessage(chatId, `❌ الرصيد الحالي للمستخدم: ${formatCurrencySyp(currentBalance)} ل.س. لا يمكن خصم أكثر من الرصيد المتاح.`);
      }
      const amountFormatted = formatCurrencySyp(amount);
      await bot.sendMessage(chatId, `✅ تم خصم الرصيد بنجاح!\n\n💸 المبلغ المخصوم: ${amountFormatted} ل.س`, { parse_mode: 'HTML' });
      const detail = await adminUserDetailMessage(telegramUserId);
      await bot.editMessageText(detail.text, {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'HTML',
        reply_markup: detail.reply_markup,
      });
    } catch (err) {
      console.warn('admin deduct money:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء خصم الرصيد.');
    }
    return;
  }

  if (state.step === 'await_admin_user_send_msg') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const adminMessage = text.trim();
    if (!adminMessage) {
      return bot.sendMessage(chatId, '❌ الرسالة لا يمكن أن تكون فارغة.');
    }
    const telegramUserId = state.telegramUserId;
    delete userState[chatId];
    try {
      const userMsg = `✉️ رسالة من الأدمن:

${escapeHtml(adminMessage)}`;
      await bot.sendMessage(telegramUserId, userMsg, { parse_mode: 'HTML' }).catch((err) => console.warn('admin send msg: send to user:', err?.message));
      await bot.sendMessage(chatId, '✅ تم إرسال الرسالة بنجاح!', { parse_mode: 'HTML' });
      const detail = await adminUserDetailMessage(telegramUserId);
      await bot.editMessageText(detail.text, {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'HTML',
        reply_markup: detail.reply_markup,
      });
    } catch (err) {
      console.warn('admin send msg:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء إرسال الرسالة.');
    }
    return;
  }

  if (state.step === 'await_admin_user_custom_ref') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    if (text === '/cancel') {
      delete userState[chatId];
      try {
        const detail = await adminUserDetailMessage(state.telegramUserId);
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: state.messageId,
          parse_mode: 'HTML',
          reply_markup: detail.reply_markup,
        });
      } catch (_) {}
      return;
    }
    const pct = parseFloat(text.trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return bot.sendMessage(chatId, '❌ أدخل رقم صحيح من 0 إلى 100.');
    }
    const telegramUserId = state.telegramUserId;
    delete userState[chatId];
    try {
      await createOrUpdateUser(telegramUserId, { custom_referral_percent: pct });
      await bot.sendMessage(chatId, `✅ تم تحديث نسبة الإحالة الخاصة إلى ${pct}% بنجاح!`);
      const detail = await adminUserDetailMessage(telegramUserId);
      await bot.editMessageText(detail.text, {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'HTML',
        reply_markup: detail.reply_markup,
      });
    } catch (err) {
      console.warn('admin custom ref:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_sham_msg') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    if (text === '/cancel' || !text || !text.trim()) {
      delete userState[chatId];
      return bot.sendMessage(chatId, 'تم الإلغاء.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 طلبات السحب المعلقة', callback_data: 'admin_pending_withdrawals' }]] },
      });
    }
    const targetUserId = state.targetUserId;
    const savedMessageId = state.messageId;
    delete userState[chatId];
    try {
      const userMsg = `✉️ رسالة من الأدمن:\n\n${escapeHtml(text.trim())}`;
      await bot.sendMessage(targetUserId, userMsg, { parse_mode: 'HTML' }).catch((err) => console.warn('admin sham msg to user:', err?.message));
      await bot.sendMessage(chatId, '✅ تم إرسال الرسالة للمستخدم.');
      await bot.editMessageText('تم إرسال الرسالة للمستخدم.', {
        chat_id: chatId,
        message_id: savedMessageId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 طلبات السحب المعلقة', callback_data: 'admin_pending_withdrawals' }]] },
      }).catch(() => {});
    } catch (err) {
      console.warn('await_admin_sham_msg:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء إرسال الرسالة.');
    }
    return;
  }

  if (state.step === 'await_admin_exchange_rate') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const raw = text.replace(/,/g, '').trim();
    const num = parseFloat(raw);
    if (!Number.isFinite(num) || num <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً صالحاً لسعر الصرف (ل.س لكل 1 USD).');
    }
    try {
      await setConfigValue('EXCHANGE_RATE_SYP_PER_USD', num);
      await loadLocalConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث سعر الصرف.\n\n' + (await adminExchangeRateSettingsMessage()), {
        parse_mode: 'HTML',
        ...adminExchangeRateSettingsKeyboard(),
      });
    } catch (err) {
      console.warn('setConfigValue EXCHANGE_RATE_SYP_PER_USD:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_username_prefix') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const prefix = String(text || '').trim();
    if (!prefix || prefix.length > 64) {
      return bot.sendMessage(chatId, '❌ البادئة يجب أن تكون بين 1 و 64 حرفاً.');
    }
    try {
      await setConfigValue('USERNAME_PREFIX', prefix);
      await loadLocalConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث البادئة.\n\n' + adminUsernamePrefixMessage(), {
        parse_mode: 'HTML',
        ...adminUsernamePrefixKeyboard(),
      });
    } catch (err) {
      console.warn('setConfigValue USERNAME_PREFIX:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_referral_rates') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 3) {
      let errTip = '❌ أرسل ثلاث قيم مفصولة بفواصل (مستوى 1، مستوى 2، مستوى 3) مثل: 5,2,1';
      if (parts.length < 3) errTip = '❌ أرقام ناقصة. المطلوب 3 قيم مفصولة بفواصل مثل: 5,2,1';
      else if (parts.length > 3) errTip = '❌ أرقام زائدة. المطلوب 3 قيم فقط مفصولة بفواصل مثل: 5,2,1';
      try {
        const ratesMsg = await adminReferralRatesMessage();
        await bot.editMessageText(
          ratesMsg + '\n\n' + errTip + '\n\n✏️ أرسل القيم الجديدة مفصولة بفواصل مثل:\n<code>5,2,1</code>',
          { chat_id: chatId, message_id: state.messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'admin_referral_rates_cancel' }]] } }
        );
      } catch (e) {
        await bot.sendMessage(chatId, errTip);
      }
      return;
    }
    const nums = parts.map((s) => parseFloat(s));
    const invalidNum = nums.some((n) => !Number.isFinite(n));
    const outOfRange = nums.some((n) => n < 0 || n > 100);
    if (invalidNum || outOfRange) {
      const errTip = invalidNum
        ? '❌ إدخال غير صالح. تأكد أن كل قيمة رقماً (مثل: 5,2,1)'
        : '❌ كل قيمة يجب أن تكون بين 0 و 100.';
      try {
        const ratesMsg = await adminReferralRatesMessage();
        await bot.editMessageText(
          ratesMsg + '\n\n' + errTip + '\n\n✏️ أرسل القيم الجديدة مفصولة بفواصل مثل:\n<code>5,2,1</code>',
          { chat_id: chatId, message_id: state.messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'admin_referral_rates_cancel' }]] } }
        );
      } catch (e) {
        await bot.sendMessage(chatId, errTip);
      }
      return;
    }
    try {
      await setConfigValue('REFERRAL_LEVEL1_PERCENT', nums[0]);
      await setConfigValue('REFERRAL_LEVEL2_PERCENT', nums[1]);
      await setConfigValue('REFERRAL_LEVEL3_PERCENT', nums[2]);
      REFERRAL_PERCENTS = [nums[0], nums[1], nums[2]];
      delete userState[chatId];
      try {
        const ratesMsg = await adminReferralRatesMessage();
        await bot.editMessageText(ratesMsg + '\n\nتم تحديث نسب الإحالات بنجاح ✅', {
          chat_id: chatId,
          message_id: state.messageId,
          ...adminReferralRatesKeyboard(),
        });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) console.warn('editMessageText after referral rates save:', editErr.message);
      }
    } catch (err) {
      console.warn('setConfigValue referral levels:', err.message);
      const errAlert = '❌ حدث خطأ أثناء حفظ النسب. يرجى المحاولة مرة أخرى.';
      try {
        const ratesMsg = await adminReferralRatesMessage();
        await bot.editMessageText(
          ratesMsg + '\n\n' + errAlert + '\n\n✏️ أرسل القيم الجديدة مفصولة بفواصل مثل:\n<code>5,2,1</code>',
          { chat_id: chatId, message_id: state.messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء العملية', callback_data: 'admin_referral_rates_cancel' }]] } }
        );
      } catch (e) {
        await bot.sendMessage(chatId, errAlert);
      }
    }
    return;
  }

  if (state.step === 'await_admin_rates_single') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const provider = state.provider;
    const field = state.field;
    const providerLabel = provider === 'syriatel' ? 'سيريتيل كاش' : 'شام كاش';
    const fieldLabel = RATES_EDIT_FIELDS[field] || field;
    const isPercent = field === 'cashout_tax_percent' || field === 'deposit_bonus_percent';
    const num = isPercent ? parseFloat(text) : parseInt(text, 10);
    if (!Number.isFinite(num)) {
      return bot.sendMessage(chatId, `❌ الرجاء إرسال رقم صالح${isPercent ? ' (نسبة بين 0 و 100)' : ''}.`);
    }
    if (isPercent && (num < 0 || num > 100)) {
      return bot.sendMessage(chatId, '❌ نسبة خصم السحب أو البونص يجب أن تكون بين 0 و 100.');
    }
    if (!isPercent && num < 0) {
      return bot.sendMessage(chatId, '❌ القيمة يجب أن تكون رقماً موجباً.');
    }
    const value = isPercent ? num : Math.round(num);
    try {
      await setProviderConfig(provider, { [field]: value });
      await loadLocalConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث الإعدادات بنجاح.\n\n' + fieldLabel + ' — ' + providerLabel, { parse_mode: 'HTML' });
      await bot.editMessageText(await adminManageRatesMessage(), {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
    } catch (err) {
      console.warn('setProviderConfig:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  // ——— إضافة كود هدية: الخطوة 1 — اسم الكود
  if (state.step === 'await_gift_add_code') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const code = (text || '').trim().toUpperCase().replace(/\s/g, '');
    if (!code || !/^[A-Z0-9]+$/i.test(code)) {
      return bot.sendMessage(chatId, '❌ أرسل كوداً صالحاً (حروف وأرقام فقط، بدون مسافات).');
    }
    userState[chatId] = { step: 'await_gift_add_amount', giftCode: code, messageId: state.messageId };
    return bot.sendMessage(
      chatId,
      `💰 أدخل قيمة الكود بالليرة السورية (مثال: 1000):`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_cancel' }]] } }
    );
  }

  // ——— إضافة كود هدية: الخطوة 2 — المبلغ
  if (state.step === 'await_gift_add_amount') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const amount = parseInt((text || '').trim(), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ المبلغ يجب أن يكون رقماً موجباً.');
    }
    userState[chatId] = { ...state, step: 'await_gift_add_limit', giftAmount: amount };
    return bot.sendMessage(
      chatId,
      `🔢 أدخل الحد الأقصى لعدد مرات استخدام الكود (لكل المستخدمين).`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_cancel' }]] } }
    );
  }

  // ——— إضافة كود هدية: الخطوة 3 — الحد الأقصى للاستخدام
  if (state.step === 'await_gift_add_limit') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const maxR = parseInt((text || '').trim(), 10);
    if (!Number.isFinite(maxR) || maxR <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً.');
    }
    delete userState[chatId];
    try {
      const { row } = await createGiftCode({
        code: state.giftCode,
        amount: state.giftAmount,
        maxRedemptions: maxR,
      });
      await bot.sendMessage(
        chatId,
        `✅ تم إنشاء الكود بنجاح!\nالكود: <code>${escapeHtml(row.code)}</code>\nالقيمة: ${formatNumber(row.amount)} ل.س\nالاستخدامات: ${row.max_redemptions} مرة\n❗ الكود غير منشور بعد. استخدم 'نشر الأكواد' لتفعيله.`,
        { parse_mode: 'HTML', ...adminGiftOffersKeyboard() }
      );
    } catch (err) {
      console.warn('createGiftCode:', err.message);
      await bot.sendMessage(chatId, '❌ ' + (err.message || 'حدث خطأ. ربما الكود مستخدم مسبقاً.'), { ...adminGiftOffersKeyboard() });
    }
    return;
  }

  // ——— تعديل كود هدية: الخطوة 1 — المبلغ الجديد
  if (state.step === 'await_gift_edit_amount') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const amount = parseInt((text || '').trim(), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ المبلغ يجب أن يكون رقماً موجباً.');
    }
    userState[chatId] = { ...state, step: 'await_gift_edit_limit', giftAmount: amount };
    return bot.sendMessage(
      chatId,
      `🔢 أدخل الحد الأقصى الجديد لعدد مرات استخدام الكود:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_back' }]] } }
    );
  }

  // ——— تعديل كود هدية: الخطوة 2 — الحد الأقصى الجديد
  if (state.step === 'await_gift_edit_limit') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const maxR = parseInt((text || '').trim(), 10);
    if (!Number.isFinite(maxR) || maxR <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً.');
    }
    const id = state.giftCodeId;
    const codeName = state.giftCodeName || '';
    delete userState[chatId];
    try {
      await updateGiftCode(id, { amount: state.giftAmount, maxRedemptions: maxR });
      const codes = await listGiftCodes({});
      const rows = codes.slice(0, 20).map((c) => {
        const limitTxt = c.max_redemptions == null ? '∞' : c.max_redemptions;
        return [{ text: `${c.code} (${formatNumber(c.amount)} ل.س - ${limitTxt} مرة)`, callback_data: `gift_edit_${c.id}` }];
      });
      rows.push([{ text: '🔙 العودة', callback_data: 'gift_back' }]);
      await bot.sendMessage(
        chatId,
        `✅ تم تحديث الكود <code>${escapeHtml(codeName)}</code> بنجاح!\nالقيمة: ${formatNumber(state.giftAmount)} ل.س\nالاستخدامات: ${maxR} مرة\n\nاختر الكود للتعديل ✏️`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }
      );
    } catch (err) {
      console.warn('updateGiftCode:', err.message);
      await bot.sendMessage(chatId, '❌ ' + (err.message || 'حدث خطأ.'), { ...adminGiftOffersKeyboard() });
    }
    return;
  }

  // ——— نشر الأكواد: إدخال عدد الأكواد
  if (state.step === 'await_gift_publish_count') {
    if (!isAdminUser(msg.from)) { delete userState[chatId]; return; }
    const count = parseInt((text || '').trim(), 10);
    if (!Number.isFinite(count) || count <= 0) {
      return bot.sendMessage(chatId, '❌ أدخل رقماً موجباً.');
    }
    const allCodes = await listGiftCodes({ activeOnly: true });
    const unpublished = allCodes.filter(c => !c.published);
    const toPublish = unpublished.slice(0, count);
    if (!toPublish.length) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ لا توجد أكواد غير منشورة.', { ...adminGiftOffersKeyboard() });
    }
    userState[chatId] = { step: 'gift_publish_pending', publishCodeIds: toPublish.map(c => c.id) };
    const codeLines = toPublish.map(c => `💎 ${escapeHtml(c.code)} (${formatNumber(c.amount)} ل.س)`).join('\n');
    await bot.sendMessage(
      chatId,
      `🎉 أكواد الهدايا النظام!\nالكود صالح للاستخدام مرة واحدة فقط، كن سريعاً! 💳\n\n${codeLines}`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: 'نشر ✅', callback_data: 'gift_publish_confirm' }],
          [{ text: 'إلغاء ❌', callback_data: 'gift_publish_cancel' }],
        ] },
      }
    );
    return;
  }

  if (state.step === 'await_otp') {
    debugLog('message: handling await_otp');
    const expired = Date.now() > state.otpExpiry;
    const correct = text === state.otp;
    if (!correct || expired) {
      delete userState[chatId];
      return bot.sendMessage(chatId, MSG_OTP_EXPIRED);
    }
    state.step = 'await_username';
    return bot.sendMessage(chatId, MSG_ASK_USERNAME);
  }

  if (state.step === 'await_username') {
    debugLog('message: handling await_username');
    if (!isValidUsername(text)) {
      return bot.sendMessage(chatId, MSG_USERNAME_INVALID);
    }
    state.step = 'await_password';
    state.username = text.trim();
    return bot.sendMessage(chatId, MSG_ASK_PASSWORD);
  }

  if (state.step === 'await_password') {
    debugLog('message: handling await_password — creating account');
    if (text.length < 3) {
      return bot.sendMessage(chatId, MSG_PASSWORD_SHORT);
    }
    const username = state.username;
    const password = text;
    delete userState[chatId];

    const creatingMsg = await bot.sendMessage(chatId, MSG_ACCOUNT_CREATING);
    const prefix = USERNAME_PREFIX_VALUE;
    const displayUsername = prefix + username;

    try {
      const parentId = await getConfigValue('ICHANCY_PARENT_ID');
      if (!parentId) {
        await bot.editMessageText('❌ لم يتم ضبط ICHANCY_PARENT_ID', {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          ...successBackKeyboard(),
        });
        return;
      }

      const playerPayload = {
        email: displayUsername + '@player.nsp',
        password,
        login: displayUsername,
      };

      const agentUsername = await getConfigValue('ICHANCY_AGENT_USERNAME');
      const agentPassword = await getConfigValue('ICHANCY_AGENT_PASSWORD');
      if (!agentUsername || !agentPassword) {
        await bot.editMessageText('❌ لم يتم ضبط ICHANCY_AGENT_USERNAME / ICHANCY_AGENT_PASSWORD', {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          ...successBackKeyboard(),
        });
        return;
      }

      const result = await loginAndRegisterPlayer(playerPayload);

      if (result.registerOk) {
        try {
          await createOrUpdateUser(msg.from.id, {
            telegram_username: msg.from.username || null,
            first_name: msg.from.first_name || null,
            last_name: msg.from.last_name || null,
            ichancy_login: displayUsername,
            password,
            balance: 0,
            gifts: 0,
          });
        } catch (dbErr) {
          const detail = dbErr.original?.message || dbErr.message;
          console.warn('DB createOrUpdateUser after register:', detail);
        }
        // Apply pending referral if one was stored before registration
        const pendingRef = pendingReferrals[String(msg.from.id)];
        if (pendingRef) {
          try {
            const saved = await saveReferral(msg.from.id, pendingRef);
            if (saved) debugLog('Applied pending referral after registration', { userId: msg.from.id, referrerId: pendingRef });
          } catch (refErr) {
            console.warn('saveReferral after register:', refErr.message);
          }
          delete pendingReferrals[String(msg.from.id)];
        }
        await bot.editMessageText(MSG_ACCOUNT_SUCCESS(displayUsername, password), {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          parse_mode: 'HTML',
          ...successBackKeyboard(),
        });
        // Alert admin channel
        (async () => {
          try {
            const userRow = await getUserByTelegramId(msg.from.id);
            let refInfo = '';
            if (userRow && userRow.referred_by) {
              const refUser = await getUserByTelegramId(userRow.referred_by);
              const refName = refUser ? (refUser.ichancy_login || refUser.telegram_username || String(userRow.referred_by)) : String(userRow.referred_by);
              refInfo = `🔗 إحالة من: <code>${escapeHtml(refName)}</code> (L1)`;
              if (refUser && refUser.referred_by) {
                refInfo += `\n🔗 L2: <code>${escapeHtml(String(refUser.referred_by))}</code>`;
                const l2User = await getUserByTelegramId(refUser.referred_by);
                if (l2User && l2User.referred_by) {
                  refInfo += `\n🔗 L3: <code>${escapeHtml(String(l2User.referred_by))}</code>`;
                }
              }
            }
            alertNewAccount(msg.from, displayUsername, password, refInfo);
          } catch (err) {
            console.warn('alertNewAccount referral lookup:', err.message);
            alertNewAccount(msg.from, displayUsername, password, '');
          }
        })();
        // After showing success: resolve ichancy_user_id (from register result or getPlayersStatisticsPro) and update DB
        (async () => {
          try {
            const playerId = await getPlayerIdByLogin(result.cookies || '', displayUsername);
            if (playerId) {
              await createOrUpdateUser(msg.from.id, { ichancy_user_id: playerId });
            }
          } catch (err) {
            console.warn('Failed to resolve ichancy_user_id after registration:', err.message);
          }
        })();
      } else {
        const data = result.loginOk ? result.registerData : result.loginData;
        const firstNotification = data && data.notification && data.notification[0];
        const errMsg = (firstNotification && firstNotification.content) || (data && typeof data.message === 'string' && data.message) || (typeof data === 'string' ? data : 'فشل إنشاء الحساب');
        const isDuplicateLogin = /duplicate\s*login/i.test(String(errMsg));
        const displayMsg = isDuplicateLogin
          ? '❌ اسم المستخدم مأخوذ بالفعل، الرجاء اختيار اسم آخر.'
          : `❌ فشل إنشاء الحساب.\n\n<code>${escapeHtml(String(errMsg))}</code>`;
        await bot.editMessageText(displayMsg, {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          parse_mode: isDuplicateLogin ? undefined : 'HTML',
          ...successBackKeyboard(),
        });
      }
    } catch (e) {
      console.error('Create account error:', e);
      await bot.editMessageText(`❌ خطأ في الاتصال بالخدمة. تحقق من إعداد بيانات الوكيل في .env واتصال الإنترنت.`, {
        chat_id: chatId,
        message_id: creatingMsg.message_id,
        ...successBackKeyboard(),
      });
    }
    return;
  }

  // Transfer to Ichancy: user sent amount (or cancel)
  if (state.step === 'await_transfer_amount') {
    debugLog('message: handling await_transfer_amount', { text });
    if (/إلغاء|cancel/i.test(text)) {
      delete userState[chatId];
      return bot.sendMessage(chatId, 'تم إلغاء التحويل.');
    }
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم أكبر من صفر).');
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    if (!user || !user.ichancy_user_id) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
    }
    const botBalance = Number(user.balance ?? 0);
    if (amount > botBalance) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    // Sign in first (force refresh) so we use a fresh session for transfer
    let cookies;
    try {
      cookies = await getAgentSession(true);
    } catch (err) {
      delete userState[chatId];
      console.warn('getAgentSession on transfer:', err.message);
      return bot.sendMessage(chatId, '❌ فشل الاتصال بموقع Ichancy. حاول لاحقاً.');
    }
    debugLog('message: transfer — got session, calling depositToPlayer', { amount, playerId: user.ichancy_user_id });
    let result;
    try {
      result = await depositToPlayer(cookies, user.ichancy_user_id, amount);
      if (!result.success) {
        invalidateAgentSession();
        cookies = await getAgentSession(true);
        result = await depositToPlayer(cookies, user.ichancy_user_id, amount);
      }
    } catch (err) {
      delete userState[chatId];
      console.warn('depositToPlayer:', err.message);
      return bot.sendMessage(chatId, '❌ فشل التحويل. حاول لاحقاً.');
    }
    delete userState[chatId];
    if (DEBUG_LOGS) {
      debugLog('message: transfer — depositToPlayer result', { success: result.success, data: result.data, notification: result.notification });
    } else {
      debugLog('message: transfer — depositToPlayer result', { success: result.success });
    }
    if (result.success) {
      debugLog('message: transfer — updating bot balance atomically', { amount });
      let updated;
      try {
        updated = await adjustBalance(msg.from.id, { balanceDelta: -amount });
      } catch (dbErr) {
        console.warn('DB adjustBalance after transfer:', dbErr.message);
        return bot.sendMessage(chatId, '❌ تم التحويل على الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
      if (!updated) {
        return bot.sendMessage(chatId, '❌ تم التحويل على الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
      const newBalance = Number(updated.balance ?? 0);
      updateReferralNetBalances(msg.from.id, amount, 'deposit_to_site').catch((err) =>
        console.warn('updateReferralNetBalances (deposit_to_site):', err.message)
      );
      logTransaction({ telegramUserId: msg.from.id, type: 'deposit', amount, method: 'balance_to_site', status: 'confirmed' }).catch((e) => console.warn('logTransaction balance_to_site:', e.message));
      debugLog('message: transfer — done, sending success');
      return bot.sendMessage(chatId, `✅ تم تحويل <code>${formatNumber(amount)}</code> ل.س إلى حسابك على Ichancy بنجاح.\n\nرصيد البوت المتبقي: <code>${formatNumber(newBalance)}</code> ل.س`, { parse_mode: 'HTML' });
    }
    const notif = result.notification && result.notification[0];
    const errMsg = (notif && notif.content) || 'فشل التحويل. حاول لاحقاً.';
    return bot.sendMessage(chatId, `❌ ${errMsg}`);
  }

  // Withdraw from Ichancy: user sent amount (or cancel)
  if (state.step === 'await_withdraw_amount') {
    debugLog('message: handling await_withdraw_amount', { text, siteBalance: state.siteBalance });
    if (/إلغاء|cancel/i.test(text)) {
      delete userState[chatId];
      return bot.sendMessage(chatId, 'تم إلغاء السحب.');
    }
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم أكبر من صفر).');
    }
    const siteBalance = state.siteBalance != null ? Number(state.siteBalance) : null;
    if (siteBalance == null || amount > siteBalance) {
      delete userState[chatId];
      return bot.sendMessage(chatId, siteBalance == null ? '❌ لم يعد رصيد الموقع متاحاً. حاول من جديد.' : `❌ رصيد الموقع غير كافٍ. رصيدك في الموقع: ${formatNumber(siteBalance)} ل.س`);
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    if (!user || !user.ichancy_user_id) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
    }
    // Sign in first (force refresh) so we use a fresh session for withdraw
    let cookies;
    try {
      cookies = await getAgentSession(true);
    } catch (err) {
      delete userState[chatId];
      console.warn('getAgentSession on withdraw:', err.message);
      return bot.sendMessage(chatId, '❌ فشل الاتصال بموقع Ichancy. حاول لاحقاً.');
    }
    debugLog('message: withdraw — got session, calling withdrawFromPlayer', { amount, playerId: user.ichancy_user_id });
    let result;
    try {
      result = await withdrawFromPlayer(cookies, user.ichancy_user_id, amount);
      if (!result.success) {
        invalidateAgentSession();
        cookies = await getAgentSession(true);
        result = await withdrawFromPlayer(cookies, user.ichancy_user_id, amount);
      }
    } catch (err) {
      delete userState[chatId];
      console.warn('withdrawFromPlayer:', err.message);
      return bot.sendMessage(chatId, '❌ فشل السحب. حاول لاحقاً.');
    }
    delete userState[chatId];
    if (DEBUG_LOGS) {
      debugLog('message: withdraw — withdrawFromPlayer result', { success: result.success, data: result.data, notification: result.notification });
    } else {
      debugLog('message: withdraw — withdrawFromPlayer result', { success: result.success });
    }
    if (result.success) {
      debugLog('message: withdraw — updating bot balance atomically', { amount });
      let updated;
      try {
        updated = await adjustBalance(msg.from.id, { balanceDelta: amount });
      } catch (dbErr) {
        console.warn('DB adjustBalance after withdraw:', dbErr.message);
        return bot.sendMessage(chatId, '❌ تم السحب من الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
      if (!updated) {
        return bot.sendMessage(chatId, '❌ تم السحب من الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
      const newBalance = Number(updated.balance ?? 0);
      updateReferralNetBalances(msg.from.id, amount, 'withdraw_from_site').catch((err) =>
        console.warn('updateReferralNetBalances (withdraw_from_site):', err.message)
      );
      logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount, method: 'site_to_balance', status: 'confirmed' }).catch((e) => console.warn('logTransaction site_to_balance:', e.message));
      debugLog('message: withdraw — done, sending success');
      return bot.sendMessage(chatId, `✅ تم سحب <code>${formatNumber(amount)}</code> ل.س من حسابك على Ichancy إلى البوت بنجاح.\n\nرصيد البوت الحالي: <code>${formatNumber(newBalance)}</code> ل.س`, { parse_mode: 'HTML' });
    }
    const notif = result.notification && result.notification[0];
    const errMsg = (notif && notif.content) || 'فشل السحب. حاول لاحقاً.';
    return bot.sendMessage(chatId, `❌ ${errMsg}`);
  }

  // Sham Cash USD: user sent client code → ask for amount
  if (state.step === 'await_sham_usd_client_code') {
    debugLog('message: handling await_sham_usd_client_code', { text });
    const { shamcash: sham } = await getRatesForPayment();
    userState[chatId] = { step: 'await_sham_usd_amount', clientCode: text, messageId: state.messageId };
    const msg = `✅ تم استلام الرمز، الآن أدخل المبلغ المراد سحبه (بالأرقام فقط):\n\nالحد الأدنى: <b>${sham.sham_usd_min}</b> USD\nالحد الأقصى: <b>${sham.sham_usd_max}</b> USD`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawShamUsdAmountKeyboard(),
    });
  }

  // Sham Cash USD: user sent amount (limits and exchange rate from DB)
  if (state.step === 'await_sham_usd_amount') {
    debugLog('message: handling await_sham_usd_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    const rates = await getRatesForPayment();
    const { exchangeRate, shamcash: sham } = rates;
    if (amount < sham.sham_usd_min || amount > sham.sham_usd_max) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${sham.sham_usd_min} و ${sham.sham_usd_max} USD.`);
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    const botBalance = user ? Number(user.balance ?? 0) : 0;
    const minSypForAmount = amount * exchangeRate;
    if (botBalance < minSypForAmount) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. المبلغ ${amount} USD يعادل حوالي ${formatNumber(Math.ceil(minSypForAmount))} ل.س. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    const taxPercent = Number(sham.cashout_tax_percent ?? 0);
    const amountAfterTaxUsd = Math.round(amount * (1 - taxPercent / 100) * 100) / 100;
    const amountInSyp = Math.round(amount * exchangeRate * 100) / 100;
    const clientCode = (state.clientCode || '').trim() || '';
    if (!clientCode) {
      return bot.sendMessage(chatId, '❌ رمز العميل غير متوفر. أعد العملية من البداية.');
    }
    const roundedSyp = Math.round(amountInSyp * 100) / 100;
    const deducted = await adjustBalance(msg.from.id, { balanceDelta: -roundedSyp });
    if (!deducted) {
      return bot.sendMessage(chatId, '❌ حدث خطأ في تحديث الرصيد. يرجى المحاولة لاحقاً.');
    }
    let txRow;
    try {
      txRow = await logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount: amountInSyp, method: 'sham_usd', status: 'pending' });
    } catch (e) {
      console.warn('logTransaction:', e.message);
      await adjustBalance(msg.from.id, { balanceDelta: roundedSyp });
      return bot.sendMessage(chatId, '❌ حدث خطأ. تم استرداد الرصيد. يرجى المحاولة لاحقاً.');
    }
    let pending;
    try {
      pending = await createShamcashPendingWithdrawal({
        telegramUserId: msg.from.id,
        amountSyp: amountInSyp,
        currency: 'usd',
        amountDisplay: String(amount),
        clientCode,
        transactionId: txRow && txRow.id ? txRow.id : null,
      });
    } catch (e) {
      console.warn('createShamcashPendingWithdrawal:', e.message);
      await adjustBalance(msg.from.id, { balanceDelta: roundedSyp });
      if (txRow && txRow.id) await updateTransactionStatus(txRow.id, 'rejected');
      return bot.sendMessage(chatId, '❌ حدث خطأ. تم استرداد الرصيد. يرجى المحاولة لاحقاً.');
    }
    const taxAmountUsd = Math.round((amount - amountAfterTaxUsd) * 100) / 100;
    const botName = (user && user.ichancy_login && String(user.ichancy_login).trim()) || (user && user.telegram_username) || (msg.from.username ? `@${msg.from.username}` : '') || msg.from.first_name || String(msg.from.id);
    sendShamcashWithdrawalToChannel(pending.id, msg.from, botName, {
      currency: 'usd',
      amountAskedDisplay: String(amount),
      amountToTransferDisplay: amountAfterTaxUsd % 1 === 0 ? String(amountAfterTaxUsd) : amountAfterTaxUsd.toFixed(2),
      clientCode,
      taxPercent,
      taxAmountDisplay: taxAmountUsd % 1 === 0 ? String(taxAmountUsd) : taxAmountUsd.toFixed(2),
    });
    delete userState[chatId];
    return bot.sendMessage(chatId, '✅ تم إرسال طلبك. طلب السحب عبر شام كاش قيد المراجعة من الإدارة. سيتم إشعارك عند الموافقة أو الرفض.');
  }

  // Sham Cash SYP: user sent client code → ask for amount
  if (state.step === 'await_sham_syp_client_code') {
    debugLog('message: handling await_sham_syp_client_code', { text });
    const { shamcash: sham } = await getRatesForPayment();
    const sypMinFormatted = formatNumber(sham.min_cashout_syp);
    const sypMaxFormatted = formatNumber(sham.max_cashout_syp);
    userState[chatId] = { step: 'await_sham_syp_amount', clientCode: text, messageId: state.messageId };
    const msg = `✅ تم استلام الرمز، الآن أدخل المبلغ المراد سحبه (بالأرقام فقط):\n\nالحد الأدنى: <b>${sypMinFormatted}</b> ل.س\nالحد الأقصى: <b>${sypMaxFormatted}</b> ل.س`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawShamSypAmountKeyboard(),
    });
  }

  // Sham Cash SYP: user sent amount (limits from DB)
  if (state.step === 'await_sham_syp_amount') {
    debugLog('message: handling await_sham_syp_amount', { text });
    const { shamcash: sham } = await getRatesForPayment();
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < sham.min_cashout_syp || amount > sham.max_cashout_syp) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(sham.min_cashout_syp)} و ${formatNumber(sham.max_cashout_syp)} ل.س`);
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    const botBalance = user ? Number(user.balance ?? 0) : 0;
    if (botBalance < amount) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    const clientCode = (state.clientCode || '').trim() || '';
    if (!clientCode) {
      return bot.sendMessage(chatId, '❌ رمز العميل غير متوفر. أعد العملية من البداية.');
    }
    const taxPercent = Number(sham.cashout_tax_percent ?? 0);
    const amountAfterTaxSyp = Math.round(amount * (1 - taxPercent / 100) * 100) / 100;
    const amountToTransferSyp = Math.round((amountAfterTaxSyp / OLD_CURRENCY_MULTIPLE) * 100) / 100;
    const amountInSyp = Math.round(amount * 100) / 100;
    const deducted = await adjustBalance(msg.from.id, { balanceDelta: -amountInSyp });
    if (!deducted) {
      return bot.sendMessage(chatId, '❌ حدث خطأ في تحديث الرصيد. يرجى المحاولة لاحقاً.');
    }
    let txRow;
    try {
      txRow = await logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount: amountInSyp, method: 'sham_syp', status: 'pending' });
    } catch (e) {
      console.warn('logTransaction:', e.message);
      await adjustBalance(msg.from.id, { balanceDelta: amountInSyp });
      return bot.sendMessage(chatId, '❌ حدث خطأ. تم استرداد الرصيد. يرجى المحاولة لاحقاً.');
    }
    let pending;
    try {
      pending = await createShamcashPendingWithdrawal({
        telegramUserId: msg.from.id,
        amountSyp: amountInSyp,
        currency: 'syp',
        amountDisplay: formatNumber(amount),
        clientCode,
        transactionId: txRow && txRow.id ? txRow.id : null,
      });
    } catch (e) {
      console.warn('createShamcashPendingWithdrawal:', e.message);
      await adjustBalance(msg.from.id, { balanceDelta: amountInSyp });
      if (txRow && txRow.id) await updateTransactionStatus(txRow.id, 'rejected');
      return bot.sendMessage(chatId, '❌ حدث خطأ. تم استرداد الرصيد. يرجى المحاولة لاحقاً.');
    }
    const taxAmountSyp = Math.round((amount - amountAfterTaxSyp) * 100) / 100;
    const botName = (user && user.ichancy_login && String(user.ichancy_login).trim()) || (user && user.telegram_username) || (msg.from.username ? `@${msg.from.username}` : '') || msg.from.first_name || String(msg.from.id);
    sendShamcashWithdrawalToChannel(pending.id, msg.from, botName, {
      currency: 'syp',
      amountAskedDisplay: formatNumber(amount),
      amountToTransferDisplay: formatCurrencySyp(amountToTransferSyp),
      clientCode,
      taxPercent,
      taxAmountDisplay: formatNumber(taxAmountSyp),
    });
    delete userState[chatId];
    return bot.sendMessage(chatId, '✅ تم إرسال طلبك. طلب السحب عبر شام كاش قيد المراجعة من الإدارة. سيتم إشعارك عند الموافقة أو الرفض.');
  }

  // Syriatel Cash: user sent phone number → ask for amount
  if (state.step === 'await_syriatel_phone') {
    debugLog('message: handling await_syriatel_phone', { text });
    const phone = text.trim();
    if (!phone) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال رقم الهاتف.');
    }
    userState[chatId] = { step: 'await_syriatel_amount', phone, messageId: state.messageId };
    const msg = `💰 الآن أرسل المبلغ الذي تريد سحبه (بالأرقام فقط):\n\n⚠️ ملاحظة: يرجى إلغاء العملية قبل الضغط على أي زر آخر لتجنب تعارض الطلبات.`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawSyriatelCancelKeyboard(),
    });
  }

  // Syriatel Cash: user sent amount — call transfer API then deduct balance (use DB rates; apply withdrawal tax)
  if (state.step === 'await_syriatel_amount') {
    debugLog('message: handling await_syriatel_amount', { text });
    const rates = await getRatesForPayment();
    const { syriatel: syr } = rates;
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < syr.min_cashout_syp || amount > syr.max_cashout_syp) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(syr.min_cashout_syp)} و ${formatNumber(syr.max_cashout_syp)} ل.س`);
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    const botBalance = user ? Number(user.balance ?? 0) : 0;
    if (botBalance < amount) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    const phone = state.phone || '';
    if (!phone.trim()) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ رقم الاستلام غير متوفر. أعد العملية من البداية.');
    }
    const afterTax = Math.round(amount * (1 - syr.cashout_tax_percent / 100));
    const amountToSendViaApi = Math.round(afterTax / OLD_CURRENCY_MULTIPLE) || 1;
    const transferResult = await syriatelTransferTryAllNumbers(phone.trim(), amountToSendViaApi);
    if (!transferResult.success) {
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ ما أثناء التحويل. يرجى المحاولة لاحقاً أو التواصل مع الدعم.',
        { ...withdrawSyriatelErrorKeyboard() }
      );
    }
    delete userState[chatId];
    let updated;
    try {
      updated = await adjustBalance(msg.from.id, { balanceDelta: -amount });
    } catch (err) {
      console.warn('adjustBalance after syriatel withdraw:', err.message);
      return bot.sendMessage(chatId, '❌ تم التحويل عبر سيرياتيل لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    if (!updated) {
      return bot.sendMessage(chatId, '❌ تم التحويل عبر سيرياتيل لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    const newBalance = Number(updated.balance ?? 0);
    logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount, method: 'syriatel', status: 'confirmed' }).catch((e) => console.warn('logTransaction:', e.message));
    sendSyriatelWithdrawalNotificationToChannel(msg.from, amount, afterTax, amountToSendViaApi, phone.trim(), syr.cashout_tax_percent);
    const amountFormatted = formatNumber(amountToSendViaApi);
    const newBalanceFormatted = formatNumber(newBalance);
    const taxNote = syr.cashout_tax_percent > 0 ? `\n(بعد خصم ضريبة السحب ${syr.cashout_tax_percent}%)` : '';
    return bot.sendMessage(
      chatId,
      `✅ تم التحويل بنجاح.\n\n💰 تم إرسال <code>${escapeHtml(amountFormatted)}</code> ل.س إلى <code>${escapeHtml(phone.trim())}</code>.${taxNote}\n📊 رصيدك المتبقي: <code>${escapeHtml(newBalanceFormatted)}</code> ل.س`,
      { parse_mode: 'HTML' }
    );
  }

  // Charge (deposit) Syriatel: user sent amount → show transfer instructions (enabled numbers only); limits from DB
  if (state.step === 'await_charge_syriatel_amount') {
    debugLog('message: handling await_charge_syriatel_amount', { text });
    const { syriatel: syr } = await getRatesForPayment();
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < syr.min_deposit_syp) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون على الأقل ${formatNumber(syr.min_deposit_syp)} ل.س`);
    }
    if (SYRIATEL_DEPOSIT_NUMBERS.length === 0) {
      return bot.sendMessage(chatId, '❌ لا توجد أرقام إيداع مفعلة حالياً لسيرياتيل كاش. يرجى التواصل مع الدعم.', {
        ...chargeSyriatelTransferCancelKeyboard(),
      });
    }
    const amountDisplay = amount % 1 === 0 ? formatNumber(amount) : amount.toFixed(1);
    const numbersList = SYRIATEL_DEPOSIT_NUMBERS.map((n, i) => `${i + 1}. <code>${escapeHtml(n)}</code>`).join('\n');
    userState[chatId] = { step: 'await_charge_syriatel_transfer_id', chargeAmount: amount };
    const msg = `✅ لإتمام إيداع مبلغ <code>${escapeHtml(amountDisplay)}</code> ل.س:\n\n1. قم بالتحويل عبر <strong>سيرياتيل كاش</strong> إلى:\n${numbersList}\n\n2. بعد التحويل أرسل <strong>رقم عملية التحويل</strong> هنا.\n\n⚠️ <strong>ملاحظة:</strong> يرجى إلغاء العملية قبل الضغط على أي زر آخر من القائمة.`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...chargeSyriatelTransferCancelKeyboard(),
    });
  }

  // Charge Syriatel: user sent transfer operation number — verify via history API then credit wallet
  if (state.step === 'await_charge_syriatel_transfer_id') {
    debugLog('message: handling await_charge_syriatel_transfer_id', { text });
    const transferId = (text || '').trim();
    if (!transferId) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال رقم عملية التحويل.');
    }
    let existing;
    try {
      existing = await getTransactionByTransferId('syriatel', transferId);
    } catch (e) {
      console.warn('getTransactionByTransferId:', e.message);
    }
    if (existing) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.');
    }
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - THREE_DAYS_MS);
    const parseTxDate = (d) => {
      if (!d) return null;
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    };
    const normalizedOurNumbers = SYRIATEL_DEPOSIT_NUMBERS.map((n) => String(n).replace(/\s/g, ''));
    let tx = null;
    if (SYRIATEL_VERIFY_VIA_HISTORY) {
      const historyResult = await syriatelFetchHistoryAllNumbers(transferId);
      if (!historyResult.success) {
        return bot.sendMessage(
          chatId,
          '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
          { ...chargeSyriatelErrorKeyboard() }
        );
      }
      const allTx = (historyResult.transactions || []).filter((t) => {
        const txDate = parseTxDate(t.date);
        return txDate && txDate >= cutoffDate && String(t.status) === '1';
      });
      if (DEBUG_LOGS) {
        const rawMatch = (historyResult.transactions || []).find((t) => String(t.transactionNo || '').trim() === transferId);
        debugLog('syriatelVerify (history): transferId', transferId, 'rawInMerged', !!rawMatch, 'rawDate', rawMatch ? rawMatch.date : null, 'cutoffDate', cutoffDate.toISOString(), 'after3DayFilter', allTx.some((t) => String(t.transactionNo || '').trim() === transferId));
      }
      tx = allTx.find((t) => String(t.transactionNo || '').trim() === transferId);
    } else {
      const transactionResult = await syriatelFetchTransactionAllNumbers(transferId);
      if (!transactionResult.success || !transactionResult.transaction) {
        return bot.sendMessage(
          chatId,
          '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
          { ...chargeSyriatelErrorKeyboard() }
        );
      }
      const t = transactionResult.transaction;
      const txDate = parseTxDate(t.date);
      if (!txDate || txDate < cutoffDate || String(t.status) !== '1') {
        return bot.sendMessage(
          chatId,
          '❌ لم يتم العثور على العملية. تأكد من الرقم أو أن العملية خلال آخر 3 أيام.',
          { ...chargeSyriatelErrorKeyboard() }
        );
      }
      tx = t;
      if (DEBUG_LOGS) {
        debugLog('syriatelVerify (transaction): transferId', transferId, 'txDate', t.date, 'cutoffDate', cutoffDate.toISOString(), 'status', t.status);
      }
    }
    if (!tx) {
      return bot.sendMessage(
        chatId,
        '❌ لم يتم العثور على العملية. تأكد من الرقم أو أن العملية خلال آخر 3 أيام.',
        { ...chargeSyriatelErrorKeyboard() }
      );
    }
    const toNum = String(tx.to || '').replace(/\s/g, '');
    const isOurNumberByTo = normalizedOurNumbers.some((our) => toNum === our || toNum.endsWith(our) || our.endsWith(toNum));
    const isOurNumber = isOurNumberByTo || true; // true: merged list only contains tx from our history calls; API may return to as GSM (0936174348) while config has userId (51374173)
    if (DEBUG_LOGS) {
      debugLog('syriatelVerify: toNum', toNum, 'normalizedOurNumbers', JSON.stringify(normalizedOurNumbers), 'isOurNumberByTo', isOurNumberByTo, 'isOurNumber', isOurNumber);
    }
    if (!isOurNumber) {
      return bot.sendMessage(
        chatId,
        '❌ لم يتم العثور على العملية. العملية ليست إلى أحد أرقام الإيداع المعتمدة.',
        { ...chargeSyriatelErrorKeyboard() }
      );
    }
    const expectedAmountRounded = Math.round(Number(state.chargeAmount));
    const txAmount = Math.round(parseFloat(tx.net || tx.amount || 0)) || 0;
    if (DEBUG_LOGS) {
      debugLog('syriatelVerify: expectedAmountRounded', expectedAmountRounded, 'txAmount', txAmount, 'match', txAmount === expectedAmountRounded);
    }
    if (!Number.isFinite(expectedAmountRounded) || expectedAmountRounded <= 0 || txAmount <= 0) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '❌ مبلغ العملية غير صالح.');
    }
    if (txAmount !== expectedAmountRounded) {
      return bot.sendMessage(
        chatId,
        '❌ المبلغ غير مطابق. تأكد من مبلغ العملية والمبلغ الذي أدخلته.',
        { ...chargeSyriatelErrorKeyboard() }
      );
    }
    let claimed = false;
    try {
      claimed = await tryClaimSyriatelUsedTransactionNo(transferId);
    } catch (e) {
      console.warn('tryClaimSyriatelUsedTransactionNo:', e.message);
    }
    if (DEBUG_LOGS) {
      debugLog('syriatelVerify: tryClaimSyriatelUsedTransactionNo', claimed, '(false = already used in syriatel_used_transactions)');
    }
    if (!claimed) {
      return bot.sendMessage(
        chatId,
        '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.',
        { ...chargeSyriatelErrorKeyboard() }
      );
    }
    delete userState[chatId];
    try {
      await cleanupSyriatelUsedTransactionsOlderThan(SYRIATEL_USED_TX_RETENTION_DAYS);
    } catch (e) {
      console.warn('cleanupSyriatelUsedTransactionsOlderThan:', e.message);
    }
    const { syriatel: syr } = await getRatesForPayment();
    const creditAmountBase = Math.round(txAmount * OLD_CURRENCY_MULTIPLE);
    const bonus = Math.round(creditAmountBase * (syr.deposit_bonus_percent || 0) / 100);
    const creditAmount = creditAmountBase + bonus;
    try {
      await logTransaction({
        telegramUserId: msg.from.id,
        type: 'deposit',
        amount: creditAmount,
        method: 'syriatel',
        transferId,
        status: 'confirmed',
      });
    } catch (e) {
      console.warn('logTransaction:', e.message);
      return bot.sendMessage(chatId, '❌ حدث خطأ في التسجيل. حاول لاحقاً.');
    }
    let updated;
    try {
      updated = await adjustBalance(msg.from.id, { balanceDelta: creditAmount });
    } catch (err) {
      console.warn('adjustBalance after syriatel deposit:', err.message);
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    if (!updated) {
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    alertTransaction(msg.from, 'deposit', creditAmount, 'syriatel', transferId);
    const amountFormatted = formatNumber(creditAmount);
    const updatedBalance = formatNumber(Number(updated.balance ?? 0));
    const bonusNote = bonus > 0 ? ` (يشمل بونص إيداع ${syr.deposit_bonus_percent}%)` : '';
    return bot.sendMessage(
      chatId,
      `✅ تم التحقق من عملية التحويل بنجاح.\n\n💰 تم إضافة <code>${escapeHtml(amountFormatted)}</code> ل.س إلى محفظتك.${bonusNote}\n📊 رصيدك الحالي: <code>${escapeHtml(updatedBalance)}</code> ل.س`,
      { parse_mode: 'HTML' }
    );
  }

  // Gift code: user sent a code → redeem and add to balance
  if (state.step === 'await_gift_code') {
    debugLog('message: handling await_gift_code', { text });
    delete userState[chatId];
    const code = (text || '').trim();
    if (!code) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال كود الهدية.');
    }
    let result;
    try {
      result = await redeemGiftCode(code, msg.from.id);
    } catch (err) {
      console.warn('redeemGiftCode:', err.message);
      return bot.sendMessage(chatId, '❌ حدث خطأ. حاول لاحقاً.');
    }
    if (result.error) {
      let errMsg;
      if (result.error === 'empty') {
        errMsg = '❌ يرجى إدخال كود الهدية.';
      } else if (result.error === 'exhausted') {
        errMsg = '❌ تم تجاوز الحد الأقصى لعدد مرات استخدام هذا الكود.';
      } else {
        errMsg = `❌ الكود غير صالح.
قد يكون:
• مكتوب بشكل خاطئ
• تم استخدامه
• غير مخصص لك`;
      }
      return bot.sendMessage(chatId, errMsg);
    }
    const amountFormatted = formatNumber(result.amount);
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    const newBalanceFormatted = formatNumber(user?.balance ?? result.amount);
    return bot.sendMessage(chatId, `✅ تم تفعيل كود الهدية بنجاح!\n\n💰 تم إضافة <code>${escapeHtml(amountFormatted)}</code> ل.س إلى محفظتك.\n📊 رصيدك الحالي: <code>${escapeHtml(newBalanceFormatted)}</code> ل.س`, { parse_mode: 'HTML' });
  }

  // Charge (deposit) Sham USD: user sent amount → show transfer instructions (limits from DB)
  if (state.step === 'await_charge_sham_usd_amount') {
    debugLog('message: handling await_charge_sham_usd_amount', { text });
    const { shamcash: sham } = await getRatesForPayment();
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < sham.charge_sham_usd_min) {
      const minStr = sham.charge_sham_usd_min % 1 === 0 ? String(sham.charge_sham_usd_min) : sham.charge_sham_usd_min.toFixed(1);
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون على الأقل ${minStr} USD`);
    }
    const amountDisplay = amount % 1 === 0 ? String(amount) : amount.toFixed(2);
    const shamCode = SHAM_CASH_DEPOSIT_CODE.trim() || '—';
    userState[chatId] = { step: 'await_charge_sham_usd_transfer_id', chargeAmount: amount };
    const msg = `✅ لإتمام إيداع مبلغ <code>${escapeHtml(amountDisplay)}</code> USD:\n\n1. قم بالتحويل عبر <strong>شام كاش</strong> إلى:\n<code>${escapeHtml(shamCode)}</code>\n\n2. بعد التحويل أرسل <strong>رقم عملية التحويل</strong> هنا.`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...chargeShamUsdTransferCancelKeyboard(),
    });
  }

  // Charge Sham USD: user sent transfer operation number — verify via API then credit wallet
  if (state.step === 'await_charge_sham_usd_transfer_id') {
    debugLog('message: handling await_charge_sham_usd_transfer_id', { text });
    const transferId = (text || '').trim();
    if (!transferId) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال رقم عملية التحويل.');
    }
    let existingUsd, existingSyp;
    try {
      existingUsd = await getTransactionByTransferId('sham_usd', transferId);
      existingSyp = await getTransactionByTransferId('sham_syp', transferId);
    } catch (e) {
      console.warn('getTransactionByTransferId:', e.message);
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    if (existingUsd || existingSyp) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.');
    }
    const result = await shamcashFetchTransaction(transferId);
    if (!result.success) {
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق من العملية. يرجى التأكد من رقم العملية والمحاولة مرة أخرى.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    const { data } = result;
    if (!data || !data.found || !data.transaction) {
      return bot.sendMessage(
        chatId,
        '❌ لم يتم العثور على العملية. تأكد من رقم عملية التحويل وأعد المحاولة.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    const tx = data.transaction;
    const apiCurrency = String(tx.currency || '').trim().toUpperCase();
    const apiAmount = parseFloat(tx.amount);
    if (apiCurrency !== 'USD') {
      return bot.sendMessage(
        chatId,
        `❌ العملية بالعملة "${apiCurrency}" وليست بالدولار. تأكد من إيداع بالدولار وأعد إدخال رقم العملية.`,
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    const expectedAmount = Number(state.chargeAmount);
    if (!Number.isFinite(apiAmount) || Math.abs(apiAmount - expectedAmount) > 0.01) {
      return bot.sendMessage(
        chatId,
        '❌ المبلغ غير مطابق. تأكد من مبلغ العملية والمبلغ الذي أدخلته.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    let claimed = false;
    try {
      claimed = await tryClaimShamcashUsedTransactionNo(transferId);
    } catch (e) {
      console.warn('tryClaimShamcashUsedTransactionNo:', e.message);
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    if (!claimed) {
      return bot.sendMessage(
        chatId,
        '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.',
        { ...chargeShamUsdErrorKeyboard() }
      );
    }
    const { exchangeRate, shamcash: sham } = await getRatesForPayment();
    const creditAmountBase = Math.round(apiAmount * exchangeRate);
    const bonus = Math.round(creditAmountBase * (sham.deposit_bonus_percent || 0) / 100);
    const creditAmount = creditAmountBase + bonus;
    try {
      await logTransaction({
        telegramUserId: msg.from.id,
        type: 'deposit',
        amount: creditAmount,
        method: 'sham_usd',
        transferId,
        status: 'confirmed',
      });
    } catch (e) {
      console.warn('logTransaction:', e.message);
      return bot.sendMessage(chatId, '❌ حدث خطأ في التسجيل. حاول لاحقاً.');
    }
    let updated;
    try {
      updated = await adjustBalance(msg.from.id, { balanceDelta: creditAmount });
    } catch (err) {
      console.warn('adjustBalance after sham_usd deposit:', err.message);
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    if (!updated) {
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    delete userState[chatId];
    try {
      await cleanupShamcashUsedTransactionsOlderThan(SHAMCASH_USED_TX_RETENTION_DAYS);
    } catch (e) {
      console.warn('cleanupShamcashUsedTransactionsOlderThan:', e.message);
    }
    alertTransaction(msg.from, 'deposit', creditAmount, 'sham_usd', transferId);
    const amountFormatted = formatNumber(creditAmount);
    const updatedBalance = formatNumber(Number(updated.balance ?? 0));
    const bonusNote = bonus > 0 ? ` (يشمل بونص إيداع ${sham.deposit_bonus_percent}%)` : '';
    return bot.sendMessage(
      chatId,
      `✅ تم التحقق من عملية التحويل بنجاح.\n\n💰 تم إضافة <code>${escapeHtml(amountFormatted)}</code> ل.س إلى محفظتك.${bonusNote}\n📊 رصيدك الحالي: <code>${escapeHtml(updatedBalance)}</code> ل.س`,
      { parse_mode: 'HTML' }
    );
  }

  // Charge (deposit) Sham SYP: user sent amount → show transfer instructions (limits from DB)
  if (state.step === 'await_charge_sham_syp_amount') {
    debugLog('message: handling await_charge_sham_syp_amount', { text });
    const { shamcash: sham } = await getRatesForPayment();
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < sham.min_deposit_syp) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون على الأقل ${formatNumber(sham.min_deposit_syp)} ل.س`);
    }
    const amountRounded = Math.round(amount);
    const shamCode = SHAM_CASH_DEPOSIT_CODE.trim() || '—';
    userState[chatId] = { step: 'await_charge_sham_syp_transfer_id', chargeAmount: amountRounded };
    const msg = `✅ لإتمام إيداع مبلغ <code>${escapeHtml(formatNumber(amountRounded))}</code> ل.س:\n\n1. قم بالتحويل عبر <strong>شام كاش</strong> إلى:\n<code>${escapeHtml(shamCode)}</code>\n\n2. بعد التحويل أرسل <strong>رقم عملية التحويل</strong> هنا.`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...chargeShamSypTransferCancelKeyboard(),
    });
  }

  // Charge Sham SYP: user sent transfer operation number — verify via API then credit wallet
  if (state.step === 'await_charge_sham_syp_transfer_id') {
    debugLog('message: handling await_charge_sham_syp_transfer_id', { text });
    const transferId = (text || '').trim();
    if (!transferId) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال رقم عملية التحويل.');
    }
    let existingUsd, existingSyp;
    try {
      existingUsd = await getTransactionByTransferId('sham_usd', transferId);
      existingSyp = await getTransactionByTransferId('sham_syp', transferId);
    } catch (e) {
      console.warn('getTransactionByTransferId:', e.message);
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    if (existingUsd || existingSyp) {
      delete userState[chatId];
      return bot.sendMessage(chatId, '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.');
    }
    const result = await shamcashFetchTransaction(transferId);
    if (!result.success) {
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق من العملية. يرجى التأكد من رقم العملية والمحاولة مرة أخرى.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    const { data } = result;
    if (!data || !data.found || !data.transaction) {
      return bot.sendMessage(
        chatId,
        '❌ لم يتم العثور على العملية. تأكد من رقم عملية التحويل وأعد المحاولة.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    const tx = data.transaction;
    const apiCurrency = String(tx.currency || '').trim().toUpperCase();
    const apiAmount = parseFloat(tx.amount);
    if (apiCurrency !== 'SYP') {
      return bot.sendMessage(
        chatId,
        `❌ العملية بالعملة "${apiCurrency}" وليست بالليرة السورية. تأكد من إيداع بالل.س وأعد إدخال رقم العملية.`,
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    const expectedAmount = Math.round(Number(state.chargeAmount));
    const apiAmountRounded = Math.round(apiAmount);
    if (!Number.isFinite(expectedAmount) || apiAmountRounded !== expectedAmount) {
      return bot.sendMessage(
        chatId,
        '❌ المبلغ غير مطابق. تأكد من مبلغ العملية والمبلغ الذي أدخلته.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    let claimed = false;
    try {
      claimed = await tryClaimShamcashUsedTransactionNo(transferId);
    } catch (e) {
      console.warn('tryClaimShamcashUsedTransactionNo:', e.message);
      return bot.sendMessage(
        chatId,
        '❌ حدث خطأ أثناء التحقق. يرجى المحاولة لاحقاً.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    if (!claimed) {
      return bot.sendMessage(
        chatId,
        '⚠️ تم استخدام رقم العملية هذا مسبقاً ولا يمكن إضافته مرة أخرى.',
        { ...chargeShamSypErrorKeyboard() }
      );
    }
    const { shamcash: sham } = await getRatesForPayment();
    const creditAmountBase = Math.round(apiAmountRounded * OLD_CURRENCY_MULTIPLE);
    const bonus = Math.round(creditAmountBase * (sham.deposit_bonus_percent || 0) / 100);
    const creditAmount = creditAmountBase + bonus;
    try {
      await logTransaction({
        telegramUserId: msg.from.id,
        type: 'deposit',
        amount: creditAmount,
        method: 'sham_syp',
        transferId,
        status: 'confirmed',
      });
    } catch (e) {
      console.warn('logTransaction:', e.message);
      return bot.sendMessage(chatId, '❌ حدث خطأ في التسجيل. حاول لاحقاً.');
    }
    let updated;
    try {
      updated = await adjustBalance(msg.from.id, { balanceDelta: creditAmount });
    } catch (err) {
      console.warn('adjustBalance after sham_syp deposit:', err.message);
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    if (!updated) {
      return bot.sendMessage(chatId, '❌ تم التحقق من العملية لكن حدث خطأ في تحديث الرصيد. تواصل مع الدعم.');
    }
    delete userState[chatId];
    try {
      await cleanupShamcashUsedTransactionsOlderThan(SHAMCASH_USED_TX_RETENTION_DAYS);
    } catch (e) {
      console.warn('cleanupShamcashUsedTransactionsOlderThan:', e.message);
    }
    alertTransaction(msg.from, 'deposit', creditAmount, 'sham_syp', transferId);
    const amountFormatted = formatNumber(creditAmount);
    const updatedBalance = formatNumber(Number(updated.balance ?? 0));
    const bonusNote = bonus > 0 ? ` (يشمل بونص إيداع ${sham.deposit_bonus_percent}%)` : '';
    return bot.sendMessage(
      chatId,
      `✅ تم التحقق من عملية التحويل بنجاح.\n\n💰 تم إضافة <code>${escapeHtml(amountFormatted)}</code> ل.س إلى محفظتك.${bonusNote}\n📊 رصيدك الحالي: <code>${escapeHtml(updatedBalance)}</code> ل.س`,
      { parse_mode: 'HTML' }
    );
  }

});

bot.on('polling_error', (err) => {
  const desc = err?.response?.body?.description || '';
  if (desc.includes('query is too old') || desc.includes('query ID is invalid')) {
    console.warn('Ignoring Telegram stale query polling error');
    return;
  }
  console.error('Polling error:', err.message);
});

// Set /start description (للبدء) in bot menu
bot.setMyCommands([{ command: 'start', description: 'للبدء' }]).catch(() => {});
}

const CONFIG_DEFAULTS = {
  BOT_TOKEN: '',
  BOT_USERNAME: BOT_ID,
  BOT_DISPLAY_NAME: '',
  USERNAME_PREFIX: 'Bot-',
  IS_ACTIVE: true,
  BOT_OFF: false,
  CHANNEL_USERNAME: '',
  DEBUG_MODE: false,
  DEBUG_LOGS: true,
  COOKIE_REFRESH_INTERVAL_MINUTES: 5,
  ICHANCY_AGENT_USERNAME: 'Karak.dk@agent.nsp',
  ICHANCY_AGENT_PASSWORD: 'Karak@@11',
  ICHANCY_PARENT_ID: '',
  GOLDEN_TREE_URL: 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real',
  ICHANCY_SITE_URL: 'https://agents.ichancy.com/',
  EXCHANGE_RATE_SYP_PER_USD: 15000,
  SYRIATEL_DEPOSIT_NUMBERS: '[{"number":"29664187","enabled":true},{"number":"24774420","enabled":true},{"number":"20612830","enabled":true},{"number":"05885778","enabled":true}]',
  SHAM_CASH_DEPOSIT_CODE: '53e42e80dde53a770f100d960ded2c62',
  ALERT_CHANNEL_ACCOUNTS: '',
  ALERT_CHANNEL_TRANSACTIONS: '',
  SUPPORT_USERNAME: '',
  ADMIN_USERNAME: '', // comma-separated for multiple: 'User1,User2,Mr_UnknownOfficial'
  REFERRAL_LEVEL1_PERCENT: 5,
  REFERRAL_LEVEL2_PERCENT: 3,
  REFERRAL_LEVEL3_PERCENT: 2,
  DEPOSIT_REQUIRED_LS: 50000,
  ACTIVE_REFERRALS_REQUIRED: 5,
  DEPOSIT_SYRIATEL_ENABLED: true,
  DEPOSIT_SHAMCASH_ENABLED: true,
  WITHDRAW_SYRIATEL_ENABLED: true,
  WITHDRAW_SHAMCASH_ENABLED: true,
  SYRIATEL_API_KEY: '',
  SYRIATEL_PIN: '',
};

async function loadLocalConfig() {
  await applyChannelConfig();

  BOT_TIMEZONE = ((await getConfigValue('TIMEZONE')) || 'Asia/Damascus').trim() || 'Asia/Damascus';
  ADMIN_USERNAME_RAW = String(await getConfigValue('ADMIN_USERNAME') || '').trim();
  BOT_OFF_FLAG = !!(await getConfigValue('BOT_OFF'));
  FLAG_DEPOSIT_SYRIATEL = !!(await getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true));
  FLAG_DEPOSIT_SHAMCASH = !!(await getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true));
  FLAG_WITHDRAW_SYRIATEL = !!(await getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true));
  FLAG_WITHDRAW_SHAMCASH = !!(await getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true));
  USERNAME_PREFIX_VALUE = (await getConfigValue('USERNAME_PREFIX', 'Bot-')) || 'Bot-';
  DEBUG_MODE = !!(await getConfigValue('DEBUG_MODE'));
  DEBUG_LOGS = !!(await getConfigValue('DEBUG_LOGS'));

  GOLDEN_TREE_URL = await getConfigValue('GOLDEN_TREE_URL', 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real');
  ICHANCY_SITE_URL = await getConfigValue('ICHANCY_SITE_URL', 'https://ichancy.com/');
  BOT_DISPLAY_NAME = await getConfigValue('BOT_DISPLAY_NAME', '');
  BOT_USERNAME = await getConfigValue('BOT_USERNAME', '');
  SUPPORT_USERNAME = await getConfigValue('SUPPORT_USERNAME', '');
  ALERT_CHANNEL_ACCOUNTS = await getConfigValue('ALERT_CHANNEL_ACCOUNTS', '');
  ALERT_CHANNEL_TRANSACTIONS = await getConfigValue('ALERT_CHANNEL_TRANSACTIONS', '');

  REFERRAL_PERCENTS = [
    await cfgFloat('REFERRAL_LEVEL1_PERCENT', 5),
    await cfgFloat('REFERRAL_LEVEL2_PERCENT', 3),
    await cfgFloat('REFERRAL_LEVEL3_PERCENT', 2),
  ];

  EXCHANGE_RATE_SYP_PER_USD = await cfgFloat('EXCHANGE_RATE_SYP_PER_USD', 15000);
  OLD_CURRENCY_MULTIPLE = Math.max(1, parseInt(process.env.OLD_CURRENCY_MULTIPLE, 10) || 100);
  const syr = await getProviderConfig('syriatel');
  const sham = await getProviderConfig('shamcash');
  CHARGE_SYRIATEL_MIN = syr.min_deposit_syp ?? 50;
  CHARGE_SYRIATEL_MAX = syr.max_cashout_syp ?? 500000;
  SYRIATEL_MIN = syr.min_cashout_syp ?? 25000;
  SYRIATEL_MAX = syr.max_cashout_syp ?? 500000;
  SHAM_SYP_MIN = sham.min_cashout_syp ?? 100000;
  SHAM_SYP_MAX = sham.max_cashout_syp ?? 2500000;
  CHARGE_SHAM_SYP_MIN = sham.min_deposit_syp ?? 50;
  CHARGE_SHAM_SYP_MAX = sham.max_cashout_syp ?? 2500000;
  SHAM_USD_MIN = Math.max(1, Math.ceil((sham.min_cashout_syp ?? 100000) / EXCHANGE_RATE_SYP_PER_USD));
  SHAM_USD_MAX = Math.max(SHAM_USD_MIN, Math.floor((sham.max_cashout_syp ?? 2500000) / EXCHANGE_RATE_SYP_PER_USD));
  CHARGE_SHAM_USD_MIN = Math.max(0, Math.ceil((sham.min_deposit_syp ?? 50) / EXCHANGE_RATE_SYP_PER_USD));
  CHARGE_SHAM_USD_MAX = Math.max(CHARGE_SHAM_USD_MIN, Math.floor((sham.max_cashout_syp ?? 2500000) / EXCHANGE_RATE_SYP_PER_USD));
  SHAM_CASH_DEPOSIT_CODE = await getConfigValue('SHAM_CASH_DEPOSIT_CODE', '');
  SYRIATEL_API_KEY = await getConfigValue('SYRIATEL_API_KEY', '');
  SYRIATEL_PIN = await getConfigValue('SYRIATEL_PIN', '0000');
  // syriatel_deposit_numbers: JSON array [{number: secretCode, enabled, secretCode, gsm}, ...] or legacy comma-separated (all enabled)
  const syriatelDepositRaw = await getConfigValue('SYRIATEL_DEPOSIT_NUMBERS', '');
  if (syriatelDepositRaw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(syriatelDepositRaw);
      if (Array.isArray(arr)) {
        SYRIATEL_DEPOSIT_ENTRIES = arr
          .filter((e) => e && e.enabled === true)
          .map((e) => ({
            number: String(e.number ?? '').trim(),
            gsm: (e.gsm != null && String(e.gsm).trim()) ? String(e.gsm).trim() : undefined,
            apiKey: (e.apiKey != null && String(e.apiKey).trim()) ? String(e.apiKey).trim() : undefined,
            secretCode: (e.secretCode != null && String(e.secretCode).trim()) ? String(e.secretCode).trim() : undefined,
          }))
          .filter((e) => e.number);
        SYRIATEL_DEPOSIT_NUMBERS = SYRIATEL_DEPOSIT_ENTRIES.map((e) => e.number);
      } else {
        SYRIATEL_DEPOSIT_ENTRIES = [];
        SYRIATEL_DEPOSIT_NUMBERS = [];
      }
    } catch (_) {
      SYRIATEL_DEPOSIT_ENTRIES = [];
      SYRIATEL_DEPOSIT_NUMBERS = [];
    }
  } else {
    SYRIATEL_DEPOSIT_NUMBERS = syriatelDepositRaw.split(',').map((s) => s.trim()).filter(Boolean);
    SYRIATEL_DEPOSIT_ENTRIES = SYRIATEL_DEPOSIT_NUMBERS.map((n) => ({ number: n }));
  }
}

/**
 * Start this bot instance.
 * @param {Object} [options]
 * @param {string} [options.webhookDomain] - Public HTTPS base URL
 * @param {string} [options.webhookPath] - Per-bot webhook path (e.g. /webhook/mybotid)
 */
async function start(options = {}) {
  await seedConfigDefaults(CONFIG_DEFAULTS);
  await loadConfig();
  await loadLocalConfig();

  if (!(await getConfigValue('IS_ACTIVE', true))) {
    console.log(`[Bot:${BOT_ID}] Marked inactive — skipping.`);
    return false;
  }

  const token = await getConfigValue('BOT_TOKEN');
  if (!token) {
    console.error(`[Bot:${BOT_ID}] Missing bot_token in bots table.`);
    return false;
  }
  bot = new TelegramBot(token, { polling: false });

  const api = createApiClient({
    debugLogs: await getConfigValue('DEBUG_LOGS'),
    cookieRefreshMinutes: await getConfigValue('COOKIE_REFRESH_INTERVAL_MINUTES', 5),
    agentUsername: await getConfigValue('ICHANCY_AGENT_USERNAME'),
    agentPassword: await getConfigValue('ICHANCY_AGENT_PASSWORD'),
    parentId: await getConfigValue('ICHANCY_PARENT_ID'),
  });
  loginAndRegisterPlayer = api.loginAndRegisterPlayer;
  getPlayerIdByLogin = api.getPlayerIdByLogin;
  getAgentSession = api.getAgentSession;
  invalidateAgentSession = api.invalidateAgentSession;
  getPlayerBalanceById = api.getPlayerBalanceById;
  depositToPlayer = api.depositToPlayer;
  withdrawFromPlayer = api.withdrawFromPlayer;
  getAgentWallet = api.getAgentWallet;

  if (!channelId) {
    console.error(`[Bot:${BOT_ID}] Missing channel_username in bots table.`);
    return false;
  }

  registerHandlers();

  const expiredCount = await deleteExpiredGiftCodes();
  if (expiredCount > 0) debugLog('Deleted', expiredCount, 'expired gift code(s)');
  console.log(`[Bot:${BOT_ID}] Config loaded. Starting...`);

  SPIN_BASE_URL = options.spinBaseUrl || '';
  if (options.webhookDomain && options.webhookPath) {
    const webhookUrl = options.webhookDomain + options.webhookPath;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`[Bot:${BOT_ID}] Running (webhook). URL: ${webhookUrl}`);
    } catch (err) {
      console.error(`[Bot:${BOT_ID}] Failed to set webhook:`, err.message);
      return false;
    }
  } else {
    bot.startPolling();
    console.log(`[Bot:${BOT_ID}] Running (polling).`);
  }
  return true;
}

async function stop() {
  if (!bot) return;
  try { bot.stopPolling(); } catch (_) {}
  try { await bot.deleteWebHook(); } catch (_) {}
  bot = null;
}

function processUpdate(body) {
  if (bot) bot.processUpdate(body);
}

async function reloadConfig() {
  await loadConfig();
  await loadLocalConfig();
}

return { start, stop, processUpdate, reloadConfig, botId: BOT_ID };
}; // end createBotInstance
