import { getTokens } from "../../../tokenizer.ts"
import type { NewSession } from "../new-session.ts"
import { Scenes, type Context } from "npm:telegraf@4.12.3-canary.1"
import { type Modify, SYSTEM_USER_ID, SYSTEM_NAME } from "../../../utils.ts"
import { me } from "../../../me.ts"

export type Message = {
	type: "text" | "voice"
	user_id: number
	message: string
	tokens: number
	date: string
	checkpoint?: boolean
}

export type SubMessage = Modify<Message, {
	user_id?: number
	date?: string
	type?: "text" | "voice"
	tokens?: number
}>

interface User {
	id: number
	username?: string
	first_name: string
}

export class ChatSession implements NewSession {
	version: 1 = 1
  messages: Message[] = []
  storeMessages: boolean
	isEmpathyRequestGroup = false
  language_code: string
  type: "private" | "group"
	groupMembers = new Map<number, User>()
	groupMemberCount = 0

	get missingGroupMemberCount() {
		return this.groupMemberCount - this.groupMembers.size
	}

	get allMemberNames() {
		return Array
			.from(this.groupMembers.values())
			// .filter(user => user.id !== me.id)
			.map(user => user.first_name)
	}

	constructor(ctx: Context) {
		const isPrivate = ctx.chat?.type === "private"
		this.storeMessages = isPrivate
		this.language_code = isPrivate ? ctx.from?.language_code ?? "en" : "en"
		this.type = ctx.chat?.type === "private" ? "private" : "group"
		if (!isPrivate) return
		this.groupMemberCount = 1
		if (!ctx.from) return
		
		this.groupMembers.set(ctx.from.id, {
			id: ctx.from.id,
			username: ctx.from.username,
			first_name: ctx.from.first_name,
		})
	}

	resetMessages(message?: SubMessage) {
		this.messages = []
		message && this.addMessage(message)
	}

	addMessage(message: SubMessage) {
		this.messages.push({
			...message,
			user_id: message.user_id ?? me.id,
			type: message.type ?? "text",
			tokens: message.tokens ?? getTokens(message.message),
			date: message.date ?? Date(),
		})
	}

	getName(user_id: number) {
		if (user_id === SYSTEM_USER_ID) return SYSTEM_NAME
		if (user_id === me.id) return me.first_name
		const user = this.groupMembers.get(user_id)
		return user?.first_name ?? `User ${user_id}`
	}

	toJSON() {
		return {
			...this,
			groupMembers: [ ...this.groupMembers.entries() ],
		}
	}

	restore() {
		this.groupMembers = new Map(this.groupMembers)
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
