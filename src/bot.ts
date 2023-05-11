import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { me } from "./me.ts"
import type { MyContext } from "./context.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"

const { TELEGRAM_KEY } = Deno.env.toObject()

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
	// { command: "email", description: "Receive an email of our chat history" },
	{ command: "feedback", description: "You can give feedback to my developer about me" },
	{ command: "buy_credits", description: "Buy more credits for yourself and / or others" },
	{ command: "check_credits", description: "Check how many credits you have left" },
])

bot.botInfo = me
