# Ichancy Telegram Bot

Node.js Telegram bot (polling) for Ichancy with channel gate, main menu, and terms flow.

## Setup

1. Copy env example and set your values:
   ```bash
   copy .env.example .env
   ```
2. Edit `.env`:
   - `BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
   - `CHANNEL_USERNAME` — channel username with or without `@` (e.g. `@ichancy_official` or `raphaeele`), or channel ID (e.g. `-1001234567890`). **The bot must be added to this channel (as admin) so it can check if users have joined.**

## Run

```bash
npm start
```

## Flow

- **/start** (للبدء): Checks if user is in the channel. If not → ask to subscribe with button. If yes → main menu.
- **Main menu**: "إنشاء حساب أيشانسي ➕" | "دليل المستخدم و شروط البوت 📄"
- **Terms**: Long terms message + "موافق✅" / "رجوع للقائمة الرئيسية🔙". Back → main menu. Agree → thank-you message.
