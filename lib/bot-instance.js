process.env.NTBA_FIX_319 = '1';
const TelegramBot = require('node-telegram-bot-api');
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
  getUserByTelegramId, createOrUpdateUser, moveUserToDeletedUsers,
  redeemGiftCode, deleteExpiredGiftCodes, createGiftCode, listGiftCodes,
  getGiftCodeById, updateGiftCode, setGiftCodeActive, getRedemptionCount,
  deleteGiftCode, saveReferral, distributeReferralCommissions,
  getReferralStats, getPendingReferralStats, distributeReferralEarnings,
  getReferralEarningsForAdmin, getPendingReferralEarnings, getUsersDisplayMap,
  logTransaction, getTransactions, getUsersListForAdmin,
  getGiftRedemptionsCountForUser, getAdminStats, getTopUsersByNetDeposits,
  loadConfig, getConfigValue, setConfigValue, seedConfigDefaults,
  getProviderConfig, loadProviderConfigs, setProviderConfig,
} = db;

let loginAndRegisterPlayer, getPlayerIdByLogin, getAgentSession,
    invalidateAgentSession, getPlayerBalanceById, depositToPlayer, withdrawFromPlayer;

let DEBUG_MODE = false;
let DEBUG_LOGS = false;
function debugLog(...args) {
  if (DEBUG_LOGS) console.log(`[Bot:${BOT_ID}]`, ...args);
}

let bot;

let channelId = '';
let channelLink = '';

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

function formatReferralEarningLine(r) {
  let dateStr = '—';
  if (r.created_at) {
    try {
      dateStr = new Date(r.created_at).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      const d = new Date(r.created_at);
      dateStr = d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }
  const status = r.distributed_at ? '✅' : '⏳';
  return `${status} L${r.level} ${formatCurrencySyp(r.commission)} ل.س — ${dateStr}`;
}

/** Escape for Telegram HTML parse_mode so user content is safe and copyable in <code> */
function escapeHtml(s) {
  if (s == null || s === undefined) return '';
  const str = String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bot timezone (e.g. Asia/Damascus for Syrian time). */
function getBotTimezone() {
  const tz = (getConfigValue('TIMEZONE') || 'Asia/Damascus').trim();
  return tz || 'Asia/Damascus';
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
function profileMessage(user, siteBalance = null) {
  if (!user || !user.ichancy_login) {
    return '❌ لا يوجد حساب مرتبط. يرجى إنشاء حساب أولاً من القائمة الرئيسية.';
  }
  const depositRequired = formatNumber(cfgInt('DEPOSIT_REQUIRED_LS', 50000));
  const referralsRequired = cfgInt('ACTIVE_REFERRALS_REQUIRED', 5);

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

/** Config helper: read a number from bots table. */
function cfgInt(key, def) {
  const val = getConfigValue(key);
  const n = typeof val === 'number' ? val : parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}
/** Config helper: read a float from bots table. */
function cfgFloat(key, def) {
  const val = getConfigValue(key);
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
let SHAM_SYP_MIN = 100000;
let SHAM_SYP_MAX = 2500000;
let SHAM_USD_MIN = 10;
let SHAM_USD_MAX = 216;
let SYRIATEL_MIN = 1000;
let SYRIATEL_MAX = 500000;
let CHARGE_SYRIATEL_MIN = 50;
let CHARGE_SYRIATEL_MAX = 500000;
let CHARGE_SHAM_USD_MIN = 0;
let CHARGE_SHAM_USD_MAX = 216;
let CHARGE_SHAM_SYP_MIN = 0;
let CHARGE_SHAM_SYP_MAX = 3240000;
let SHAM_CASH_DEPOSIT_CODE = '';
let SYRIATEL_DEPOSIT_NUMBERS = [];

const LOADING_TEXT = '⏳ جاري التحميل...';
const MIN_WITHDRAWAL = 15000;

/** Send an alert to the accounts channel when a new account is created. */
function alertNewAccount(fromUser, displayUsername, referralInfo) {
  if (!ALERT_CHANNEL_ACCOUNTS) return;
  const tgUsername = fromUser.username ? `@${fromUser.username}` : '—';
  const name = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || '—';
  let msg = `🆕 حساب جديد\n\n👤 ${escapeHtml(name)} (${escapeHtml(tgUsername)})\n🆔 <code>${fromUser.id}</code>\n🎮 ${escapeHtml(displayUsername)}`;
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

// Charge (deposit) bot: choose deposit method (only enabled methods)
function chargeDepositKeyboard() {
  const syriatelEnabled = !!getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true);
  const shamcashEnabled = !!getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true);
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

// Withdraw from bot: choose method (only enabled methods)
function withdrawMethodKeyboard() {
  const syriatelEnabled = !!getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true);
  const shamcashEnabled = !!getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
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

// Admin list: comma/semicolon separated Telegram usernames (without @), e.g. Mr_UnknownOfficial,yummem
function isAdminUser(from) {
  const raw = String(getConfigValue('ADMIN_USERNAME') || '').trim();
  const admins = raw.split(/[,;\s]+/).map(s => s.trim().replace(/^@/, '')).filter(Boolean);
  const username = (from?.username || '').trim();
  const isAdmin = username && admins.length > 0 && admins.some(a => a.toLowerCase() === username.toLowerCase());
  if (DEBUG_LOGS && raw && username) {
    debugLog('isAdminUser', { username, admins, isAdmin });
  }
  return isAdmin;
}

const ADMIN_PANEL_TITLE = '⚙ لوحة الأدمن - التحكم الكامل\n\n👇🏻 اختر القسم الذي تريد التعامل معه';

// Message shown when payment (deposit/withdraw) is turned off by admin
const PAYMENT_DOWN_MESSAGE = `⏸ الدفع متوقف حالياً.\nيرجى المحاولة لاحقاً.\n\nPayment is currently down. Please try again later.`;

function adminPanelKeyboard() {
  const botOff = !!getConfigValue('BOT_OFF');
  const toggleBotButton = botOff
    ? { text: '🔴 البوت متوقف — اضغط للتشغيل', callback_data: 'admin_toggle_bot' }
    : { text: '🟢 تشغيل/إيقاف البوت', callback_data: 'admin_toggle_bot' };
  const chargeWithdrawOn =
    !!getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true) &&
    !!getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true) &&
    !!getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true) &&
    !!getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
  const toggleChargeWithdrawButton = chargeWithdrawOn
    ? { text: '🔄 إيقاف الشحن والسحب', callback_data: 'admin_toggle_charge_withdraw' }
    : { text: '🔄 تشغيل الشحن والسحب', callback_data: 'admin_toggle_charge_withdraw' };
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📈 الإحصائيات', callback_data: 'admin_stats' }, { text: '📢 رسالة جماعية', callback_data: 'admin_broadcast' }, { text: '🛠 حساب الدعم', callback_data: 'admin_support_account' }],
        [{ text: '🗂 طلبات السحب المعلقة', callback_data: 'admin_pending_withdrawals' }, { text: '💵 سحب شام كاش يدوي', callback_data: 'admin_manual_sham_withdraw' }],
        [{ text: '💱 تحديث سعر الصرف', callback_data: 'admin_exchange_rate' }, { text: '⚙️ إدارة النسب', callback_data: 'admin_manage_rates' }, { text: '👥 نسب الإحالات', callback_data: 'admin_referral_rates' }],
        [{ text: '🎁 العروض والبونصات', callback_data: 'admin_offers_bonuses' }, { text: '🎯 توزيع أرباح الإحالة يدوياً', callback_data: 'admin_manual_referral_distribute' }],
        [{ text: '📊 عرض صاحب أكبر صافي إيداعات', callback_data: 'admin_top_depositor' }],
        [{ text: '💳 إدارة أرقام سيرياتيل', callback_data: 'admin_syriatel_numbers' }],
        [{ text: '🔒 إدارة عمليات الإيداع والسحب', callback_data: 'admin_manage_deposit_withdraw' }],
        [{ text: '👥 إدارة المستخدمين', callback_data: 'admin_manage_users' }], // { text: '📄 كل العمليات', callback_data: 'admin_all_operations' } — temporarily commented
        [{ text: '💰 رصيد شام كاش', callback_data: 'admin_sham_balance' }],
        [toggleBotButton, toggleChargeWithdrawButton],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
      ],
    },
  };
}

/** Admin: Manage deposit/withdraw — message text */
function adminManageDepositWithdrawMessage() {
  const depositSyr = getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true);
  const depositSham = getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true);
  const withdrawSyr = getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true);
  const withdrawSham = getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
  return `🔒 إدارة عمليات الإيداع والسحب

اضغط على الزر لتفعيل/إيقاف الطريقة:
• إيداع سيرياتيل: ${depositSyr ? '✅ مفعّل' : '❌ معطّل'}
• إيداع شام كاش: ${depositSham ? '✅ مفعّل' : '❌ معطّل'}
• سحب سيرياتيل: ${withdrawSyr ? '✅ مفعّل' : '❌ معطّل'}
• سحب شام كاش: ${withdrawSham ? '✅ مفعّل' : '❌ معطّل'}`;
}

/** Admin: Manage deposit/withdraw — four toggle buttons (green tick = enabled, red = disabled) */
function adminManageDepositWithdrawKeyboard() {
  const depositSyr = !!getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true);
  const depositSham = !!getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true);
  const withdrawSyr = !!getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true);
  const withdrawSham = !!getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
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

/** Admin: إدارة المستخدمين — list message and keyboard (10 users per page, pagination + search) */
function adminManageUsersListMessage(result, searchQuery) {
  const { users, total, page, totalPages } = result;
  const title = '👥👥 قائمة المستخدمين';
  const sub = searchQuery
    ? `(نتائج البحث: "${searchQuery}" — صفحة ${page}/${totalPages})\nإجمالي النتائج: ${formatNumber(total)} مستخدم`
    : `(صفحة ${page}/${totalPages})\nإجمالي المستخدمين: ${formatNumber(total)}`;
  const lines = users.map((u) => `${u.displayName} (${u.referralCount}) الإحالات`);
  const body = lines.length ? lines.join('\n') : '— لا يوجد مستخدمون —';
  return `${title}\n\n${sub}\n\n${body}`;
}

