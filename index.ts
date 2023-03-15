import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts"
import { TelegramBot, UpdateType } from "https://deno.land/x/telegram_bot_api@0.4.0/mod.ts"

const TOKEN = Deno.env.get("TELEGRAM_KEY") ?? config().TELEGRAM_KEY
if (!TOKEN) throw new Error("Bot token is not provided")
const bot = new TelegramBot(TOKEN)

bot.on(UpdateType.Message, async ({ message }) => {
  if (message.text) {
    return await bot.sendMessage({
      chat_id: message.chat.id,
      text: "Hi, I'm under construction right now. I'll be back soon!",
    });
  }

  await bot.sendMessage({
    chat_id: message.chat.id,
    text: "For some reason, I couldn't read your message...",
  });
});

bot.run({
  polling: true,
})

// const {
  // OPENAI_KEY,
  // TELEGRAM_KEY,
  // REDIS_USERNAME,
  // REDIS_PASSWORD,
  // SUPABASE_KEY,
  // SUPABASE_PASSWORD,
  // TELEGRAM_WEBBOOK_TOKEN,
// } = config()
