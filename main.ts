import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Telegraf } from "npm:telegraf@4.12.2"

const {
  // OPENAI_KEY,
  TELEGRAM_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = '',
  MY_PORT,
  // REDIS_USERNAME,
  // REDIS_PASSWORD,
} = Deno.env.toObject()

console.log("env", Deno.env.toObject())

const bot = new Telegraf(TELEGRAM_KEY, {
  telegram: {
    webhookReply: false,
  }
})

bot.start(async ctx => {
  await ctx.reply(`You said: "${ctx.message.text}".\n` +
  "I'm under construction right now. I hope I'll be back soon-ish!")
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +MY_PORT,
      hookPath: '/',
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
    }
  : undefined

await bot.launch({ webhook })
