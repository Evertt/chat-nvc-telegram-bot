import { Modify } from "../../../utils.ts"
import { type NewSession } from "../new-session.ts"
import { type Context } from "npm:telegraf@4.12.3-canary.1"
import {
  MARKUP,
  UserSession as PrevUserSession,
  Sessions as PrevSessions,
  sessions as prevSessions,
  UserSettings as PrevUserSettings,
} from "./v3.ts"
export * from "./v3.ts"
import { supportedCurrencies } from "../../../constants.ts"
import { Assistant, GPT_3_5, GPT_4 } from "../../../assistants/index.ts"

export type UserSettings = Modify<PrevUserSettings, {
  askForDonation: never
  notifyOnShutdownDuringTesting: never
  audioTranscriptionService?: "Whisper" | "Conformer-1"
  currency?: typeof supportedCurrencies[number]
  donorName?: string
}>

export type CreditStats = {
  used: number
  purchased: number
  received_from_gifts: number
  readonly available: number
}

const startingCredits: () => CreditStats = () => ({
  used: 0,
  purchased: 0,
  received_from_gifts: 0,
  get available() {
    return this.purchased + this.received_from_gifts - this.used
  }
})

export type NewUserSession = Modify<PrevUserSession, {
  tokens: never,
  tokensPerRetailDollar: never
  wholesaleCostPerToken: never
  retailPricePerToken: never
  wholesaleCostForTokens: never
  retailPriceForTokens: never

  readonly creditsPerRetailDollar: number
  readonly wholesaleCostPerCredit: number
  readonly retailPricePerCredit: number
  readonly wholesaleCostForCredits: (credits: number) => number
  readonly retailPriceForCredits: (credits: number) => number

  settings: UserSettings
  assistant: Assistant

  credits: CreditStats,
  hasAgreedToTerms: boolean,
  readonly canConverse: boolean,
  averageTokenErrorPerMessage: number,
} & NewSession<PrevUserSession>>

export class UserSession implements NewUserSession {
  readonly version: 4 = 4

  haveSpokenBefore = false
  hasAgreedToTerms = false
  averageTokenErrorPerMessage = 0

  settings: UserSettings = {
		receiveVoiceTranscriptions: true,
    backendAssistant: "ChatGPT",
    audioTranscriptionService: undefined,
	}

  get wholesaleCost() {
    return this.wholesaleCostForCredits(this.credits.used)
  }

  get retailPrice() {
    return this.retailPriceForCredits(this.credits.used)
  }

  get creditsPerRetailDollar() {
    return Math.round(1 / this.retailPricePerCredit)
  }

  credits = startingCredits()

  requests = 0

  get wholesaleCostPerSecond() {
    const { audioTranscriptionService } = this.settings

    if (audioTranscriptionService == null)
      return 0

    const costPerSecondForAllServices = {
      "Whisper": 0.0001,
      "Conformer-1": 0.00025,
    } as const

    return costPerSecondForAllServices
      [audioTranscriptionService]
  }

  get wholesaleCostPerCredit() {
    return this.assistant.wholesaleCostPerCredit
  }

  get creditsPerSecond() {
    // calculate how many credits are equal to one second
    // based on their respective wholesale costs
    return (1 / this.wholesaleCostPerCredit) * this.wholesaleCostPerSecond
  }

  get retailPricePerSecond() {
    return this.wholesaleCostPerSecond * (1 + MARKUP)
  }

  get retailPricePerCredit() {
    return this.assistant.retailPricePerCredit
  }

  get canConverse() {
    return this.credits.available > 0
  }

  language_code: string
  assistant: Assistant

  constructor(ctx: Context) {
    this.language_code = ctx.from?.language_code ?? "en"
    this.assistant = this.settings.backendAssistant === "GPT-4"
      ? new GPT_4()
      : new GPT_3_5()
  }

  wholesaleCostForCredits(credits: number = this.credits.used) {
    return credits * this.wholesaleCostPerCredit
  }

  retailPriceForCredits(credits: number = this.credits.used) {
    return credits * this.retailPricePerCredit
  }

  migrate(prevUserSession: PrevUserSession) {
    const {
      version: _,
      tokens,
      ...data
    } = prevUserSession

    Object.assign(this, data)
    this.credits = startingCredits()
    this.credits.used = tokens.used

    // @ts-expect-error I know what I'm doing
    delete this.settings.askForDonation
    this.settings.audioTranscriptionService = undefined

    // resetting request count,
    // because I changed when I'm
    // incrementing it
    this.requests = 0

    this.assistant = this.settings.backendAssistant === "GPT-4"
      ? new GPT_4()
      : new GPT_3_5()

    return this
  }

  toJSON() {
    return {
      ...this,
      assistant: undefined
    }
  }

  restore() {
    // this is to restore the
    // get available() getter
    // because it gets turned into
    // a regular property during
    // session initialization
    const credits = this.credits
    this.credits = startingCredits()
    this.credits.used = credits.used
    this.credits.purchased = credits.purchased
    this.credits.received_from_gifts = credits.received_from_gifts

    this.assistant = this.settings.backendAssistant === "GPT-4"
      ? new GPT_4()
      : new GPT_3_5()
  }
}

export type Sessions<Ctx extends Context = Context> = Modify<PrevSessions<Ctx>, {
  userSession: (ctx: Ctx) => UserSession,
}>

export const sessions: Sessions = {
  ...prevSessions,
  userSession: ctx => new UserSession(ctx),
}