function adminManageUsersListKeyboard(result, chatId) {
  const { users, page, totalPages } = result;
  const state = adminUserListState[chatId] || {};
  const searchQuery = state.searchQuery || null;
  const rows = [];
  users.forEach((u) => {
    const btnText = `${u.displayName} (${u.referralCount}) الإحالات`;
    rows.push([{ text: btnText, callback_data: `admin_user_detail_${u.telegram_user_id}` }]);
  });
  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push({ text: '◀ السابق', callback_data: `admin_manage_users_p_${page - 1}` });
    if (page < totalPages) nav.push({ text: 'التالي ▶', callback_data: `admin_manage_users_p_${page + 1}` });
    if (nav.length) rows.push(nav);
  }
  rows.push([{ text: '🔍 البحث عن مستخدم', callback_data: 'admin_manage_users_search' }]);
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
  const [referralStats, depositTx, withdrawTx, giftRedemptionsCount, siteBalance] = await Promise.all([
    getReferralStats(telegramUserId),
    getTransactions(telegramUserId, 'deposit', 1, 20),
    getTransactions(telegramUserId, 'withdrawal', 1, 20),
    getGiftRedemptionsCountForUser(telegramUserId),
    fetchSiteBalanceForUser(user),
  ]);
  const displayName = (user.ichancy_login && user.ichancy_login.trim()) || (user.telegram_username && user.telegram_username.trim()) || (user.first_name && user.first_name.trim()) || String(telegramUserId);
  const n = (v) => formatNumber(Number(v ?? 0));
  let text = `👤 تفاصيل المستخدم\n\n`;
  text += `🆔 معرف تليجرام: <code>${user.telegram_user_id}</code>\n`;
  text += `📛 الاسم في البوت: ${escapeHtml(displayName)}\n`;
  if (user.telegram_username) text += `📱 تليجرام: @${escapeHtml(user.telegram_username)}\n`;
  if (user.first_name) text += `الاسم: ${escapeHtml(user.first_name)}${user.last_name ? ' ' + escapeHtml(user.last_name) : ''}\n`;
  text += `\n💰 الأرصدة:\n`;
  text += `• رصيد البوت (محفظة): ${n(user.balance)} ل.س\n`;
  text += `• رصيد الموقع (Ichancy): ${typeof siteBalance === 'number' ? n(siteBalance) : '—'} ل.س\n`;
  text += `• رصيد الإحالات (غير منقول): ${n(user.referral_balance)} ل.س\n`;
  text += `• بونص الهدايا: ${n(user.gifts)} ل.س\n`;
  text += `\n📊 الإحالات: ${referralStats.referralCount} إحالة | أرباح إجمالية: ${n(referralStats.totalEarnings)} ل.س\n`;
  text += `\n📥 الإيداعات (آخر ${depositTx.rows.length}): إجمالي ${n(depositTx.rows.reduce((s, t) => s + Number(t.amount || 0), 0))} ل.س\n`;
  depositTx.rows.slice(0, 5).forEach((t) => {
    text += `  — ${n(t.amount)} ل.س | ${t.status} | ${t.method || ''}\n`;
  });
  text += `\n📤 السحوبات (آخر ${withdrawTx.rows.length}): إجمالي ${n(withdrawTx.rows.reduce((s, t) => s + Number(t.amount || 0), 0))} ل.س\n`;
  withdrawTx.rows.slice(0, 5).forEach((t) => {
    text += `  — ${n(t.amount)} ل.س | ${t.status} | ${t.method || ''}\n`;
  });
  text += `\n🎁 استرداد البونص/الهدايا: ${giftRedemptionsCount} مرة`;
  return {
    text,
    reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع إلى قائمة المستخدمين', callback_data: 'admin_manage_users_back' }]] },
  };
}

/**
 * Build the comprehensive admin statistics message (Arabic).
 * @param {Object} s - result of getAdminStats()
 */
function adminStatsMessage(s) {
  if (!s || typeof s !== 'object') return '❌ لا توجد بيانات إحصائيات.';
  const n = (v) => formatNumber(Number(v ?? 0));
  return `📈 إحصائيات البوت الشاملة

👥 المستخدمون:
• عدد المستخدمين: ${n(s.usersTotal)}
  — نشط (تفاعل خلال 30 يوم): ${n(s.usersActive)}
  — غير نشط (بدون تفاعل أكثر من 30 يوم): ${n(s.usersInactive)}
  — محذوفون: ${n(s.usersDeleted)}

💰 الأموال في المنصة:
• مجموع أرصدة المستخدمين: ${n(s.totalUserBalances)} ل.س

📥 الإيداعات:
• مجموع الإيداعات: ${n(s.totalDeposits)} ل.س
• اليوم (آخر 24 ساعة): ${n(s.todayDeposits)} إيداع
• الأسبوع (آخر 7 أيام): ${n(s.weekDeposits)} إيداع

📤 السحوبات:
• السحوبات المؤكدة: ${n(s.totalWithdrawals)} ل.س
• السحوبات المعلقة: ${n(s.pendingWithdrawalsSum)} ل.س
• اليوم: ${n(s.todayWithdrawals)} سحب
• الأسبوع: ${n(s.weekWithdrawals)} سحب

🎁 البونصات والأرباح:
• أرباح الإحالات: ${n(s.referralProfits)} ل.س
• أرباح العجلة (24 ساعة): ${n(s.wheelProfits)} ل.س
• أرباح الصناديق: ${n(s.boxProfits)} ل.س
• أرباح الأكواد / كوبونات الهدايا: ${n(s.codeProfits)} ل.س
• مجموع البونصات: ${n(s.totalBonuses)} ل.س

📅 ملخص اليوم/الأسبوع:
• اليوم: ${n(s.todayDeposits)} إيداع / ${n(s.todayWithdrawals)} سحب
• الأسبوع: ${n(s.weekDeposits)} إيداع / ${n(s.weekWithdrawals)} سحب`;
}

function adminStatsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📥 تصدير Excel', callback_data: 'admin_stats_export' }],
        [{ text: '🔄 تحديث', callback_data: 'admin_stats' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }],
      ],
    },
  };
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
function buildAdminStatsExcelBuffer(s) {
  if (!XLSX) throw new Error('xlsx not installed: run npm install xlsx');
  const n = (key) => Number(s?.[key] ?? 0);
  const rows = [
    ['تقرير إحصائيات البوت الشاملة', ''],
    ['تاريخ التصدير', new Date().toISOString()],
    [],
    ['المستخدمون', 'القيمة'],
    ['إجمالي المستخدمين', n('usersTotal')],
    ['نشط (تفاعل خلال 30 يوم)', n('usersActive')],
    ['غير نشط (أكثر من 30 يوم بدون تفاعل)', n('usersInactive')],
    ['محذوفون', n('usersDeleted')],
    [],
    ['الأموال في المنصة (ل.س)', ''],
    ['مجموع أرصدة المستخدمين', n('totalUserBalances')],
    [],
    ['الإيداعات (ل.س)', ''],
    ['مجموع الإيداعات', n('totalDeposits')],
    ['اليوم (آخر 24 ساعة)', n('todayDeposits')],
    ['الأسبوع (آخر 7 أيام)', n('weekDeposits')],
    [],
    ['السحوبات (ل.س)', ''],
    ['السحوبات المؤكدة', n('totalWithdrawals')],
    ['السحوبات المعلقة', n('pendingWithdrawalsSum')],
    ['سحب اليوم', n('todayWithdrawals')],
    ['سحب الأسبوع', n('weekWithdrawals')],
    [],
    ['البونصات والأرباح (ل.س)', ''],
    ['أرباح الإحالات', n('referralProfits')],
    ['أرباح العجلة', n('wheelProfits')],
    ['أرباح الصناديق', n('boxProfits')],
    ['أرباح الأكواد / كوبونات الهدايا', n('codeProfits')],
    ['مجموع البونصات', n('totalBonuses')],
    [],
    ['ملخص اليوم / الأسبوع', 'إيداع', 'سحب'],
    ['اليوم', n('todayDeposits'), n('todayWithdrawals')],
    ['الأسبوع', n('weekDeposits'), n('weekWithdrawals')],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colWidths = [{ wch: 42 }, { wch: 18 }, { wch: 14 }];
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الإحصائيات');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function adminSupportSettingsMessage() {
  const current = (getConfigValue('SUPPORT_USERNAME') || '').trim();
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

function adminBroadcastSettingsMessage() {
  const current = (getConfigValue('CHANNEL_USERNAME') || '').trim();
  const forCopy = current ? current.replace(/^@/, '') : '';
  return `📢 إعدادات قناة البث / القناة الرسمية

📌 اسم القناة الحالي:
${forCopy ? `<code>${escapeHtml(forCopy)}</code>\n\n💡 يمكنك النسخ من فوق.` : 'لم يُضبط بعد.'}`;
}

function adminBroadcastSettingsKeyboard() {
  const ch = (getConfigValue('CHANNEL_USERNAME') || '').trim();
  const forLink = ch ? ch.replace(/^@/, '') : '';
  const channelUrl = ch ? (ch.startsWith('https://') ? ch : `https://t.me/${forLink}`) : '';
  const rows = [
    [{ text: '✏️ تغيير اسم القناة', callback_data: 'admin_broadcast_change_channel' }],
    [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
  ];
  if (channelUrl) {
    rows.unshift([{ text: '📢 فتح القناة', url: channelUrl }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function adminExchangeRateSettingsMessage() {
  const current = getConfigValue('EXCHANGE_RATE_SYP_PER_USD', 15000);
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

function adminManageRatesMessage() {
  const rate = getConfigValue('EXCHANGE_RATE_SYP_PER_USD', 15000);
  const syr = getProviderConfig('syriatel');
  const sham = getProviderConfig('shamcash');
  return `⚙️ إدارة النسب والحدود (ل.س فقط)

💱 سعر الصرف: <code>${formatNumber(rate)}</code> ل.س / 1 USD

📱 سيرياتيل كاش:
• حد أدنى إيداع: <code>${formatNumber(syr.min_deposit_syp)}</code> ل.س
• حد أدنى سحب: <code>${formatNumber(syr.min_cashout_syp)}</code> ل.س
• حد أقصى سحب: <code>${formatNumber(syr.max_cashout_syp)}</code> ل.س
• نسبة ضريبة السحب: <code>${Number(syr.cashout_tax_percent ?? 0).toFixed(1)}</code>%
• نسبة بونص الإيداع: <code>${Number(syr.deposit_bonus_percent ?? 0).toFixed(1)}</code>%

💵 شام كاش:
• حد أدنى إيداع: <code>${formatNumber(sham.min_deposit_syp)}</code> ل.س
• حد أدنى سحب: <code>${formatNumber(sham.min_cashout_syp)}</code> ل.س
• حد أقصى سحب: <code>${formatNumber(sham.max_cashout_syp)}</code> ل.س
• نسبة ضريبة السحب: <code>${Number(sham.cashout_tax_percent ?? 0).toFixed(1)}</code>%
• نسبة بونص الإيداع: <code>${Number(sham.deposit_bonus_percent ?? 0).toFixed(1)}</code>%`;
}

function adminManageRatesKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💱 تعديل سعر الصرف', callback_data: 'admin_exchange_rate_change' }],
        [{ text: '📱 تعديل سيرياتيل كاش', callback_data: 'admin_rates_edit_syriatel' }, { text: '💵 تعديل شام كاش', callback_data: 'admin_rates_edit_shamcash' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

function adminReferralRatesMessage() {
  const l1 = getConfigValue('REFERRAL_LEVEL1_PERCENT', 5);
  const l2 = getConfigValue('REFERRAL_LEVEL2_PERCENT', 3);
  const l3 = getConfigValue('REFERRAL_LEVEL3_PERCENT', 2);
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
    stats = await getPendingReferralStats();
  } catch (err) {
    console.warn('getPendingReferralStats:', err.message);
    return `${REFERRAL_STATS_TITLE} 📊\n\n❌ خطأ في تحميل الإحصائيات.`;
  }
  const pendingCount = stats.pendingCount || 0;
  const pendingTotal = formatCurrencySyp(stats.pendingTotal || 0);
  const readyCount = stats.readyCount || 0;
  const readyTotal = formatCurrencySyp(stats.readyTotal || 0);
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

⏳ الأرباح المعلقة:
• العدد: ${pendingCount}
• المجموع: ${pendingTotal} ل.س

✅ الأرباح جاهزة للتوزيع (10+ يوم):
• العدد: ${readyCount}
• المجموع: ${readyTotal} ل.س

📅 آخر توزيع:
${lastDist}`;
}

function adminReferralPendingStatsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 توزيع الأرباح جاهزة (10+ يوم)', callback_data: 'admin_referral_distribute_ready' }],
        [{ text: '🎯 توزيع جميع الأرباح المعلقة', callback_data: 'admin_referral_distribute_all' }],
        [{ text: '📊 عرض تفاصيل الأرباح', callback_data: 'admin_referral_view_details' }],
        [{ text: '✏️ تعديل النسب', callback_data: 'admin_referral_rates_change' }],
        [{ text: '🔙 العودة للوحة الأدمن', callback_data: 'admin_panel' }],
      ],
    },
  };
}

// ——— توزيع أرباح الإحالة يدوياً: قائمة تفصيلية ———
const MANUAL_DISTRIBUTE_LIST_PAGE_SIZE = 10;

async function buildManualReferralListMessage(page = 1) {
  const { rows, total, totalPages } = await getPendingReferralEarnings(page, MANUAL_DISTRIBUTE_LIST_PAGE_SIZE);
  const allIds = [];
  for (const r of rows) {
    allIds.push(r.telegram_user_id, r.from_user_id);
  }
  const displayMap = await getUsersDisplayMap(allIds);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const lines = [];
  const startNum = (page - 1) * MANUAL_DISTRIBUTE_LIST_PAGE_SIZE;
  rows.forEach((r, i) => {
    const entryNum = startNum + i + 1;
    const idStr = `lvl${r.level}${r.id}`;
    const source = displayMap[String(r.telegram_user_id)] || String(r.telegram_user_id);
    const invitedBy = displayMap[String(r.from_user_id)] || String(r.from_user_id);
    const amount = formatCurrencySyp(r.commission);
    const created = r.created_at ? new Date(r.created_at).getTime() : now;
    const daysAgo = Math.max(0, Math.floor((now - created) / dayMs));
    const dateStr = formatDateManualList(r.created_at);
    lines.push(
      `(Entry ${entryNum})\n` +
      `رقم: ${idStr}\n` +
      `المحيل: ${source}\n` +
      `المدعو: ${invitedBy}\n` +
      `المبلغ: ${amount} ل.س\n` +
      `مضى: ${daysAgo} يوم\n` +
      `التاريخ: ${dateStr}`
    );
  });
  const body = lines.length ? lines.join('\n\n') : '— لا توجد أرباح معلقة —';
  const totalPending = await getPendingReferralStats().then((s) => s.pendingCount);
  const message = `🎯 توزيع أرباح الإحالة يدوياً\n\n${body}\n\n📊 إجمالي الأرباح المعلقة: ${totalPending}`;
  return { message, totalPages };
}

function adminManualReferralListKeyboard(page, totalPages) {
  const rows = [
    [{ text: '🔄 تحديث', callback_data: 'admin_manual_referral_list_refresh' }],
    [{ text: '💰 توزيع الأرباح', callback_data: 'admin_manual_referral_list_distribute' }],
    [{ text: '🔙 رجوع', callback_data: 'admin_panel' }],
  ];
  if (totalPages > 1) {
    const prevPage = page > 1 ? page - 1 : 1;
    const nextPage = page < totalPages ? page + 1 : totalPages;
    rows.unshift([
      { text: '◀ السابق', callback_data: `admin_manual_referral_list_${prevPage}` },
      { text: 'التالي ▶', callback_data: `admin_manual_referral_list_${nextPage}` },
    ]);
  }
  return { reply_markup: { inline_keyboard: rows } };
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

function applyChannelConfig() {
  const channel = getConfigValue('CHANNEL_USERNAME', '@raphaeele');
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
  if (getConfigValue('BOT_OFF') && !isAdminUser(msg.from)) {
    return bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
  }
  delete userState[chatId];

  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return bot.sendMessage(chatId, '🔒 عليك الاشتراك في القناة الرسمية أولًا لاستخدام البوت!', subscribeKeyboard(isAdminUser(msg.from)));
  }

  try {
    await createOrUpdateUser(userId, {
      telegram_username: msg.from.username || null,
      first_name: msg.from.first_name || null,
      last_name: msg.from.last_name || null,
    });
  } catch (err) {
    console.warn('DB createOrUpdateUser on /start:', err.message);
  }

  // Handle referral deep link: /start ref_<referrerId>
  const payload = match && match[1] ? match[1].trim() : '';
  if (payload.startsWith('ref_')) {
    const referrerId = payload.slice(4);
    if (referrerId && referrerId !== String(userId)) {
      try {
        const saved = await saveReferral(userId, referrerId);
        if (saved) debugLog('/start: referral saved', { userId, referrerId });
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

    if (getConfigValue('BOT_OFF') && !isAdminUser(query.from)) {
      await bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
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
        const current = !!getConfigValue('BOT_OFF');
        await setConfigValue('BOT_OFF', !current);
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
          !!getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true) &&
          !!getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true) &&
          !!getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true) &&
          !!getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
        const newState = !allOn;
        await setConfigValue('DEPOSIT_SYRIATEL_ENABLED', newState);
        await setConfigValue('DEPOSIT_SHAMCASH_ENABLED', newState);
        await setConfigValue('WITHDRAW_SYRIATEL_ENABLED', newState);
        await setConfigValue('WITHDRAW_SHAMCASH_ENABLED', newState);
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
      await bot.editMessageText(adminSupportSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminSupportSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_support_change_username') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      userState[chatId] = { step: 'await_admin_support_username' };
      await bot.editMessageText('✏️ أرسل اسم المستخدم الجديد للدعم (الذي يراه المستخدمون في زر مراسلة الدعم).', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'admin_support_cancel' }]],
        },
      });
      return;
    }

    if (data === 'admin_support_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(adminSupportSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminSupportSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_broadcast') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(adminBroadcastSettingsMessage(), {
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
      await bot.editMessageText(adminBroadcastSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminBroadcastSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_exchange_rate') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(adminExchangeRateSettingsMessage(), {
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
      await bot.editMessageText(adminExchangeRateSettingsMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminExchangeRateSettingsKeyboard(),
      });
      return;
    }

    if (data === 'admin_manage_rates') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.editMessageText(adminManageRatesMessage(), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
      return;
    }

    if (data === 'admin_rates_edit_syriatel' || data === 'admin_rates_edit_shamcash') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const provider = data === 'admin_rates_edit_syriatel' ? 'syriatel' : 'shamcash';
      const label = provider === 'syriatel' ? 'سيرياتيل كاش' : 'شام كاش';
      userState[chatId] = { step: 'await_admin_rates_edit', provider, messageId };
      await bot.editMessageText(
        `✏️ تعديل حدود ونسب <b>${label}</b>\n\nأرسل 5 أرقام مفصولة بفواصل بالترتيب:\n<code>حد أدنى إيداع ل.س, حد أدنى سحب ل.س, حد أقصى سحب ل.س, نسبة ضريبة السحب %, نسبة بونص الإيداع %</code>\n\nمثال: <code>50,25000,500000,10,10</code>`,
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

    if (data === 'admin_rates_edit_cancel') {
      if (!isAdminUser(query.from)) return;
      delete userState[chatId];
      await bot.editMessageText(adminManageRatesMessage(), {
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
      try {
        const page = 1;
        const { message, totalPages } = await buildManualReferralListMessage(page);
        try {
          await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            ...adminManualReferralListKeyboard(page, totalPages),
          });
        } catch (editErr) {
          const msg = editErr?.message || editErr?.response?.body?.description || '';
          if (!msg.includes('message is not modified')) throw editErr;
        }
      } catch (err) {
        console.warn('buildManualReferralListMessage:', err.message);
        await bot.sendMessage(chatId, '❌ حدث خطأ في تحميل قائمة الأرباح المعلقة. يرجى المحاولة لاحقاً.');
      }
      return;
    }

    if (data === 'admin_manual_referral_list_refresh') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: 'تم التحديث' });
      try {
        const page = 1;
        const { message, totalPages } = await buildManualReferralListMessage(page);
        try {
          await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            ...adminManualReferralListKeyboard(page, totalPages),
          });
        } catch (editErr) {
          const msg = editErr?.message || editErr?.response?.body?.description || '';
          if (!msg.includes('message is not modified')) throw editErr;
        }
      } catch (err) {
        console.warn('buildManualReferralListMessage (refresh):', err.message);
        await bot.sendMessage(chatId, '❌ حدث خطأ في التحديث. يرجى المحاولة لاحقاً.');
      }
      return;
    }

    if (data === 'admin_manual_referral_list_distribute') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      try {
        const result = await distributeReferralEarnings(false);
        await bot.answerCallbackQuery(query.id);
        const count = result.distributedCount || 0;
        const userCount = result.distributedUserCount || 0;
        const total = result.distributedTotal || 0;
        const feedbackMsg = count > 0
          ? `✅ تم توزيع الأرباح بنجاح.\n\n📊 عدد السجلات: ${count}\n👥 تم التحويل إلى محفظة البوت لـ ${userCount} مستخدم\n💰 المجموع: ${formatCurrencySyp(total)} ل.س`
          : `ℹ️ لا توجد أرباح معلقة لتوزيعها (0 سجل).`;
        await bot.sendMessage(chatId, feedbackMsg);
        try {
          const page = 1;
          const { message, totalPages } = await buildManualReferralListMessage(page);
          try {
            await bot.editMessageText(message, {
              chat_id: chatId,
              message_id: messageId,
              ...adminManualReferralListKeyboard(page, totalPages),
            });
          } catch (editErr) {
            const msg = editErr?.message || editErr?.response?.body?.description || '';
            if (!msg.includes('message is not modified')) console.warn('editMessageText after manual distribute:', editErr.message);
          }
        } catch (listErr) {
          console.warn('buildManualReferralListMessage after distribute:', listErr.message);
        }
      } catch (err) {
        console.warn('distributeReferralEarnings (manual list):', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'حدث خطأ أثناء التوزيع.' });
        await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التوزيع.');
      }
      return;
    }

    if (data.startsWith('admin_manual_referral_list_')) {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      await bot.answerCallbackQuery(query.id);
      let page = parseInt(data.replace('admin_manual_referral_list_', ''), 10) || 1;
      page = Math.max(1, page);
      try {
        let { message, totalPages } = await buildManualReferralListMessage(page);
        if (totalPages > 0 && page > totalPages) {
          const res = await buildManualReferralListMessage(totalPages);
          message = res.message;
          page = totalPages;
        }
        try {
          await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            ...adminManualReferralListKeyboard(page, totalPages),
          });
        } catch (editErr) {
          const msg = editErr?.message || editErr?.response?.body?.description || '';
          if (!msg.includes('message is not modified')) throw editErr;
        }
      } catch (err) {
        console.warn('buildManualReferralListMessage (pagination):', err.message);
        await bot.sendMessage(chatId, '❌ حدث خطأ في تحميل الصفحة. يرجى المحاولة لاحقاً.');
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
        adminReferralRatesMessage() +
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

    if (data === 'admin_referral_distribute_ready' || data === 'admin_referral_distribute_all') {
      if (!isAdminUser(query.from)) {
        await bot.answerCallbackQuery(query.id, { text: 'غير مصرح' });
        return;
      }
      const readyOnly = data === 'admin_referral_distribute_ready';
      const actionLabel = readyOnly ? 'توزيع الأرباح جاهزة (10+ يوم)' : 'توزيع جميع الأرباح المعلقة';
      try {
        const result = await distributeReferralEarnings(readyOnly);
        await bot.answerCallbackQuery(query.id);

        const count = result.distributedCount || 0;
        const userCount = result.distributedUserCount || 0;
        const total = result.distributedTotal || 0;

        let feedbackMsg;
        if (count > 0) {
          feedbackMsg = `✅ تم التوزيع بنجاح (${actionLabel})\n\n` +
            `📊 عدد السجلات: ${count}\n` +
            `👥 تم تحويل الأرباح إلى محفظة البوت لـ ${userCount} مستخدم\n` +
            `💰 المجموع: ${formatCurrencySyp(total)} ل.س\n\n` +
            `تم خصم المبالغ من رصيد الإحالة (محفظة الإحالة) وإضافتها إلى محفظة البوت لكل مستخدم.`;
        } else {
          feedbackMsg = `ℹ️ ${actionLabel}\n\n` +
            `لا توجد أرباح لتوزيعها حسب المعايير المختارة.\n` +
            `• تم التوزيع إلى 0 مستخدم\n` +
            `• المجموع: 0.00 ل.س\n\n` +
            `تظهر الأرباح هنا بعد أن يقوم المستخدمون بالإحالة ويقوم المُحالون بعمليات دفع (وتمر 10+ يوم للتوزيع الجاهز).`;
        }
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
          if (!msg.includes('message is not modified')) {
            console.warn('editMessageText after distribute:', editErr.message);
          }
        }
      } catch (err) {
        console.warn('distributeReferralEarnings:', err.message);
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
      const { rows, total, totalPages } = await getReferralEarningsForAdmin(page, 15);
      const lines = rows.map((r) => formatReferralEarningLine(r));
      const displayPage = totalPages ? Math.min(page, totalPages) : 1;
      const detailMsg = `📊 تفاصيل الأرباح (صفحة ${displayPage}/${totalPages}، ${total} سجل)\n\n${lines.length ? lines.join('\n') : '— لا توجد سجلات —'}`;
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
        await bot.editMessageText(detailMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
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
      let { rows, total, totalPages } = await getReferralEarningsForAdmin(page, 15);
      if (rows.length === 0 && total > 0 && totalPages > 0 && page > totalPages) {
        const res = await getReferralEarningsForAdmin(totalPages, 15);
        rows = res.rows;
        page = totalPages;
      }
      const displayPage = totalPages ? Math.min(page, totalPages) : 1;
      const lines = rows.map((r) => formatReferralEarningLine(r));
      const detailMsg = `📊 تفاصيل الأرباح (صفحة ${displayPage}/${totalPages}، ${total} سجل)\n\n${lines.length ? lines.join('\n') : '— لا توجد سجلات —'}`;
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
        await bot.editMessageText(detailMsg, { chat_id: chatId, message_id: messageId, ...keyboard });
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
      const tzHint = getBotTimezone();
      await bot.editMessageText(
        `➕ إضافة كود هدية\n\nأرسل <b>الكود</b> (حروف وأرقام فقط، بدون مسافات):\n\n⏰ التوقيت: ${tzHint}`,
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
      const rows = codes.slice(0, 20).map((c) => [
        { text: `${c.is_active ? '🟢' : '⚪'} ${c.code}`, callback_data: `gift_edit_${c.id}` },
      ]);
      rows.push([{ text: '🔙 إلغاء', callback_data: 'gift_back' }]);
      await bot.editMessageText(GIFT_OFFERS_TITLE + '\n\n✏️ اختر الكود لتعديله:', {
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
      userState[chatId] = { step: 'await_gift_edit', giftCodeId: id, messageId };
      const expiryStr = row.expiry_date ? formatInBotTz(row.expiry_date) : 'بدون انتهاء';
      await bot.editMessageText(
        `✏️ تعديل كود: <code>${escapeHtml(row.code)}</code>\n\nأرسل سطراً واحداً بالشكل:\n<code>المبلغ ل.س, الحد الأقصى للاستخدام (أو 0 = غير محدود), تاريخ انتهاء (YYYY-MM-DD أو -), وقت انتهاء (HH:mm أو -)</code>\n\nمثال: <code>5000,100,2026-12-31,23:59</code>\nمثال بدون انتهاء: <code>5000,0,-,-</code>\n\nالحالي: ${formatNumber(row.amount)} ل.س، حد: ${row.max_redemptions == null ? '∞' : row.max_redemptions}، انتهاء: ${expiryStr}`,
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
      const now = new Date();
      const active = codes.filter((c) => (!c.expiry_date || new Date(c.expiry_date) > now) && (c.max_redemptions == null || c.redemption_count < c.max_redemptions));
      let text = GIFT_OFFERS_TITLE + '\n\n📢 <b>نشر الأكواد</b>\nاضغط على الكود النشط لإيقافه (تحويله إلى غير نشط).\n\n';
      if (!active.length) {
        text += '❌ لا توجد أكواد نشطة حالياً.';
      }
      const rows = active.slice(0, 25).map((c) => {
        const remain = c.max_redemptions != null ? Math.max(0, c.max_redemptions - c.redemption_count) : null;
        const expiry = c.expiry_date ? new Date(c.expiry_date) : null;
        let label = c.code;
        if (remain !== null && expiry) label += ` | ${remain} متبقي | حتى ${formatInBotTz(expiry)}`;
        else if (remain !== null) label += ` | ${remain} متبقي`;
        else if (expiry) label += ` | حتى ${formatInBotTz(expiry)}`;
        return [{ text: '🟢 ' + label, callback_data: `gift_deactivate_${c.id}` }];
      });
      rows.push([{ text: '🔙 العودة', callback_data: 'gift_back' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (data.startsWith('gift_deactivate_')) {
      if (!isAdminUser(query.from)) return;
      const id = parseInt(data.replace('gift_deactivate_', ''), 10);
      if (!Number.isFinite(id)) return;
      try {
        await setGiftCodeActive(id, false);
        await bot.answerCallbackQuery(query.id, { text: 'تم إيقاف الكود' });
      } catch (e) {
        await bot.answerCallbackQuery(query.id, { text: 'خطأ' });
      }
      const codes = await listGiftCodes({ activeOnly: true });
      const now = new Date();
      const active = codes.filter((c) => (!c.expiry_date || new Date(c.expiry_date) > now) && (c.max_redemptions == null || c.redemption_count < c.max_redemptions));
      let text = GIFT_OFFERS_TITLE + '\n\n📢 نشر الأكواد\nاضغط على الكود النشط لإيقافه.\n\n';
      if (!active.length) text += '❌ لا توجد أكواد نشطة حالياً.';
      const rows = active.slice(0, 25).map((c) => {
        const remain = c.max_redemptions != null ? Math.max(0, c.max_redemptions - c.redemption_count) : null;
        const expiry = c.expiry_date ? new Date(c.expiry_date) : null;
        let label = c.code;
        if (remain !== null && expiry) label += ` | ${remain} متبقي | حتى ${formatInBotTz(expiry)}`;
        else if (remain !== null) label += ` | ${remain} متبقي`;
        else if (expiry) label += ` | حتى ${formatInBotTz(expiry)}`;
        return [{ text: '🟢 ' + label, callback_data: `gift_deactivate_${c.id}` }];
      });
      rows.push([{ text: '🔙 العودة', callback_data: 'gift_back' }]);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
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
        stats = await getAdminStats();
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
      const text = adminStatsMessage(stats);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        ...adminStatsKeyboard(),
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
      try {
        stats = await getAdminStats();
      } catch (err) {
        console.warn('getAdminStats:', err.message);
        await bot.sendMessage(chatId, '❌ فشل إنشاء التقرير.').catch(() => {});
        return;
      }
      try {
        const buffer = buildAdminStatsExcelBuffer(stats);
        const filename = `admin-stats-${new Date().toISOString().slice(0, 10)}.xlsx`;
        await bot.sendDocument(chatId, buffer, {
          caption: '📥 تقرير الإحصائيات الشاملة',
          filename,
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
        const current = !!getConfigValue(configKey, true);
        await setConfigValue(configKey, !current);
      }
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
      await bot.editMessageText('🔍 البحث عن مستخدم\n\nأدخل نص البحث (اسم مستخدم أو جزء منه — مطابقة جزئية):', {
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
    if (data.startsWith('admin_') && data !== 'admin_panel' && data !== 'admin_stats' && data !== 'admin_stats_export' && data !== 'admin_toggle_charge_withdraw' && !data.startsWith('admin_top_depositor') && !data.startsWith('admin_payment_toggle_') && !data.startsWith('admin_manage_users') && !data.startsWith('admin_user_detail_') && isAdminUser(query.from)) {
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
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const siteBalance = await fetchSiteBalanceForUser(user);
      const text = profileMessage(user, siteBalance);
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

    // Withdraw from Ichancy: show site balance, ask amount (min 15,000 ل.س)
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
      const minFormatted = formatNumber(MIN_WITHDRAWAL);
      debugLog('callback_query: withdraw_ichancy — asking user for amount', { siteBalance });
      userState[chatId] = { step: 'await_withdraw_amount', siteBalance, messageId };
      const msg = `💸 سحب رصيد من حساب Ichancy إلى البوت\n\nرصيدك في الموقع: <code>${siteBalanceFormatted}</code> ل.س\n❌ الحد الأدنى للسحب هو ${minFormatted} ل.س.\n\n✏️ اكتب المبلغ الذي تريد سحبه (رقم فقط)، أو اضغط إلغاء للرجوع.`;
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

    // Withdraw from bot: show balance + choose withdrawal method or "payment down" if all withdraw methods off
    if (data === 'withdraw') {
      debugLog('callback_query: executing withdraw (from bot)');
      const withdrawSyr = !!getConfigValue('WITHDRAW_SYRIATEL_ENABLED', true);
      const withdrawSham = !!getConfigValue('WITHDRAW_SHAMCASH_ENABLED', true);
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
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const minSypForUsd = SHAM_USD_MIN * EXCHANGE_RATE_SYP_PER_USD;
      if (botBalance < minSypForUsd) {
        const minFormatted = formatNumber(Math.ceil(minSypForUsd));
        await bot.editMessageText(`❌ رصيدك غير كافٍ لسحب شام كاش بالدولار.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\nالحد الأدنى المطلوب: <code>${minFormatted}</code> ل.س (يعادل ${SHAM_USD_MIN} USD)`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...withdrawShamCurrencyKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_sham_usd_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>دولار</b>.\n\nالحد الأدنى للسحب: <b>${SHAM_USD_MIN}</b> USD.\nالحد الأقصى للسحب: <b>${SHAM_USD_MAX}</b> USD.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\n\nالرجاء إدخال رمز العميل (Client Code):`;
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

    // Sham Cash SYP: show min/max, ask for client code (check balance >= SHAM_SYP_MIN)
    if (data === 'withdraw_sham_syp') {
      debugLog('callback_query: executing withdraw_sham_syp');
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const sypMinFormatted = formatNumber(SHAM_SYP_MIN);
      const sypMaxFormatted = formatNumber(SHAM_SYP_MAX);
      if (botBalance < SHAM_SYP_MIN) {
        await bot.editMessageText(`❌ رصيدك غير كافٍ لسحب شام كاش بالليرة السورية.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\nالحد الأدنى المطلوب: <code>${sypMinFormatted}</code> ل.س`, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...withdrawShamCurrencyKeyboard(),
        });
        return;
      }
      userState[chatId] = { step: 'await_sham_syp_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>ليرة سورية</b>.\n\nالحد الأدنى للسحب: <b>${sypMinFormatted}</b> SYP.\nالحد الأقصى للسحب: <b>${sypMaxFormatted}</b> SYP.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\n\nالرجاء إدخال رمز العميل (Client Code):`;
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
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      userState[chatId] = { step: 'await_sham_usd_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>دولار</b>.\n\nالحد الأدنى للسحب: <b>${SHAM_USD_MIN}</b> USD.\nالحد الأقصى للسحب: <b>${SHAM_USD_MAX}</b> USD.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\n\nالرجاء إدخال رمز العميل (Client Code):`;
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
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const botBalance = user ? Number(user.balance ?? 0) : 0;
      const botBalanceFormatted = formatNumber(botBalance);
      const sypMinFormatted = formatNumber(SHAM_SYP_MIN);
      const sypMaxFormatted = formatNumber(SHAM_SYP_MAX);
      userState[chatId] = { step: 'await_sham_syp_client_code', messageId };
      const msg = `🔢 أنت الآن تسحب شام كاش بـ <b>ليرة سورية</b>.\n\nالحد الأدنى للسحب: <b>${sypMinFormatted}</b> SYP.\nالحد الأقصى للسحب: <b>${sypMaxFormatted}</b> SYP.\n\nرصيدك في البوت: <code>${botBalanceFormatted}</code> ل.س\n\nالرجاء إدخال رمز العميل (Client Code):`;
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
      const msg = `🔑 الرجاء إدخال رقم الهاتف الخاص بالعميل.\nمثال: 0912345678`;
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
      const depositSyr = !!getConfigValue('DEPOSIT_SYRIATEL_ENABLED', true);
      const depositSham = !!getConfigValue('DEPOSIT_SHAMCASH_ENABLED', true);
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
      const minFormatted = formatNumber(CHARGE_SYRIATEL_MIN);
      const maxFormatted = formatNumber(CHARGE_SYRIATEL_MAX);
      userState[chatId] = { step: 'await_charge_syriatel_amount', messageId };
      const msg = `💰 لقد اخترت <strong>سيرياتيل كاش</strong> كطريقة للإيداع.\n\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} ل.س</code>\n🔸 <strong>الحد الأقصى للإيداع:</strong> <code>${maxFormatted} ل.س</code>\n\n📩 الرجاء الآن إدخال المبلغ الذي تريد إيداعه:`;
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

    // Charge Sham Cash USD: show exchange rate, min, ask for amount
    if (data === 'charge_sham_usd') {
      debugLog('callback_query: executing charge_sham_usd');
      const rateFormatted = formatNumber(EXCHANGE_RATE_SYP_PER_USD);
      const minFormatted = CHARGE_SHAM_USD_MIN % 1 === 0 ? String(CHARGE_SHAM_USD_MIN) : CHARGE_SHAM_USD_MIN.toFixed(1);
      const maxFormatted = CHARGE_SHAM_USD_MAX % 1 === 0 ? String(CHARGE_SHAM_USD_MAX) : CHARGE_SHAM_USD_MAX.toFixed(1);
      userState[chatId] = { step: 'await_charge_sham_usd_amount', messageId };
      const msg = `💰 اخترت الإيداع عبر <strong>شام كاش بالدولار الأمريكي (USD)</strong>.\n\n💵 <strong>سعر الصرف الحالي:</strong> <code>${rateFormatted} ل.س / 1 USD</code>\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} USD</code>\n🔸 <strong>الحد الأقصى للإيداع:</strong> <code>${maxFormatted} USD</code>\n\n📩 الرجاء إدخال المبلغ الذي تريد إيداعه بالدولار.`;
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

    // Charge Sham Cash SYP: show min/max, ask for amount
    if (data === 'charge_sham_syp') {
      debugLog('callback_query: executing charge_sham_syp');
      const minFormatted = formatNumber(CHARGE_SHAM_SYP_MIN);
      const maxFormatted = formatNumber(CHARGE_SHAM_SYP_MAX);
      userState[chatId] = { step: 'await_charge_sham_syp_amount', messageId };
      const msg = `💰 اخترت الإيداع عبر <strong>شام كاش بالليرة السورية</strong>.\n\n🔸 <strong>الحد الأدنى للإيداع:</strong> <code>${minFormatted} ل.س</code>\n🔸 <strong>الحد الأقصى للإيداع:</strong> <code>${maxFormatted} ل.س</code>\n\n📩 الرجاء إدخال المبلغ الذي تريد إيداعه بالليرة السورية.`;
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

    // الإحالات — show referral link, stats, earnings
    if (data === 'referrals') {
      debugLog('callback_query: executing referrals');
      await bot.editMessageText(LOADING_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للقائمة', callback_data: 'referrals_back' }]] },
      });
      const uid = query.from.id;
      let stats = { totalEarnings: 0, referralBalance: 0, referralCount: 0 };
      try {
        stats = await getReferralStats(uid);
      } catch (err) {
        console.warn('getReferralStats:', err.message);
      }
      const refLink = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=ref_${uid}` : '—';
      const totalFormatted = formatNumber(stats.totalEarnings);
      const balanceFormatted = formatNumber(stats.referralBalance);
      const withdrawnFormatted = formatNumber(Math.max(0, stats.totalEarnings - stats.referralBalance));
      const countText = stats.referralCount > 0
        ? `👥 عدد الإحالات: ${stats.referralCount}`
        : '📭 لا توجد إحالات بعد.';
      const msg = `👥 نظام الإحالات\n\n🔗 رابطك: <code>${escapeHtml(refLink)}</code>\n\n📊 الإجمالي: ${totalFormatted} ل.س\n▫️ القابلة للسحب: ${balanceFormatted} ل.س\n▫️ المسحوبة: ${withdrawnFormatted} ل.س\n\n${countText}`;
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

    if (['jackpot', 'box_game', 'redeem_withdrawal'].includes(data)) {
      await bot.answerCallbackQuery(query.id, { text: 'قيد التطوير' }).catch(() => {});
      return;
    }
  } catch (e) {
    console.error('callback_query handler error:', e);
  }
});

// Create-account flow: handle OTP → username → password (text only, no commands)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();
  if (!text || /^\/\w+/.test(text)) return; // ignore commands (onText handles them; avoids duplicate pause message)
  if (getConfigValue('BOT_OFF') && !isAdminUser(msg.from)) {
    return bot.sendMessage(chatId, '⏸ البوت متوقف مؤقتاً.');
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
      SUPPORT_USERNAME = getConfigValue('SUPPORT_USERNAME', '');
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث اسم مستخدم الدعم.\n\n' + adminSupportSettingsMessage(), { parse_mode: 'HTML', ...adminSupportSettingsKeyboard() });
    } catch (err) {
      console.warn('setConfigValue SUPPORT_USERNAME:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
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
      applyChannelConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث اسم القناة.\n\n' + adminBroadcastSettingsMessage(), { parse_mode: 'HTML', ...adminBroadcastSettingsKeyboard() });
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
    adminUserListState[chatId] = { searchQuery: searchQuery || null, page: 1 };
    try {
      const result = await getUsersListForAdmin({ page: 1, pageSize: 10, searchQuery: searchQuery || undefined });
      await bot.editMessageText(adminManageUsersListMessage(result, searchQuery || null), {
        chat_id: chatId,
        message_id: state.messageId,
        ...adminManageUsersListKeyboard(result, chatId),
      });
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
      loadLocalConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث سعر الصرف.\n\n' + adminExchangeRateSettingsMessage(), {
        parse_mode: 'HTML',
        ...adminExchangeRateSettingsKeyboard(),
      });
    } catch (err) {
      console.warn('setConfigValue EXCHANGE_RATE_SYP_PER_USD:', err.message);
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
      return bot.sendMessage(chatId, '❌ أرسل ثلاث قيم مفصولة بفواصل (مستوى 1، مستوى 2، مستوى 3) مثل: 5,2,1');
    }
    const nums = parts.map((s) => parseFloat(s));
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
      return bot.sendMessage(chatId, '❌ كل قيمة يجب أن تكون رقماً بين 0 و 100.');
    }
    try {
      await setConfigValue('REFERRAL_LEVEL1_PERCENT', nums[0]);
      await setConfigValue('REFERRAL_LEVEL2_PERCENT', nums[1]);
      await setConfigValue('REFERRAL_LEVEL3_PERCENT', nums[2]);
      delete userState[chatId];
      const statsMsg = await adminReferralPendingStatsMessage();
      try {
        await bot.editMessageText('✅ تم تحديث نسب الإحالات.\n\n' + statsMsg, {
          chat_id: chatId,
          message_id: state.messageId,
          ...adminReferralPendingStatsKeyboard(),
        });
      } catch (editErr) {
        const msg = editErr?.message || editErr?.response?.body?.description || '';
        if (!msg.includes('message is not modified')) console.warn('editMessageText after referral rates save:', editErr.message);
      }
    } catch (err) {
      console.warn('setConfigValue referral levels:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  if (state.step === 'await_admin_rates_edit') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const provider = state.provider;
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 5) {
      return bot.sendMessage(chatId, '❌ أرسل 5 أرقام مفصولة بفواصل: حد أدنى إيداع، حد أدنى سحب، حد أقصى سحب، نسبة ضريبة السحب، نسبة بونص الإيداع');
    }
    const nums = parts.map((s) => parseFloat(s));
    const [minDeposit, minCashout, maxCashout, taxPercent, bonusPercent] = nums;
    if (!Number.isFinite(minDeposit) || minDeposit < 0 || !Number.isFinite(minCashout) || minCashout < 0 ||
        !Number.isFinite(maxCashout) || maxCashout < minCashout || !Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100 ||
        !Number.isFinite(bonusPercent) || bonusPercent < 0 || bonusPercent > 100) {
      return bot.sendMessage(chatId, '❌ قيم غير صالحة. تأكد: الحدود أرقام موجبة، أقصى سحب ≥ أدنى سحب، النسب بين 0 و 100.');
    }
    try {
      await setProviderConfig(provider, {
        min_deposit_syp: Math.round(minDeposit),
        min_cashout_syp: Math.round(minCashout),
        max_cashout_syp: Math.round(maxCashout),
        cashout_tax_percent: taxPercent,
        deposit_bonus_percent: bonusPercent,
      });
      loadLocalConfig();
      delete userState[chatId];
      await bot.sendMessage(chatId, '✅ تم تحديث الحدود والنسب.\n\n' + adminManageRatesMessage(), {
        parse_mode: 'HTML',
        ...adminManageRatesKeyboard(),
      });
    } catch (err) {
      console.warn('setProviderConfig:', err.message);
      await bot.sendMessage(chatId, '❌ حدث خطأ أثناء التحديث.');
    }
    return;
  }

  // ——— إضافة كود هدية: الخطوة 1 — الكود
  if (state.step === 'await_gift_add_code') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const code = (text || '').trim().toUpperCase().replace(/\s/g, '');
    if (!code || !/^[A-Z0-9]+$/i.test(code)) {
      return bot.sendMessage(chatId, '❌ أرسل كوداً صالحاً (حروف وأرقام فقط، بدون مسافات).');
    }
    userState[chatId] = { step: 'await_gift_add_details', giftCode: code, messageId: state.messageId };
    return bot.sendMessage(
      chatId,
      `✅ الكود: <code>${escapeHtml(code)}</code>\n\nأرسل سطراً واحداً بالشكل:\n<code>المبلغ ل.س, الحد الأقصى للاستخدام (0 = غير محدود), تاريخ الانتهاء (YYYY-MM-DD أو -), وقت الانتهاء (HH:mm أو -)</code>\n\nمثال: <code>5000,100,2026-12-31,23:59</code>\nبدون انتهاء: <code>5000,0,-,-</code>\n\n⏰ التوقيت: ${getBotTimezone()}`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'gift_cancel' }]] },
      }
    );
  }

  // ——— إضافة كود هدية: الخطوة 2 — المبلغ والحد والانتهاء
  if (state.step === 'await_gift_add_details') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const parts = text.split(',').map((s) => s.trim());
    if (parts.length < 4) {
      return bot.sendMessage(chatId, '❌ أرسل 4 قيم مفصولة بفواصل: المبلغ، الحد الأقصى (0=غير محدود)، التاريخ (YYYY-MM-DD أو -)، الوقت (HH:mm أو -)');
    }
    const amount = parseInt(parts[0], 10);
    const maxR = parts[1] === '-' || parts[1] === '0' ? null : parseInt(parts[1], 10);
    const dateStr = parts[2] === '-' ? '' : parts[2];
    const timeStr = parts[3] === '-' ? '23:59' : parts[3];
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ المبلغ يجب أن يكون رقماً موجباً.');
    }
    let expiryDate = null;
    if (dateStr) {
      expiryDate = parseSyrianDateTime(dateStr, timeStr);
      if (!expiryDate) {
        return bot.sendMessage(chatId, '❌ تاريخ أو وقت غير صالح. استخدم YYYY-MM-DD و HH:mm (توقيت دمشق).');
      }
    }
    delete userState[chatId];
    try {
      const { row } = await createGiftCode({
        code: state.giftCode,
        amount,
        maxRedemptions: maxR,
        expiryDate: expiryDate || undefined,
      });
      const expiryStr = row.expiry_date ? formatInBotTz(row.expiry_date) : 'بدون انتهاء';
      await bot.sendMessage(
        chatId,
        `✅ تم إنشاء كود الهدية.\n\n📌 الكود: <code>${escapeHtml(row.code)}</code>\n💰 المبلغ: ${formatNumber(row.amount)} ل.س\n📊 الحد الأقصى: ${row.max_redemptions == null ? 'غير محدود' : row.max_redemptions}\n⏰ انتهاء: ${expiryStr}`,
        { parse_mode: 'HTML', ...adminGiftOffersKeyboard() }
      );
    } catch (err) {
      console.warn('createGiftCode:', err.message);
      await bot.sendMessage(chatId, '❌ ' + (err.message || 'حدث خطأ. ربما الكود مستخدم مسبقاً.'), { ...adminGiftOffersKeyboard() });
    }
    return;
  }

  // ——— تعديل كود هدية
  if (state.step === 'await_gift_edit') {
    if (!isAdminUser(msg.from)) {
      delete userState[chatId];
      return;
    }
    const parts = text.split(',').map((s) => s.trim());
    if (parts.length < 4) {
      return bot.sendMessage(chatId, '❌ أرسل 4 قيم مفصولة بفواصل: المبلغ، الحد الأقصى (0=غير محدود)، التاريخ (YYYY-MM-DD أو -)، الوقت (HH:mm أو -)');
    }
    const amount = parseInt(parts[0], 10);
    const maxR = parts[1] === '-' || parts[1] === '0' ? null : parseInt(parts[1], 10);
    const dateStr = parts[2] === '-' ? '' : parts[2];
    const timeStr = parts[3] === '-' ? '23:59' : parts[3];
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ المبلغ يجب أن يكون رقماً موجباً.');
    }
    let expiryDate = null;
    if (dateStr) {
      expiryDate = parseSyrianDateTime(dateStr, timeStr);
      if (!expiryDate) {
        return bot.sendMessage(chatId, '❌ تاريخ أو وقت غير صالح. استخدم YYYY-MM-DD و HH:mm (توقيت دمشق).');
      }
    }
    const id = state.giftCodeId;
    delete userState[chatId];
    try {
      await updateGiftCode(id, { amount, maxRedemptions: maxR, expiryDate });
      await bot.sendMessage(chatId, '✅ تم تحديث الكود.', { parse_mode: 'HTML', ...adminGiftOffersKeyboard() });
    } catch (err) {
      console.warn('updateGiftCode:', err.message);
      await bot.sendMessage(chatId, '❌ ' + (err.message || 'حدث خطأ.'), { ...adminGiftOffersKeyboard() });
    }
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
    const displayUsername = username + '-Bot';

    try {
      const parentId = getConfigValue('ICHANCY_PARENT_ID');
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

      const agentUsername = getConfigValue('ICHANCY_AGENT_USERNAME');
      const agentPassword = getConfigValue('ICHANCY_AGENT_PASSWORD');
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
            alertNewAccount(msg.from, displayUsername, refInfo);
          } catch (err) {
            console.warn('alertNewAccount referral lookup:', err.message);
            alertNewAccount(msg.from, displayUsername, '');
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
    let cookies;
    try {
      cookies = await getAgentSession();
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
    debugLog('message: transfer — depositToPlayer result', { success: result.success });
    if (result.success) {
      const newBalance = botBalance - amount;
      debugLog('message: transfer — updating bot balance', { newBalance });
      try {
        await createOrUpdateUser(msg.from.id, { balance: newBalance });
      } catch (dbErr) {
        console.warn('DB createOrUpdateUser after transfer:', dbErr.message);
        return bot.sendMessage(chatId, '❌ تم التحويل على الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
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
    if (amount < MIN_WITHDRAWAL) {
      return bot.sendMessage(chatId, `❌ الحد الأدنى للسحب هو ${formatNumber(MIN_WITHDRAWAL)} ل.س.`);
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
    let cookies;
    try {
      cookies = await getAgentSession();
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
    debugLog('message: withdraw — withdrawFromPlayer result', { success: result.success });
    if (result.success) {
      const botBalance = Number(user.balance ?? 0);
      const newBalance = botBalance + amount;
      debugLog('message: withdraw — updating bot balance', { newBalance });
      try {
        await createOrUpdateUser(msg.from.id, { balance: newBalance });
      } catch (dbErr) {
        console.warn('DB createOrUpdateUser after withdraw:', dbErr.message);
        return bot.sendMessage(chatId, '❌ تم السحب من الموقع لكن حدث خطأ في تحديث رصيد البوت. تواصل مع الدعم.');
      }
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
    userState[chatId] = { step: 'await_sham_usd_amount', clientCode: text, messageId: state.messageId };
    const msg = `✅ تم استلام الرمز، الآن أدخل المبلغ المراد سحبه (بالأرقام فقط):\n\nالحد الأدنى: <b>${SHAM_USD_MIN}</b> USD\nالحد الأقصى: <b>${SHAM_USD_MAX}</b> USD`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawShamUsdAmountKeyboard(),
    });
  }

  // Sham Cash USD: user sent amount
  if (state.step === 'await_sham_usd_amount') {
    debugLog('message: handling await_sham_usd_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < SHAM_USD_MIN || amount > SHAM_USD_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${SHAM_USD_MIN} و ${SHAM_USD_MAX} USD.`);
    }
    let user = null;
    try {
      user = await getUserByTelegramId(msg.from.id);
    } catch (err) {
      console.warn('DB getUserByTelegramId:', err.message);
    }
    const botBalance = user ? Number(user.balance ?? 0) : 0;
    const minSypForAmount = amount * EXCHANGE_RATE_SYP_PER_USD;
    if (botBalance < minSypForAmount) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. المبلغ ${amount} USD يعادل حوالي ${formatNumber(Math.ceil(minSypForAmount))} ل.س. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    const amountInSyp = amount * EXCHANGE_RATE_SYP_PER_USD;
    logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount: amountInSyp, method: 'sham_usd' }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'withdrawal', amountInSyp, 'sham_usd');
    delete userState[chatId];
    return bot.sendMessage(chatId, 'تم استلام الطلب. قيد التطوير.');
  }

  // Sham Cash SYP: user sent client code → ask for amount
  if (state.step === 'await_sham_syp_client_code') {
    debugLog('message: handling await_sham_syp_client_code', { text });
    const sypMinFormatted = formatNumber(SHAM_SYP_MIN);
    const sypMaxFormatted = formatNumber(SHAM_SYP_MAX);
    userState[chatId] = { step: 'await_sham_syp_amount', clientCode: text, messageId: state.messageId };
    const msg = `✅ تم استلام الرمز، الآن أدخل المبلغ المراد سحبه (بالأرقام فقط):\n\nالحد الأدنى: <b>${sypMinFormatted}</b> ل.س\nالحد الأقصى: <b>${sypMaxFormatted}</b> ل.س`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawShamSypAmountKeyboard(),
    });
  }

  // Sham Cash SYP: user sent amount
  if (state.step === 'await_sham_syp_amount') {
    debugLog('message: handling await_sham_syp_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < SHAM_SYP_MIN || amount > SHAM_SYP_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(SHAM_SYP_MIN)} و ${formatNumber(SHAM_SYP_MAX)} ل.س`);
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
    logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount, method: 'sham_syp' }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'withdrawal', amount, 'sham_syp');
    delete userState[chatId];
    return bot.sendMessage(chatId, 'تم استلام الطلب. قيد التطوير.');
  }

  // Syriatel Cash: user sent phone number → ask for amount
  if (state.step === 'await_syriatel_phone') {
    debugLog('message: handling await_syriatel_phone', { text });
    const phone = text.trim();
    if (!phone) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال رقم الهاتف.');
    }
    userState[chatId] = { step: 'await_syriatel_amount', phone, messageId: state.messageId };
    const syriatelMinFormatted = formatNumber(SYRIATEL_MIN);
    const syriatelMaxFormatted = formatNumber(SYRIATEL_MAX);
    const msg = `💰 الآن أرسل المبلغ الذي تريد سحبه (بالأرقام فقط):\n\nالحد الأدنى: <b>${syriatelMinFormatted}</b> ل.س\nالحد الأقصى: <b>${syriatelMaxFormatted}</b> ل.س`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...withdrawSyriatelCancelKeyboard(),
    });
  }

  // Syriatel Cash: user sent amount
  if (state.step === 'await_syriatel_amount') {
    debugLog('message: handling await_syriatel_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < SYRIATEL_MIN || amount > SYRIATEL_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(SYRIATEL_MIN)} و ${formatNumber(SYRIATEL_MAX)} ل.س`);
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
    logTransaction({ telegramUserId: msg.from.id, type: 'withdrawal', amount, method: 'syriatel' }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'withdrawal', amount, 'syriatel');
    delete userState[chatId];
    return bot.sendMessage(chatId, 'تم استلام الطلب. قيد التطوير.');
  }

  // Charge (deposit) Syriatel: user sent amount → show transfer instructions (enabled numbers only)
  if (state.step === 'await_charge_syriatel_amount') {
    debugLog('message: handling await_charge_syriatel_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < CHARGE_SYRIATEL_MIN || amount > CHARGE_SYRIATEL_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(CHARGE_SYRIATEL_MIN)} و ${formatNumber(CHARGE_SYRIATEL_MAX)} ل.س`);
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

  // Charge Syriatel: user sent transfer operation number
  if (state.step === 'await_charge_syriatel_transfer_id') {
    debugLog('message: handling await_charge_syriatel_transfer_id', { text });
    const chargeAmount = state.chargeAmount;
    delete userState[chatId];
    logTransaction({ telegramUserId: msg.from.id, type: 'deposit', amount: chargeAmount, method: 'syriatel', transferId: text }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'deposit', chargeAmount, 'syriatel', text);
    if (chargeAmount > 0) {
      distributeReferralCommissions(msg.from.id, chargeAmount, REFERRAL_PERCENTS).catch((err) =>
        console.warn('distributeReferralCommissions:', err.message)
      );
    }
    return bot.sendMessage(chatId, 'تم استلام رقم العملية. قيد التطوير.');
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

  // Charge (deposit) Sham USD: user sent amount → show transfer instructions
  if (state.step === 'await_charge_sham_usd_amount') {
    debugLog('message: handling await_charge_sham_usd_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < CHARGE_SHAM_USD_MIN || amount > CHARGE_SHAM_USD_MAX) {
      const minStr = CHARGE_SHAM_USD_MIN % 1 === 0 ? String(CHARGE_SHAM_USD_MIN) : CHARGE_SHAM_USD_MIN.toFixed(1);
      const maxStr = CHARGE_SHAM_USD_MAX % 1 === 0 ? String(CHARGE_SHAM_USD_MAX) : CHARGE_SHAM_USD_MAX.toFixed(1);
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${minStr} و ${maxStr} USD`);
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

  // Charge Sham USD: user sent transfer operation number
  if (state.step === 'await_charge_sham_usd_transfer_id') {
    debugLog('message: handling await_charge_sham_usd_transfer_id', { text });
    const chargeAmount = state.chargeAmount;
    delete userState[chatId];
    const chargeInSyp = chargeAmount * EXCHANGE_RATE_SYP_PER_USD;
    logTransaction({ telegramUserId: msg.from.id, type: 'deposit', amount: chargeInSyp, method: 'sham_usd', transferId: text }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'deposit', chargeInSyp, 'sham_usd', text);
    if (chargeAmount > 0) {
      distributeReferralCommissions(msg.from.id, chargeInSyp, REFERRAL_PERCENTS).catch((err) =>
        console.warn('distributeReferralCommissions:', err.message)
      );
    }
    return bot.sendMessage(chatId, 'تم استلام رقم العملية. قيد التطوير.');
  }

  // Charge (deposit) Sham SYP: user sent amount → show transfer instructions
  if (state.step === 'await_charge_sham_syp_amount') {
    debugLog('message: handling await_charge_sham_syp_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < CHARGE_SHAM_SYP_MIN || amount > CHARGE_SHAM_SYP_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(CHARGE_SHAM_SYP_MIN)} و ${formatNumber(CHARGE_SHAM_SYP_MAX)} ل.س`);
    }
    const amountDisplay = amount % 1 === 0 ? String(amount) : amount.toFixed(1);
    const shamCode = SHAM_CASH_DEPOSIT_CODE.trim() || '—';
    userState[chatId] = { step: 'await_charge_sham_syp_transfer_id', chargeAmount: amount };
    const msg = `✅ لإتمام إيداع مبلغ <code>${escapeHtml(amountDisplay)}</code> ل.س:\n\n1. قم بالتحويل عبر <strong>شام كاش</strong> إلى:\n<code>${escapeHtml(shamCode)}</code>\n\n2. بعد التحويل أرسل <strong>رقم عملية التحويل</strong> هنا.`;
    return bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      ...chargeShamSypTransferCancelKeyboard(),
    });
  }

  // Charge Sham SYP: user sent transfer operation number
  if (state.step === 'await_charge_sham_syp_transfer_id') {
    debugLog('message: handling await_charge_sham_syp_transfer_id', { text });
    const chargeAmount = state.chargeAmount;
    delete userState[chatId];
    logTransaction({ telegramUserId: msg.from.id, type: 'deposit', amount: chargeAmount, method: 'sham_syp', transferId: text }).catch((e) => console.warn('logTransaction:', e.message));
    alertTransaction(msg.from, 'deposit', chargeAmount, 'sham_syp', text);
    if (chargeAmount > 0) {
      distributeReferralCommissions(msg.from.id, chargeAmount, REFERRAL_PERCENTS).catch((err) =>
        console.warn('distributeReferralCommissions:', err.message)
      );
    }
    return bot.sendMessage(chatId, 'تم استلام رقم العملية. قيد التطوير.');
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
  BOT_DISPLAY_NAME: 'Raphael Bot',
  IS_ACTIVE: true,
  BOT_OFF: false,
  CHANNEL_USERNAME: '@raphaeele',
  DEBUG_MODE: false,
  DEBUG_LOGS: true,
  COOKIE_REFRESH_INTERVAL_MINUTES: 5,
  ICHANCY_AGENT_USERNAME: 'Karak.dk@agent.nsp',
  ICHANCY_AGENT_PASSWORD: 'Karak@@11',
  ICHANCY_PARENT_ID: '2437654',
  GOLDEN_TREE_URL: 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real',
  ICHANCY_SITE_URL: 'https://agents.ichancy.com/',
  EXCHANGE_RATE_SYP_PER_USD: 15000,
  SYRIATEL_DEPOSIT_NUMBERS: '[{"number":"29664187","enabled":true},{"number":"24774420","enabled":true},{"number":"20612830","enabled":true},{"number":"05885778","enabled":true}]',
  SHAM_CASH_DEPOSIT_CODE: '53e42e80dde53a770f100d960ded2c62',
  ALERT_CHANNEL_ACCOUNTS: '-1003798405504',
  ALERT_CHANNEL_TRANSACTIONS: '-1003807881603',
  SUPPORT_USERNAME: 'Raphael_support3',
  ADMIN_USERNAME: 'Mr_UnknownOfficial', // comma-separated for multiple: 'User1,User2,Mr_UnknownOfficial'
  REFERRAL_LEVEL1_PERCENT: 5,
  REFERRAL_LEVEL2_PERCENT: 3,
  REFERRAL_LEVEL3_PERCENT: 2,
  DEPOSIT_REQUIRED_LS: 50000,
  ACTIVE_REFERRALS_REQUIRED: 5,
  DEPOSIT_SYRIATEL_ENABLED: true,
  DEPOSIT_SHAMCASH_ENABLED: true,
  WITHDRAW_SYRIATEL_ENABLED: true,
  WITHDRAW_SHAMCASH_ENABLED: true,
};

function loadLocalConfig() {
  applyChannelConfig();

  DEBUG_MODE = !!getConfigValue('DEBUG_MODE');
  DEBUG_LOGS = !!getConfigValue('DEBUG_LOGS');

  GOLDEN_TREE_URL = getConfigValue('GOLDEN_TREE_URL', 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real');
  ICHANCY_SITE_URL = getConfigValue('ICHANCY_SITE_URL', 'https://ichancy.com/');
  BOT_DISPLAY_NAME = getConfigValue('BOT_DISPLAY_NAME', 'Raphael Bot');
  BOT_USERNAME = getConfigValue('BOT_USERNAME', '');
  SUPPORT_USERNAME = getConfigValue('SUPPORT_USERNAME', '');
  ALERT_CHANNEL_ACCOUNTS = getConfigValue('ALERT_CHANNEL_ACCOUNTS', '');
  ALERT_CHANNEL_TRANSACTIONS = getConfigValue('ALERT_CHANNEL_TRANSACTIONS', '');

  REFERRAL_PERCENTS = [
    cfgFloat('REFERRAL_LEVEL1_PERCENT', 5),
    cfgFloat('REFERRAL_LEVEL2_PERCENT', 3),
    cfgFloat('REFERRAL_LEVEL3_PERCENT', 2),
  ];

  EXCHANGE_RATE_SYP_PER_USD = cfgFloat('EXCHANGE_RATE_SYP_PER_USD', 15000);
  const syr = getProviderConfig('syriatel');
  const sham = getProviderConfig('shamcash');
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
  SHAM_CASH_DEPOSIT_CODE = getConfigValue('SHAM_CASH_DEPOSIT_CODE', '');
  // syriatel_deposit_numbers: JSON array [{number, enabled}, ...] or legacy comma-separated (all enabled)
  const syriatelDepositRaw = getConfigValue('SYRIATEL_DEPOSIT_NUMBERS', '');
  if (syriatelDepositRaw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(syriatelDepositRaw);
      SYRIATEL_DEPOSIT_NUMBERS = Array.isArray(arr)
        ? arr.filter((e) => e && e.enabled === true).map((e) => String(e.number ?? '').trim()).filter(Boolean)
        : [];
    } catch (_) {
      SYRIATEL_DEPOSIT_NUMBERS = syriatelDepositRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else {
    SYRIATEL_DEPOSIT_NUMBERS = syriatelDepositRaw.split(',').map((s) => s.trim()).filter(Boolean);
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
  loadLocalConfig();

  if (!getConfigValue('IS_ACTIVE', true)) {
    console.log(`[Bot:${BOT_ID}] Marked inactive — skipping.`);
    return false;
  }

  const token = getConfigValue('BOT_TOKEN');
  if (!token) {
    console.error(`[Bot:${BOT_ID}] Missing bot_token in bots table.`);
    return false;
  }
  bot = new TelegramBot(token, { polling: false });

  const api = createApiClient({
    debugLogs: getConfigValue('DEBUG_LOGS'),
    cookieRefreshMinutes: getConfigValue('COOKIE_REFRESH_INTERVAL_MINUTES', 5),
    agentUsername: getConfigValue('ICHANCY_AGENT_USERNAME'),
    agentPassword: getConfigValue('ICHANCY_AGENT_PASSWORD'),
    parentId: getConfigValue('ICHANCY_PARENT_ID'),
  });
  loginAndRegisterPlayer = api.loginAndRegisterPlayer;
  getPlayerIdByLogin = api.getPlayerIdByLogin;
  getAgentSession = api.getAgentSession;
  invalidateAgentSession = api.invalidateAgentSession;
  getPlayerBalanceById = api.getPlayerBalanceById;
  depositToPlayer = api.depositToPlayer;
  withdrawFromPlayer = api.withdrawFromPlayer;

  if (!channelId) {
    console.error(`[Bot:${BOT_ID}] Missing channel_username in bots table.`);
    return false;
  }

  registerHandlers();

  const expiredCount = await deleteExpiredGiftCodes();
  if (expiredCount > 0) debugLog('Deleted', expiredCount, 'expired gift code(s)');
  console.log(`[Bot:${BOT_ID}] Config loaded. Starting...`);

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

return { start, stop, processUpdate, botId: BOT_ID };
}; // end createBotInstance
