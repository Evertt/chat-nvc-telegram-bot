import { getTokens } from "../../../tokenizer.ts"
import type { NewSession } from "../new-session.ts"
import { Scenes, type Context } from "npm:telegraf@4.12.3-canary.1"
import { type Modify } from "../../../utils.ts"
import { SYSTEM_USER_ID, SYSTEM_NAME } from "../../../constants.ts"
import { me } from "../../../me.ts"

export type Message = {
	type: "text" | "voice"
	user_id: number
	message?: string
	tokens: number
	date: string
	checkpoint?: boolean
}

export type SubMessage = Modify<Message, {
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
  type: NonNullable<Context["chat"]>["type"]
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

	get messagesFromLastCheckpoint(): Message[] {
		const checkpointIndex = this.messages
			.findLastIndex(message => message.checkpoint)
		return this.messages
			.slice(Math.max(checkpointIndex, 0))
	}

	constructor(ctx: Context) {
		const { type: chatType } = ctx.chat!
		const isPrivate = chatType === "private"
		this.storeMessages = isPrivate || chatType === "group"
		this.language_code = isPrivate ? ctx.from?.language_code ?? "en" : "en"
		this.type = chatType
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
		if (this.groupMembers instanceof Map) return
		if (Array.isArray(this.groupMembers))
			this.groupMembers = new Map(this.groupMembers)
		else if (typeof this.groupMembers === "object")
			this.groupMembers = new Map()
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

type DateStamp = string // ISO 8601
type UserId = number

export type Statistics = {
  activeUsers: Set<UserId>
  newUsers: Set<UserId>
  creditsUsed: Map<UserId, number>
}

export class StatisticsSession implements NewSession {
  version: 1 = 1

  stats = new Map<DateStamp, Statistics>()

	toJSON() {
		return {
			...this,
			stats: [ ...this.stats.entries() ],
		}
	}

	restore() {
		this.stats = new Map(this.stats)
	}
}

export type Sessions<Ctx extends Context = Context> = {
	chatSession: (ctx: Ctx) => ChatSession
	userSession: (ctx: Ctx) => UserSession
	session: (ctx: Ctx) => UserChatSession
	statistics: (ctx: Ctx) => StatisticsSession
}

export const sessions: Sessions = {
	chatSession: (ctx) => new ChatSession(ctx),
	userSession: () => new UserSession(),
	session: () => new UserChatSession(),
	statistics: () => new StatisticsSession()
}
