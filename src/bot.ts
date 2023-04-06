import { Telegraf, Scenes } from "npm:telegraf@4.12.3-canary.1"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { type ContextWithMultiSession, SceneSessionData } from "./middleware/session/session.ts"

const { TELEGRAM_KEY } = Deno.env.toObject()

export const setupStart = performance.now()
export interface MyContext extends ContextWithMultiSession {
	// declare scene type
	scene: Scenes.SceneContextScene<MyContext, SceneSessionData>
}

console.log("Instantiating Telegraf bot...")
export const bot = new Telegraf<MyContext>(TELEGRAM_KEY, {
	telegram: { webhookReply: false }
})

bot.telegram.setMyCommands([
	{ command: "start", description: "Clear my memory, start with a brand new empathy session" },
	{ command: "help", description: "See some extra information" },
	{ command: "settings", description: "View and change your settings" },
	{ command: "donate", description: "Donate to me" },
	// { command: "asklocation", description: "Let me ask for your location" },
])

bot.telegram.setChatMenuButton({
	menuButton: {
		type: "commands",
	}
})