import { createRequire } from "https://deno.land/std@0.173.0/node/module.ts"
// import { Application } from "https://deno.land/x/oak@v12.1.0/mod.ts"
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts"
// import { Telegraf } from "https://esm.sh/telegraf@4.12.2"
// import { Telegraf } from "npm:telegraf@4.12.2"
// import { Telegraf } from "https://ga.jspm.io/npm:telegraf@4.12.2/lib/index.js"

const require = createRequire(import.meta.url)
const { Telegraf } = require("telegraf")
// import { Telegraf } from "telegraf"
// import * as telegraf from "https://deno.land/x/telegraf@v4.12.2/src/index.ts"

// const { Telegraf } = telegraf;

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

bot.start(ctx =>
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
