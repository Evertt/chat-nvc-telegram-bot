import { me } from "./me.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { Message } from "./context.ts"

export const BUY_CREDITS_SCENE_ID = "BUY_CREDITS" as const
export const EMAIL_SCENE_ID = "EMAIL" as const
export const FEEDBACK_SCENE_ID = "FEEDBACK" as const
export const ROLE_PLAY_SCENE_ID = "ROLE_PLAY" as const
export const SETTINGS_SCENE_ID = "SETTINGS" as const
export const WELCOME_SCENE_ID = "WELCOME" as const
export const SYSTEM_USER_ID = 0 as const
export const SYSTEM_NAME = "System" as const
export const BOT_NAME = me.first_name

export const SUMMARY_PROMPT = oneLine`
	Please summarize the observations, feelings, needs,
	and possibly requests that the other person
	(or people, if there were more than one) had in the conversation.
	If there were any valuable insights in the conversation,
	you can include those too in the summary.
`

export const idRoleMap = new Map<number, "system" | "assistant">([
  [SYSTEM_USER_ID, "system"],
  [me.id, "assistant"],
])

export const nameRoleMap = new Map<string, "system" | "assistant">([
  [SYSTEM_NAME, "system"],
  [me.first_name, "assistant"],
])

type TokenCounter = (message?: string | Message[]) => number

export const MAKE_SUMMARY_MESSAGE = (tokenCounter: TokenCounter): Message => ({
  role: "system",
	name: SYSTEM_NAME,
	content: SUMMARY_PROMPT,
	type: "text",
	date: Date(),
	get tokens() {
    return tokenCounter([this])
  },
  checkpoint: true,
})

// These are all the currencies that are supported
// by both Telegram and Stripe, which also
// don't have strange exception rules.
export const supportedCurrencies = [
  "AED",
  "ALL",
  "AMD",
  "AUD",
  "AZN",
  "BAM",
  "BDT",
  "BGN",
  "BND",
  "BYN",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ETB",
  "EUR",
  "GBP",
  "GEL",
  "HKD",
  "IDR",
  "ILS",
  "INR",
  "JMD",
  "KES",
  "KGS",
  "KZT",
  "LBP",
  "LKR",
  "MAD",
  "MDL",
  "MNT",
  "MVR",
  "MXN",
  "MYR",
  "MZN",
  "NGN",
  "NOK",
  "NPR",
  "NZD",
  "PHP",
  "PKR",
  "PLN",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TJS",
  "TRY",
  "TTD",
  "TZS",
  "UAH",
  "USD",
  "UZS",
  "YER",
  "ZAR",
] as const
