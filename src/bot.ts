import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { me } from "./me.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import type { MyContext } from "./context.ts"
import { createThread, type Thread } from "https://deno.land/x/grammy_runner@v2.0.3/platform.deno.ts"
import { assemblAIWebhook } from "./assemblyai-webhook.ts"
import { stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { InvoicePayload } from "./scenes/buy-credits.ts"
import { roundToSeconds } from "./fns.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"

const log = debug("telegraf:main-bot")

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

type ChatId = NonNullable<MyContext["chat"]>["id"]
const threads = new Map<ChatId, Thread<Update, "stop">>()

bot.use((ctx, next) => {
	const { chat } = ctx
	if (!chat) return next()

	log(`Received update from chat ${chat.id} (${chat.type})`)

	const { id } = chat

	if (!threads.has(id)) {
		log(`Creating new thread for chat ${id}...`)

		const thread = createThread<Update, "stop", typeof me>(
			new URL("./parallelize/worker.ts", import.meta.url),
			me
		)

		log(`Thread: ${thread}`)

		threads.set(id, thread)
		thread.onMessage(_ => void threads.delete(id))
	}

	const thread = threads.get(id)!
	log(`Sending update to thread ${id} ${thread}...`)
	thread.postMessage(ctx.update)
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: "/",
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
      cb: assemblAIWebhook(bot)
		}
  : undefined

console.log("Starting bot...")
bot.launch({ webhook, dropPendingUpdates: !!webhook })
  .catch(error => {
    console.error(error)
    Deno.exit(1)
  })

const setupEnd = performance.now()
console.log(`Setup took ${roundToSeconds(setupEnd - setupStart)} seconds.`)
