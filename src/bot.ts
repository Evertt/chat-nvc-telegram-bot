import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import type { MyContext } from "./context.ts"
import { sequentialize, distribute, createConcurrentSink, type UpdateConsumer } from "https://deno.land/x/grammy_runner@v2.0.3/mod.ts"
import { roundToSeconds } from "./utils.ts"
import { assemblAIWebhook } from "./assemblyai-webhook.ts"
import { stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { InvoicePayload } from "./scenes/buy-credits.ts"
import express from "https://esm.sh/express@4.18.2"

const {
	TELEGRAM_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
} = Deno.env.toObject()

type Update = MyContext["update"]

export const setupStart = performance.now()

console.log("Instantiating Telegraf bot...")
export const bot = new Telegraf<MyContext>(TELEGRAM_KEY, {
	telegram: { webhookReply: false }
})

bot.telegram.setMyCommands([
	{ command: "start", description: "Clear my memory, start with a brand new empathy session" },
	{ command: "help", description: "See some extra information" },
	{ command: "settings", description: "View and change your settings" },
	{ command: "role_play", description: "We can do a role play" },
	{ command: "email", description: "Receive an email of our chat history" },
	{ command: "feedback", description: "You can give feedback to my developer about me" },
	{ command: "buy_credits", description: "Buy more credits for yourself and / or others" },
	{ command: "check_credits", description: "Check how many credits you have left" },
])

export const me = await bot.telegram.getMe()
bot.botInfo = me

bot.on("pre_checkout_query", async ctx => {
  const { self, others, er } = JSON.parse(ctx.preCheckoutQuery.invoice_payload) as InvoicePayload
  const total = ctx.preCheckoutQuery.total_amount

  const cSelf = Math.round(self * er * 100)
  const cOthers = Math.round(others * er * 100)

  console.log("pre_checkout_query", { cSelf, cOthers, er, total })

  if (cSelf + cOthers <= total)
    return await ctx.answerPreCheckoutQuery(true)
  
  await ctx.answerPreCheckoutQuery(false, stripIndents`
    I don't know why, but the numbers don't add up.

    You want to pay $${(self + others)}.
    ${others > 0 ? `(That's $${self} for yourself and $${others} for others.)` : ""}
    But the total amount on the invoice is $${total}.

    Again, I don't know what happened, but this invoice is invalid.
  `)
})

bot.use(sequentialize(ctx => ctx.chat?.id.toString()))

const dist = distribute(new URL("./parallelize/worker.ts", import.meta.url))
bot.use(ctx => dist({ update: ctx.update, me }))

if (DOMAIN) {
	console.log("Starting bot...")

	const botWebHook = await bot.createWebhook({
		domain: DOMAIN,
		drop_pending_updates: true,
		secret_token: TELEGRAM_WEBBOOK_TOKEN,
	})

	const app = express()

	app.use(
		botWebHook,
		assemblAIWebhook(bot),
	)

	const setupEnd = performance.now()
	console.log(`Setup took ${roundToSeconds(setupEnd - setupStart)} seconds.`)

	const consumer: UpdateConsumer<Update> = {
		consume: (update) => bot.handleUpdate(update),
	}

	const sink = createConcurrentSink<Update, unknown>(
		consumer,
		(error) => Promise.reject(error),
		{}
	)

	app.listen(PORT, () => console.log("Listening on port", PORT))
} else {
	bot.launch()
}
