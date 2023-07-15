import { Modify } from "../../../utils.ts"
import type { NewSession, WithVersion } from "../new-session.ts"
import { type Context } from "npm:telegraf@4.12.3-canary.1"
import {
  Message as PrevMessage,
  ChatSession as PrevChatSession,
  UserSession as PrevUserSession,
  Sessions as PrevSessions,
  sessions as prevSessions,
  UserSettings,
} from "./v1.ts"
export * from "./v1.ts"
import type {
  ChatCompletionRequestMessageRoleEnum,
} from "npm:openai@3.3.0"
import { me } from "../../../me.ts"

// 150% profit, minus the fees that Stripe
// charges for every transaction,
// which are actually quite a lot when
// your transactions are of small amounts.
// Also a MARKUP of 1.5 means that we get
// a round number of credits per dollar.
export const MARKUP = 1.5

export type TokenStats = {
  used: number
  paidFor: number
  gifted: number
}

export type NewUserSession = Modify<PrevUserSession, {
  cost: never

  readonly wholesaleCost: number
  readonly retailPrice: number
  readonly tokensPerRetailDollar: number

  totalTokensUsed: never
  totalTokensPaidFor: never
  totalTokensGifted: never

  tokens: TokenStats

  requests: number
  language_code: string
} & NewSession<PrevUserSession>>

export class UserSession implements NewUserSession {
  readonly version: 2 = 2
  haveSpokenBefore = false

  settings: UserSettings = {
		receiveVoiceTranscriptions: true,
		askForDonation: true,
	}

  get wholesaleCost() {
    return this.wholesaleCostForTokens(this.tokens.used)
  }

  get retailPrice() {
    return this.retailPriceForTokens(this.tokens.used)
  }

  get tokensPerRetailDollar() {
    return 1 / this.retailPricePerToken
  }

  tokens = {
    used: 0,
    paidFor: 0,
    gifted: this.tokensPerRetailDollar,
  }

  requests = 0

  get wholesaleCostPerToken() {
    return 1 / 5e5
  }

  get retailPricePerToken() {
    return this.wholesaleCostPerToken * (1 + MARKUP)
  }

  wholesaleCostForTokens(tokens: number) {
    return tokens * this.wholesaleCostPerToken
  }

  retailPriceForTokens(tokens: number) {
    return tokens * this.retailPricePerToken
  }

  language_code: string

  constructor(ctx: Context) {
    this.language_code = ctx.from?.language_code ?? "en"
  }

  migrate(prevUserSession: PrevUserSession) {
    this.haveSpokenBefore = prevUserSession.haveSpokenBefore

    this.settings = prevUserSession.settings

    this.tokens = {
      used: prevUserSession.totalTokensUsed,
      paidFor: prevUserSession.totalTokensPaidFor,
      gifted: Math.max(prevUserSession.totalTokensGifted, this.tokens.gifted),
    }

    this.requests = prevUserSession.requests.length

    return this
  }
}

export type Message = Modify<PrevMessage, {
  role: ChatCompletionRequestMessageRoleEnum,
  content: string
  message: never
  name: string
  user_id: never
}>

export type SubMessage = Modify<Message, {
  role?: ChatCompletionRequestMessageRoleEnum,
	date?: string
	type?: "text" | "voice"
	tokens?: number
}>

export type NewChatSession = Modify<PrevChatSession, {
  messages: Message[]
  readonly messagesFromLastCheckpoint: Message[]
  addMessage: (message: SubMessage) => void
} & NewSession<PrevChatSession>>

type Class<T> = new (ctx: Context) => T

function mix<
  N extends number,
  T extends NewSession<WithVersion<N>>,
  U extends NewSession = NewSession
>(chatSessionClass: Class<U>): Class<T> {
  return chatSessionClass as unknown as Class<T>
}

export class ChatSession extends mix<1, NewChatSession>(PrevChatSession) implements NewChatSession {
  readonly version: 2 = 2
  messages: Message[] = []

  get messagesFromLastCheckpoint(): Message[] {
		const checkpointIndex = this.messages
			.findLastIndex(message => message.checkpoint)
      
		return this.messages.slice(Math.max(checkpointIndex, 0))
	}

  constructor(ctx: Context) {
    super(ctx)
  }

  addMessage = (message: SubMessage) => {
		this.messages.push({
			...message,
      role: message.role ?? "assistant",
			name: message.name ?? me.first_name,
			type: message.type ?? "text",
			tokens: message.tokens ?? 0,
			date: message.date ?? Date(),
		})
	}

  migrate = (prevChatSession: PrevChatSession) => {
    this.messages = prevChatSession.messages.map(msg => {
      const { message, user_id, ...rest } = msg

      return {
        ...rest,
        role: "user",
        content: message ?? "",
        name: prevChatSession.getName(user_id),
      }
    })

    return this
  }
}

export type Sessions<Ctx extends Context = Context> = Modify<PrevSessions<Ctx>, {
  userSession: (ctx: Ctx) => UserSession,
  chatSession: (ctx: Ctx) => ChatSession,
}>

export const sessions: Sessions = {
  ...prevSessions,
  userSession: ctx => new UserSession(ctx),
  chatSession: ctx => new ChatSession(ctx),
}
