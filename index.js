process.env.NTBA_FIX_319 = '1'; // Fix for stale callback_query issues in node-telegram-bot-api
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { probeBypassServers, loginToSingleServer, loginWithFreshBypass, registerPlayer, pingBypassCookiesAgentsIchancy, pingBypassCookiesAgentsIchancyOncePerServer } = require('./lib/ichancy-api');
const { initDb, getUserByTelegramId, createOrUpdateUser, moveUserToDeletedUsers } = require('./lib/db');

const token = process.env.BOT_TOKEN;
const channel = process.env.CHANNEL_USERNAME; // e.g. @ichancy_official
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === '1';

if (!token) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}
if (!channel) {
  console.error('Missing CHANNEL_USERNAME in .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

// Cron: ping each bypass URL once for agents.ichancy.com every N minutes (fire-and-forget)
const bypassPingIntervalMin = parseInt(process.env.BYPASS_PING_INTERVAL_MIN, 10);
if (bypassPingIntervalMin > 0) {
  const intervalMs = bypassPingIntervalMin * 60 * 1000;
  setInterval(() => pingBypassCookiesAgentsIchancyOncePerServer(), intervalMs);
  // First run after 30s so bot is up, then every N minutes
  setTimeout(() => pingBypassCookiesAgentsIchancyOncePerServer(), 30 * 1000);
}

// Normalize channel id: @username or -100... for getChatMember
const channelId = channel.trim().startsWith('@') || channel.trim().startsWith('-')
  ? channel.trim()
  : `@${channel.trim()}`;

// Channel link for "subscribe" button (strip @ for URL; private channels use invite link in env)
const channelLink = channel.trim().startsWith('https://')
  ? channel.trim()
  : `https://t.me/${channelId.replace(/^@/, '')}`;

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
  `🔐 للتحقق من أنك مستخدم حقيقي، يرجى إدخال الكود التالي:\n\n📝 كود التحقق: ${code}\n⏳ صالح لمدة دقيقتين.`;

const MSG_OTP_EXPIRED = `❌ انتهت صلاحية الكود، اضغط /start للحصول على كود جديد`;

const MSG_ASK_USERNAME = `✅ تم التحقق بنجاح! الآن أدخل اسم المستخدم الذي ترغب به:\n\n🔐 **بدء إنشاء حسابك الآن**\n\nيرجى إدخال اسم مستخدم جديد لحسابك.\n\n📌 **شروط اسم المستخدم:**\n1️⃣ يجب أن يحتوي على 5 أحرف أو أرقام على الأقل.\n2️⃣ يمكن أن يحتوي على حروف إنجليزية وأرقام فقط.\n3️⃣ ❌ لا يحتوي على رموز خاصة مثل: #، @، %، $ …\n4️⃣ ❌ لا يحتوي على حروف أو أرقام عربية.\n\n📝 **ملاحظة مهمة:** هذه الخطوة ضرورية لإكمال إنشاء حسابك بنجاح.\n➡️ الرجاء الآن كتابة اسم المستخدم بالشكل الصحيح للمتابعة.`;

const MSG_USERNAME_INVALID = `❌ اسم المستخدم غير صالح.\n\n📌 شروط اسم المستخدم:\n1️⃣ 5 أحرف على الأقل.\n2️⃣ لا يحتوي على حروف أو أرقام عربية.\n3️⃣ لا يحتوي على رموز خاصة مثل: @, #, $, %, &.\n4️⃣ يمكن أن يحتوي على حروف إنجليزية وأرقام فقط.\n\n➡️ الرجاء إدخال اسم مستخدم صالح.`;

const MSG_ASK_PASSWORD = `✅ تم قبول اسم المستخدم!\nالآن أدخل كلمة المرور (3 أحرف على الأقل):`;

const MSG_PASSWORD_SHORT = `❌ كلمة المرور قصيرة جدًا. يجب أن تكون 3 أحرف على الأقل.`;

const MSG_ACCOUNT_CREATING = `⏳ جارٍ إنشاء حسابك على موقع إيشانسي... قد يستغرق الأمر بضع ثوانٍ.`;

const MSG_ACCOUNT_SUCCESS = (displayUsername, password) =>
  `✅ تم إنشاء حسابك بنجاح!\n\n▫️ اسم المستخدم: ${displayUsername}\n▫️ كلمة المرور: ${password}\n\nيمكنك الآن العودة للقائمة الرئيسية.`;

function isValidUsername(str) {
  if (!str || str.length < 5) return false;
  return /^[a-zA-Z0-9]{5,}$/.test(str.trim());
}

const BYPASS_TIMEOUT_MS = (() => {
  const sec = parseInt(process.env.BYPASS_TIMEOUT_SEC, 10);
  if (Number.isNaN(sec) || sec < 1) return 20000;
  return Math.min(Math.max(sec, 1), 120) * 1000;
})();

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

function formatNumber(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Full profile message (معلومات الملف الشخصي) — matches web bubble content; bot-level settings from env
function profileMessage(user) {
  if (!user || !user.ichancy_login) {
    return '❌ لا يوجد حساب مرتبط. يرجى إنشاء حساب أولاً من القائمة الرئيسية.';
  }
  const depositRequired = formatNumber(process.env.DEPOSIT_REQUIRED_LS || 50000);
  const referralsRequired = parseInt(process.env.ACTIVE_REFERRALS_REQUIRED, 10) || 5;

  const userId = user.ichancy_user_id || user.telegram_user_id || '—';
  const login = user.ichancy_login || '—';
  const password = user.password ? String(user.password) : '—';
  const balance = formatNumber(user.balance ?? 0);
  const gifts = formatNumber(user.gifts ?? 0);
  const spinsAvailable = Number(user.wheel_spins_available_today ?? 0);

  return `👤 معلومات حسابك:

🆔 رقم المستخدم: ${userId}
▫️ اسم المستخدم: ${login}
▫️ كلمة المرور: ${password}
💰 الرصيد الحالي: ${balance} ل.س
🎁 الرصيد من الهدايا: ${gifts} ل.س

🎡 لفات العجلة المتاحة اليوم: ${spinsAvailable} (${spinsAvailable} لفة)
🚫 حالة الأهلية:
💰 تحتاج لإيداع ${depositRequired} ل.س (خلال 24س) لتفعيل لفة
👥 تحتاج ${referralsRequired} إحالات نشطة (خلال 24س) لتفعيل لفة

📌 شروط اللعبة: إيداع ${depositRequired} ل.س أو ${referralsRequired} إحالات نشطة (خلال آخر 24س) لتفعيل اللفات اليومية.`;
}

// Golden Tree game URL (from .env)
const GOLDEN_TREE_URL = process.env.GOLDEN_TREE_URL || 'https://www.ichancy.com/slots/all/36/pascal-gaming/77612-500008078-golden-tree:-buy-bonus?mode=real';

const ICHANCY_SITE_URL = process.env.ICHANCY_SITE_URL || 'https://ichancy.com/';
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || 'Raphael Bot';

// Ichancy account view: message text (account name, balance, gifts) + "choose operation"
function ichancyAccountMessage(user, botName) {
  const accountName = (user && user.ichancy_login) ? user.ichancy_login : '—';
  const balance = user ? Number(user.balance) : 0;
  const gifts = user ? Number(user.gifts) : 0;
  return `👤 حساب ${accountName} على ${botName}:\n\n💰 رصيدك: ${balance} ل.س\n🎁 هدايا: ${gifts} ل.س\n\n💠 اختر العملية المطلوبة:`;
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

// Full main menu after login / start — matches Ichancy UI: Ichancy row, charge/withdraw, profile, gift, jackpot, wallet, referrals/financial, box/support, Golden Tree link, redeem, terms
function loggedInMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Ichancy', callback_data: 'ichancy' }],
        [{ text: '💰 شحن البوت', callback_data: 'charge' }, { text: '💸 سحب من البوت', callback_data: 'withdraw' }],
        [{ text: '👤 معلومات الملف الشخصي', callback_data: 'profile' }],
        [{ text: '🎁 كود هدية', callback_data: 'gift_code' }],
        [{ text: '🎰 الجاك بوت', callback_data: 'jackpot' }],
        [{ text: '💼 محفظتي', callback_data: 'wallet' }],
        [{ text: '👥 الإحالات', callback_data: 'referrals' }, { text: '📄 عرض السجل المالي', callback_data: 'financial_record' }],
        [{ text: '🎮 لعبة الصناديق', callback_data: 'box_game' }, { text: '💬 مراسلة الدعم', callback_data: 'support' }],
        [{ text: 'Golden Tree ↗', url: GOLDEN_TREE_URL }],
        [{ text: '💸 استرداد آخر طلب سحب', callback_data: 'redeem_withdrawal' }],
        [{ text: '📜 دليل المستخدم وشروط البوت', callback_data: 'terms' }],
      ],
    },
  };
}

