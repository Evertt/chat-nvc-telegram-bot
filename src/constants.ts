import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { getTokens } from "./tokenizer.ts"
import type { Message } from "./context.ts"

export const BUY_CREDITS_SCENE_ID = "BUY_CREDITS"
export const EMAIL_SCENE_ID = "EMAIL"
export const FEEDBACK_SCENE_ID = "FEEDBACK"
export const ROLE_PLAY_SCENE_ID = "ROLE_PLAY"
export const SETTINGS_SCENE_ID = "SETTINGS"
export const WELCOME_SCENE_ID = "WELCOME"
export const SYSTEM_USER_ID = 0
export const SYSTEM_NAME = "system"

export const SUMMARY_PROMPT = oneLine`
	Please summarize the observations, feelings, needs,
	and possibly requests that the other person
	(or people, if there were more than one) had in the conversation.
	If there were any valuable insights in the conversation,
	you can include those too in the summary.
`

export const SUMMARY_MESSAGE: Message = {
	user_id: SYSTEM_USER_ID,
	message: SUMMARY_PROMPT,
	type: "text",
	date: Date(),
	tokens: getTokens(SUMMARY_PROMPT),
}

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
