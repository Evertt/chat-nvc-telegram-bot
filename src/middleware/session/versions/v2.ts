import { Modify } from "../../../utils.ts"
import type { NewSession } from "../new-session.ts"
import { type Context } from "npm:telegraf@4.12.3-canary.1"
import {
  UserSession as PrevUserSession,
  Sessions as PrevSessions,
  sessions as prevSessions,
  UserSettings,
} from "./v1.ts"
export * from "./v1.ts"

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

export type Sessions<Ctx extends Context = Context> = Modify<PrevSessions<Ctx>, {
  userSession: (ctx: Ctx) => UserSession
}>

export const sessions: Sessions = {
  ...prevSessions,
  userSession: ctx => new UserSession(ctx),
}
