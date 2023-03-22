import { Telegraf, Scenes } from "npm:telegraf@4.12.2"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { type ContextWithSession, SceneSessionData } from "./middleware/session/session.ts"

const { TELEGRAM_KEY } = Deno.env.toObject()

export interface MyContext extends ContextWithSession {
	// declare scene type
	scene: Scenes.SceneContextScene<MyContext, SceneSessionData>
}

console.log("Instantiating Telegraf bot...")
export const bot = new Telegraf<MyContext>(TELEGRAM_KEY, {
	telegram: { webhookReply: false }
})

bot.telegram.setMyCommands([
	{ command: "start", description: "Start a new empathy session" },
	{ command: "help", description: "See some extra information" },
	{ command: "settings", description: "Change your settings" },
	// { command: "asklocation", description: "Let me ask for your location" },
])

bot.telegram.setChatMenuButton({
	menuButton: {
		type: "commands",
	}
})