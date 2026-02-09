async function telegramApi(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("Missing BOT_TOKEN");
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (!data.ok) {
    const msg = data.description || "Telegram API error";
    throw new Error(msg);
  }
  return data.result;
}

async function sendAlertMessage({ chatId, text, appUrl }) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open app", web_app: { url: appUrl } }]
      ]
    }
  };
  return telegramApi("sendMessage", payload);
}

module.exports = { telegramApi, sendAlertMessage };
