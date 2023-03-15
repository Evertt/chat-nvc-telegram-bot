// import { Application } from "https://deno.land/x/oak@v12.1.0/mod.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts"
// import { Telegraf } from "https://esm.sh/telegraf@4.12.2"
// import { Telegraf } from "npm:telegraf@4.12.2"
import { Telegraf } from "telegraf"

const {
  // OPENAI_KEY,
  TELEGRAM_KEY,
  // REDIS_USERNAME,
  // REDIS_PASSWORD,
  // SUPABASE_KEY,
  // SUPABASE_PASSWORD,
  // TELEGRAM_WEBBOOK_TOKEN,
} = config()

// const app = new Application()

const bot = new Telegraf(TELEGRAM_KEY)

bot.telegram.deleteWebhook()

bot.start((ctx: any) =>
  ctx.reply("Hey! I'm migrating to Deno, so at the moment I can't do anything anymore.")
)

await bot.launch()

// app.use((ctx) => {
//   ctx.response.body = JSON.stringify({
//     OPENAI_KEY,
//     TELEGRAM_KEY,
//     REDIS_USERNAME,
//     REDIS_PASSWORD,
//     SUPABASE_KEY,
//     SUPABASE_PASSWORD,
//     TELEGRAM_WEBBOOK_TOKEN,
//   }, null, 2)
// })

// await app.listen({ port: 8000 })