// /start — للبدء (clear create-account state so user can get new OTP)
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  delete userState[chatId];

  // Fire-and-forget: warm bypass cache for agents.ichancy.com (do not wait)
  pingBypassCookiesAgentsIchancy();

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

  // No account (no row or no ichancy_login) or DEBUG: show create-account menu. Else full menu.
  let user = null;
  try {
    user = await getUserByTelegramId(userId);
  } catch (err) {
    console.warn('DB getUserByTelegramId on /start:', err.message);
  }
  const hasAccount = user && user.ichancy_login;
  const startKeyboard = DEBUG_MODE || !hasAccount ? mainMenuKeyboard() : loggedInMainKeyboard();
  await bot.sendMessage(chatId, MAIN_MENU_TEXT, startKeyboard);
});

// Callback: create account, terms, terms_agree, terms_back
bot.on('callback_query', async (query) => {
  try {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

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
    await bot.sendMessage(chatId, MSG_OTP_PROMPT(otp));
    return;
  }

    if (data === 'terms') {
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
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(),
      });
      return;
    }

    // Back from account-success → show full main menu (Ichancy + Golden Tree)
    if (data === 'main_menu_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(),
      });
      return;
    }

    // Ichancy button — update same message with account view (balance, gifts from DB)
    if (data === 'ichancy') {
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // Back from Ichancy account view → main menu
    if (data === 'ichancy_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(),
      });
      return;
    }

    // Delete account: show warning + Yes / No buttons
    if (data === 'delete_account') {
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

    // "العودة إلى حسابي" → back to Ichancy account view
    if (data === 'delete_cancel_back_to_account') {
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const text = ichancyAccountMessage(user, BOT_DISPLAY_NAME);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...ichancyAccountKeyboard(),
      });
      return;
    }

    // معلومات الملف الشخصي — show full user profile from DB
    if (data === 'profile') {
      let user = null;
      try {
        user = await getUserByTelegramId(query.from.id);
      } catch (err) {
        console.warn('DB getUserByTelegramId:', err.message);
      }
      const text = profileMessage(user);
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...profileBackKeyboard(),
      });
      return;
    }

    // Back from profile → main menu
    if (data === 'profile_back') {
      await bot.editMessageText(MAIN_MENU_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        ...loggedInMainKeyboard(),
      });
      return;
    }

    // Confirm delete → move record to deleted_users, then remove from users
    if (data === 'delete_account_confirm') {
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

    // Placeholders for other Ichancy account actions
    if (['transfer_to_ichancy', 'withdraw_ichancy'].includes(data)) {
      await bot.answerCallbackQuery(query.id, { text: 'قيد التطوير' }).catch(() => {});
      return;
    }

    // Placeholders for logged-in menu (can implement later)
    if (['withdraw', 'charge', 'gift_code', 'jackpot', 'wallet', 'financial_record', 'referrals', 'support', 'box_game', 'redeem_withdrawal'].includes(data)) {
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

  if (state.step === 'await_otp') {
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
    if (!isValidUsername(text)) {
      return bot.sendMessage(chatId, MSG_USERNAME_INVALID);
    }
    state.step = 'await_password';
    state.username = text.trim();
    return bot.sendMessage(chatId, MSG_ASK_PASSWORD);
  }

  if (state.step === 'await_password') {
    if (text.length < 3) {
      return bot.sendMessage(chatId, MSG_PASSWORD_SHORT);
    }
    const username = state.username;
    const password = text;
    delete userState[chatId];

    const creatingMsg = await bot.sendMessage(chatId, MSG_ACCOUNT_CREATING);
    const displayUsername = username + '-Bot';

    try {
      const parentId = process.env.ICHANCY_PARENT_ID;
      if (!parentId) {
        await bot.editMessageText('❌ لم يتم ضبط ICHANCY_PARENT_ID في ملف .env', {
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

      const agentUsername = process.env.ICHANCY_AGENT_USERNAME;
      const agentPassword = process.env.ICHANCY_AGENT_PASSWORD;
      if (!agentUsername || !agentPassword) {
        await bot.editMessageText('❌ لم يتم ضبط ICHANCY_AGENT_USERNAME / ICHANCY_AGENT_PASSWORD في ملف .env', {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          ...successBackKeyboard(),
        });
        return;
      }

      // Probe batches in parallel; first URL with cached cookie wins. Else fresh bypass on one server.
      const preferredBaseUrl = await probeBypassServers();
      let loginResult;
      if (preferredBaseUrl) {
        loginResult = await loginToSingleServer(preferredBaseUrl, agentUsername, agentPassword, {
          timeoutMs: BYPASS_TIMEOUT_MS,
        });
      } else {
        loginResult = await loginWithFreshBypass(agentUsername, agentPassword, {
          timeoutMs: BYPASS_TIMEOUT_MS,
        });
      }
      if (!loginResult.success) {
        const msg = (loginResult.data && loginResult.data.message) || 'فشل تسجيل دخول الوكيل.';
        await bot.editMessageText(`❌ ${msg}`, {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          ...successBackKeyboard(),
        });
        return;
      }

      let regResult = await registerPlayer(playerPayload, loginResult.cookies, parentId, {
        preferredBaseUrl: loginResult.baseUrl,
      });

      if (!regResult.success) {
        loginResult = await loginWithFreshBypass(agentUsername, agentPassword, {
          timeoutMs: BYPASS_TIMEOUT_MS,
        });
        if (loginResult.success) {
          regResult = await registerPlayer(playerPayload, loginResult.cookies, parentId, {
            preferredBaseUrl: loginResult.baseUrl,
          });
        }
      }

      if (regResult.success) {
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
          ...successBackKeyboard(),
        });
      } else {
        const errMsg = (regResult.data && regResult.data.message) || regResult.data || 'Unknown error';
        await bot.editMessageText(`❌ فشل إنشاء الحساب.\n\n${String(errMsg)}`, {
          chat_id: chatId,
          message_id: creatingMsg.message_id,
          ...successBackKeyboard(),
        });
      }
    } catch (e) {
      console.error('Create account error:', e);
      await bot.editMessageText(`❌ خطأ في الاتصال بالخدمة. تأكد من تشغيل Cloudflare Bypass (منفذ 8000) وإعداد بيانات الوكيل في .env`, {
        chat_id: chatId,
        message_id: creatingMsg.message_id,
        ...successBackKeyboard(),
      });
    }
    return;
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

(async () => {
  try {
    await initDb();
    console.log('DB ready (database and tables synced).');
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }
  bot.startPolling();
  console.log('Ichancy bot is running (polling).');
})();
