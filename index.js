process.env.NTBA_FIX_319 = '1'; // Fix for stale callback_query issues in node-telegram-bot-api
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { configureApi, loginAndRegisterPlayer, getPlayerIdByLogin, getAgentSession, invalidateAgentSession, getPlayerBalanceById, depositToPlayer, withdrawFromPlayer } = require('./lib/ichancy-api');
const { initDb, getUserByTelegramId, createOrUpdateUser, moveUserToDeletedUsers, redeemGiftCode, deleteExpiredGiftCodes, saveReferral, distributeReferralCommissions, getReferralStats, logTransaction, getTransactions, loadConfig, getConfigValue, seedConfigDefaults } = require('./lib/db');

const BOT_ID = process.env.BOT_USERNAME;
if (!BOT_ID) {
  console.error('Missing BOT_USERNAME in .env — this identifies which bot config to load from DB.');
  process.exit(1);
}

let DEBUG_MODE = false;
let DEBUG_LOGS = false;
function debugLog(...args) {
  if (DEBUG_LOGS) console.log('[Bot]', ...args);
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

function mainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'إنشاء حساب أيشانسي ➕', callback_data: 'create_account' }],
        [{ text: 'دليل المستخدم و شروط البوت 📄', callback_data: 'terms' }],
      ],
    },
  };
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

function subscribeKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: 'اضغط هنا للاشتراك 📣', url: channelLink }]],
    },
  };
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

/** Escape for Telegram HTML parse_mode so user content is safe and copyable in <code> */
function escapeHtml(s) {
  if (s == null || s === undefined) return '';
  const str = String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
let SHAM_USD_MIN = 10;
let SHAM_USD_MAX = 216;
let SHAM_SYP_MIN = 100000;
let SHAM_SYP_MAX = 2500000;
let SHAM_SYP_PER_USD = 15000;
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

// Charge (deposit) bot: choose deposit method
function chargeDepositKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Syriatel Cash', callback_data: 'charge_method_syriatel' }, { text: 'Sham Cash AUTO(USD , SYP)', callback_data: 'charge_method_sham' }],
        [{ text: '🔙 العودة', callback_data: 'charge_back' }],
      ],
    },
  };
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

// Withdraw from bot: choose method (bot wallet → real money platform)
function withdrawMethodKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 Sham Cash (USD , SYP)', callback_data: 'withdraw_method_sham' }],
        [{ text: '💵 Syriatel Cash', callback_data: 'withdraw_method_syriatel' }],
        [{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'withdraw_bot_back' }],
      ],
    },
  };
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

