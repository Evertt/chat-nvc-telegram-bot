import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Telegraf } from "npm:telegraf@4.12.2"

const {
  // OPENAI_KEY,
  TELEGRAM_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = '',
  PORT,
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
  "This is a test from google cloud run.")
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: '/',
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
    }
  : undefined

await bot.launch({ webhook })
