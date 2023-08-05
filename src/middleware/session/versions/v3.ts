import { Modify } from "../../../utils.ts"
import { type NewSession } from "../new-session.ts"
import { type Context } from "npm:telegraf@4.12.3-canary.1"
import {
  UserSession as PrevUserSession,
  Sessions as PrevSessions,
  sessions as prevSessions,
  UserSettings as PrevUserSettings,
} from "./v2.ts"
export * from "./v2.ts"
import { Assistant, GPT_3_5, GPT_4 } from "../../../assistants/index.ts"

export type UserSettings = Modify<PrevUserSettings, {
  notifyOnShutdownDuringTesting: boolean
  backendAssistant: "ChatGPT" | "GPT-4"
}>

export type NewUserSession = Modify<PrevUserSession, {
  settings: UserSettings
} & NewSession<PrevUserSession>>

export class UserSession implements NewUserSession {
  readonly version: 3 = 3
  assistant: Assistant = new GPT_3_5()

  haveSpokenBefore = false

  settings: UserSettings = {
    notifyOnShutdownDuringTesting: false,
		receiveVoiceTranscriptions: true,
		askForDonation: true,
    backendAssistant: "ChatGPT",
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
    return this.assistant.wholesaleCostPerCredit
  }

  get retailPricePerToken() {
    return this.assistant.retailPricePerCredit
  }

  wholesaleCostForTokens(tokens: number) {
    return this.assistant.wholesaleCostForCredits(tokens)
  }

  retailPriceForTokens(tokens: number) {
    return this.assistant.retailPriceForCredits(tokens)
  }

  language_code: string

  constructor(ctx: Context) {
    this.language_code = ctx.from?.language_code ?? "en"
    this.assistant = this.settings.backendAssistant === "GPT-4"
      ? new GPT_4()
      : new GPT_3_5()
  }

  migrate(prevUserSession: PrevUserSession) {
    // @ts-expect-error trust me...
    delete prevUserSession.version
    Object.assign(this, prevUserSession)
    this.settings.backendAssistant = "ChatGPT"
    this.settings.notifyOnShutdownDuringTesting = false
    this.assistant = new GPT_3_5()

    return this
  }

  toJSON() {
    return {
      ...this,
      assistant: undefined
    }
  }

  restore() {
    this.assistant = this.settings.backendAssistant === "GPT-4"
      ? new GPT_4()
      : new GPT_3_5()
  }
}

export type Sessions<Ctx extends Context = Context> = Modify<PrevSessions<Ctx>, {
  userSession: (ctx: Ctx) => UserSession
}>

export const sessions: Sessions = {
  ...prevSessions,
  userSession: ctx => new UserSession(ctx),
}