function isAdminUser(from) {
  const admin = (getConfigValue('ADMIN_USERNAME') || '').trim().replace(/^@/, '');
  const username = (from?.username || '').trim();
  return admin && username && admin.toLowerCase() === username.toLowerCase();
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
  delete userState[chatId];

  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return bot.sendMessage(chatId, '🔒 عليك الاشتراك في القناة الرسمية أولًا لاستخدام البوت!', subscribeKeyboard());
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
  const startKeyboard = DEBUG_MODE || !hasAccount ? mainMenuKeyboard() : loggedInMainKeyboard(isAdminUser(msg.from));
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
      const keyboard = hasAccount ? loggedInMainKeyboard(isAdminUser(query.from)) : mainMenuKeyboard();
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
      const keyboard = hasAccount ? loggedInMainKeyboard(isAdminUser(query.from)) : mainMenuKeyboard();
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
      await bot.editMessageText('⚙ لوحة الأدمن\n\nقيد التطوير.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu_back' }]],
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

    // Withdraw from bot: show balance + choose withdrawal method
    if (data === 'withdraw') {
      debugLog('callback_query: executing withdraw (from bot)');
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
      const minSypForUsd = SHAM_USD_MIN * SHAM_SYP_PER_USD;
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
    // Charge (deposit) bot: show deposit method selection
    if (data === 'charge') {
      debugLog('callback_query: executing charge');
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
      const rateFormatted = formatNumber(SHAM_SYP_PER_USD);
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
  if (!text || /^\/\w+/.test(text)) return; // ignore commands
  const state = userState[chatId];
  if (!state) return;
  debugLog('message: got text (state exists)', { chatId, step: state.step, textLength: text.length });

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
    const minSypForAmount = amount * SHAM_SYP_PER_USD;
    if (botBalance < minSypForAmount) {
      return bot.sendMessage(chatId, `❌ رصيدك غير كافٍ. المبلغ ${amount} USD يعادل حوالي ${formatNumber(Math.ceil(minSypForAmount))} ل.س. رصيدك: ${formatNumber(botBalance)} ل.س`);
    }
    const amountInSyp = amount * SHAM_SYP_PER_USD;
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

  // Charge (deposit) Syriatel: user sent amount → show transfer instructions
  if (state.step === 'await_charge_syriatel_amount') {
    debugLog('message: handling await_charge_syriatel_amount', { text });
    const amount = parseFloat(String(text).replace(/,/g, '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '❌ يرجى إدخال مبلغ صحيح (رقم فقط).');
    }
    if (amount < CHARGE_SYRIATEL_MIN || amount > CHARGE_SYRIATEL_MAX) {
      return bot.sendMessage(chatId, `❌ المبلغ يجب أن يكون بين ${formatNumber(CHARGE_SYRIATEL_MIN)} و ${formatNumber(CHARGE_SYRIATEL_MAX)} ل.س`);
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
    const chargeInSyp = chargeAmount * SHAM_SYP_PER_USD;
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
  CHANNEL_USERNAME: '@raphaeele',
  DEBUG_MODE: false,
  DEBUG_LOGS: true,
  COOKIE_REFRESH_INTERVAL_MINUTES: 5,
  ICHANCY_AGENT_USERNAME: 'Karak.dk@agent.nsp',
  ICHANCY_AGENT_PASSWORD: 'Karak@@11',
  ICHANCY_PARENT_ID: '2437654',
  GOLDEN_TREE_URL: 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real',
  ICHANCY_SITE_URL: 'https://agents.ichancy.com/',
  SHAM_USD_MIN: 10,
  SHAM_USD_MAX: 216,
  SHAM_SYP_MIN: 100000,
  SHAM_SYP_MAX: 2500000,
  SHAM_SYP_PER_USD: 15000,
  SYRIATEL_MIN: 1000,
  SYRIATEL_MAX: 500000,
  CHARGE_SYRIATEL_MIN: 50,
  CHARGE_SYRIATEL_MAX: 500000,
  SYRIATEL_DEPOSIT_NUMBERS: '29664187,24774420,20612830,05885778',
  CHARGE_SHAM_USD_MIN: 0,
  CHARGE_SHAM_USD_MAX: 216,
  CHARGE_SHAM_SYP_MIN: 0,
  CHARGE_SHAM_SYP_MAX: 3240000,
  SHAM_CASH_DEPOSIT_CODE: '53e42e80dde53a770f100d960ded2c62',
  ALERT_CHANNEL_ACCOUNTS: '-1003798405504',
  ALERT_CHANNEL_TRANSACTIONS: '-1003807881603',
  SUPPORT_USERNAME: 'Raphael_support3',
  ADMIN_USERNAME: 'Mr_UnknownOfficial',
  REFERRAL_LEVEL1_PERCENT: 5,
  REFERRAL_LEVEL2_PERCENT: 3,
  REFERRAL_LEVEL3_PERCENT: 2,
  DEPOSIT_REQUIRED_LS: 50000,
  ACTIVE_REFERRALS_REQUIRED: 5,
};

function loadLocalConfig() {
  const channel = getConfigValue('CHANNEL_USERNAME', '@raphaeele');
  channelId = channel.trim().startsWith('@') || channel.trim().startsWith('-')
    ? channel.trim()
    : `@${channel.trim()}`;
  channelLink = channel.trim().startsWith('https://')
    ? channel.trim()
    : `https://t.me/${channelId.replace(/^@/, '')}`;

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

  SHAM_USD_MIN = cfgInt('SHAM_USD_MIN', 10);
  SHAM_USD_MAX = cfgInt('SHAM_USD_MAX', 216);
  SHAM_SYP_MIN = cfgInt('SHAM_SYP_MIN', 100000);
  SHAM_SYP_MAX = cfgInt('SHAM_SYP_MAX', 2500000);
  SHAM_SYP_PER_USD = cfgFloat('SHAM_SYP_PER_USD', 15000);
  SYRIATEL_MIN = cfgInt('SYRIATEL_MIN', 1000);
  SYRIATEL_MAX = cfgInt('SYRIATEL_MAX', 500000);
  CHARGE_SYRIATEL_MIN = cfgInt('CHARGE_SYRIATEL_MIN', 50);
  CHARGE_SYRIATEL_MAX = cfgInt('CHARGE_SYRIATEL_MAX', 500000);
  CHARGE_SHAM_USD_MIN = cfgFloat('CHARGE_SHAM_USD_MIN', 0);
  CHARGE_SHAM_USD_MAX = cfgFloat('CHARGE_SHAM_USD_MAX', 216);
  CHARGE_SHAM_SYP_MIN = cfgInt('CHARGE_SHAM_SYP_MIN', 0);
  CHARGE_SHAM_SYP_MAX = cfgInt('CHARGE_SHAM_SYP_MAX', 3240000);
  SHAM_CASH_DEPOSIT_CODE = getConfigValue('SHAM_CASH_DEPOSIT_CODE', '');
  SYRIATEL_DEPOSIT_NUMBERS = (getConfigValue('SYRIATEL_DEPOSIT_NUMBERS', ''))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

(async () => {
  try {
    await initDb();
    await seedConfigDefaults(CONFIG_DEFAULTS);
    await loadConfig();
    loadLocalConfig();

    if (!getConfigValue('IS_ACTIVE', true)) {
      console.log('Bot is marked inactive in the bots table. Exiting.');
      process.exit(0);
    }

    const token = getConfigValue('BOT_TOKEN');
    if (!token) {
      console.error('Missing bot_token in bots table. Set it with:\n  UPDATE bots SET bot_token = \'your_token\' WHERE bot_id = \'' + BOT_ID + '\';');
      process.exit(1);
    }
    bot = new TelegramBot(token, { polling: false });

    configureApi({
      debugLogs: getConfigValue('DEBUG_LOGS'),
      cookieRefreshMinutes: getConfigValue('COOKIE_REFRESH_INTERVAL_MINUTES', 5),
      agentUsername: getConfigValue('ICHANCY_AGENT_USERNAME'),
      agentPassword: getConfigValue('ICHANCY_AGENT_PASSWORD'),
      parentId: getConfigValue('ICHANCY_PARENT_ID'),
    });

    if (!channelId) {
      console.error('Missing channel_username in bots table');
      process.exit(1);
    }

    registerHandlers();

    const expiredCount = await deleteExpiredGiftCodes();
    if (expiredCount > 0) debugLog('Deleted', expiredCount, 'expired gift code(s)');
    console.log('DB ready. Config loaded from bots table for:', BOT_ID);
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
  bot.startPolling();
  console.log('Ichancy bot is running (polling).');
})();
