const https = require('https');
const { query } = require('../database');

async function sendTelegramMessage(text) {
  try {
    const res = await query("SELECT key, value FROM settings WHERE key IN ('telegram_bot_token', 'telegram_admin_id', 'telegram_alerts_enabled')");
    const map = {};
    res.rows.forEach(r => map[r.key] = r.value);

    const token = map.telegram_bot_token;
    const chatId = map.telegram_admin_id;

    if (!token || !chatId) return;

    const encodedText = encodeURIComponent(text);
    const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodedText}&parse_mode=Markdown`;

    https.get(url, (response) => {
      response.on('data', () => {});
    }).on('error', (err) => {
      console.warn('Telegram send error:', err.message);
    });
  } catch (err) {
    console.warn('Telegram notify failure:', err.message);
  }
}

module.exports = { sendTelegramMessage };
