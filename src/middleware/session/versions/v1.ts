import type { NewSession } from "../new-session.ts"
import { Scenes, type Context } from "npm:telegraf@4.12.3-canary.1"

export type Message = {
	type: "text" | "voice",
	name: string,
	message: string,
	tokens: number,
	date: string,
	checkpoint?: boolean,
}

export class ChatSession implements NewSession {
	version: 1 = 1
  messages: Message[] = []
  storeMessages: boolean
  language_code: string
  type: "private" | "group"

	constructor(ctx: Context) {
		const isPrivate = ctx.chat?.type === "private"
		this.storeMessages = isPrivate
		this.language_code = isPrivate ? ctx.from?.language_code ?? "en" : "en"
		this.type = ctx.chat?.type === "private" ? "private" : "group"
	}
}

export interface UserSettings {
  receiveVoiceTranscriptions: boolean
  askForDonation: boolean
}

export class UserSession implements NewSession {
	version: 1 = 1
  haveSpokenBefore = false
  settings: UserSettings = {
		receiveVoiceTranscriptions: true,
		askForDonation: true,
	}
  cost = 0
  totalTokensUsed = 0
  totalTokensPaidFor = 0
  totalTokensGifted = 250_000
  requests: {
    totalTokensUsed: number
    cost: number
    date: Date
  }[] = []
}

export class UserChatSession implements NewSession {
	version: 1 = 1
  __scenes: Scenes.SceneSessionData = {}
}

export type Sessions<Ctx extends Context = Context> = {
	chatSession: (ctx: Ctx) => ChatSession
	userSession: (ctx: Ctx) => UserSession
	session: (ctx: Ctx) => UserChatSession
}

export const sessions: Sessions = {
	chatSession: (ctx) => new ChatSession(ctx),
	userSession: () => new UserSession(),
	session: () => new UserChatSession(),
}
