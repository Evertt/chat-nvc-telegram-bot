import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { bot } from "../bot.ts"
import type { MyContext } from "../context.ts"
import { me } from "../me.ts"
import { supabase } from "../middleware/session/session.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { oneLine, stripIndents, oneLineCommaListsAnd } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { errorMessage, type Modify, getAssistantResponse } from "../utils.ts"
import type { Simplify, SetOptional } from "npm:type-fest@3.6.1"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { chunk } from "npm:lodash-es@4.17.21"
import CurrencyAPI from "npm:@everapi/currencyapi-js@1.0.6"
import { delay } from "https://deno.land/std@0.184.0/async/delay.ts"
import { BUY_CREDITS_SCENE_ID } from "../constants.ts"
import { supportedCurrencies } from "../constants.ts"
import type { PiggyBank, WelcomeSceneSession } from "./types.ts"

type Currency = typeof supportedCurrencies[number]

const { CURRENCY_API_KEY } = Deno.env.toObject()

const currencyApi = new CurrencyAPI(CURRENCY_API_KEY)

// If I need to convert to a different currency,
// Stripe will charge me a fee for that.
// Which I'm passing on to the user.
const conversionMargin = 0.03

const {
	STRIPE_TOKEN: PAYMENT_TOKEN = "",
  DEVELOPER_CHAT_ID,
} = Deno.env.toObject()

const currencyKeyboard = Markup.keyboard(
  chunk(supportedCurrencies, 6)
).oneTime()

interface Purchase {
  id?: number
  user_id: number
  credits_for_self: number
  credits_for_others: number
  donor_name: string
  num_of_piggy_banks: number
}

interface SceneState {
  currency?: typeof supportedCurrencies[number]
  exchangeRate?: number
  wantsToDonate?: boolean
  dollarsInTotal?: number
  dollarsForSelf?: number
  dollarsForOthers?: number
  howManyOthers?: number
  hasCanceled?: boolean
  identity?: string
  paymentCompleted?: boolean
  attemptsToCreatePurchase?: number
}

type Session = MyContext["session"]
type NewSession = Simplify<Modify<Session, {
  __scenes: Modify<Session["__scenes"], {
    state?: SceneState
  }>
}>>

type SceneSessionData = NewSession["__scenes"]

export type NewContext = Omit<MyContext, "scene"> & Modify<MyContext, {
  session: NewSession
}> & {
  scene: Scenes.SceneContextScene<NewContext, SceneSessionData>
}

export const buyCreditsScene = new Scenes.BaseScene<NewContext>(BUY_CREDITS_SCENE_ID)

buyCreditsScene.enter(async ctx => {
  await bot.telegram.setMyCommands(
    [{ command: "stop", description: "Stop buying credits." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  const available = ctx.userSession.credits.available
  const inTheRed = ctx.userSession.retailPriceForCredits(available) * -1

  const message = inTheRed > 0.5
    ? oneLine`
      Okay, you're about $${inTheRed.toFixed(2)} in the red.
      Based on how much you've talked with me so far.
      Just so you know that. But actually my first question is,
      do you want to buy credits just for yourself?
      Or would you also like to donate some credits to create piggy banks for other people?
    `
    : !ctx.userSession.credits.purchased
    && !ctx.userSession.credits.received_from_gifts
    && !ctx.userSession.credits.used
    ? oneLine`
      Hey, I'm sorry there wasn't a piggy bank available for you.
      But I'm glad that you're in a position to be able to buy credits.
      I first want to ask, do you want to buy credits just for yourself?
      Or would you also like to donate some credits to create piggy banks for other people?
    `
    : oneLine`
      Okay, let's get you some credits.
      Same question as before, do you want to buy credits just for yourself?
      Or would you also like to donate some credits to create piggy banks for other people??
    `

  await ctx.reply(stripIndents`
    ${message}

    (Just FYI, I'll speak in USD for now, but you can pay in almost any currency you want.)
  `, Markup.inlineKeyboard([
    [Markup.button.callback("Just for myself please", "just_for_myself")],
    [Markup.button.callback("I'd like to donate", "wants_to_donate")],
  ]))
})

buyCreditsScene.action(["just_for_myself", "wants_to_donate"], async ctx => {
  const trigger = ctx.match[0] as "just_for_myself" | "wants_to_donate"
  ctx.scene.state.wantsToDonate = trigger === "wants_to_donate"

  await ctx.deleteMessage().catch(() => {})
  await ctx.reply(oneLine`
    Okay, how much money do you want to spend?
    Please write any round number of dollars.
  `)
})

buyCreditsScene.action("change_currency", async ctx => {
  await ctx.deleteMessage().catch(() => {})
  await ctx.reply(oneLine`
    Okay, what currency do you want to use?
    Please choose any of the currencies you see.
    Those are the ones that we support.
  `, currencyKeyboard)
})

buyCreditsScene.hears(/^\s*(?:\$|USD)?\s*(-?\d+)\s*(?:\$|USD)?$|([A-Z]{3})|(^.+$)/, async ctx => {
  const currency = ctx.match[2] as typeof supportedCurrencies[number] | undefined
  const name = ctx.match[3] as string | undefined
  const number = Number(ctx.match[1])
  const state = ctx.scene.state

  if (name && state.wantsToDonate && state.howManyOthers == null) {
    return await ctx.reply(oneLine`
      ${state.dollarsForOthers == null
        ? oneLine`
          Sorry, but your message is supposed to
          contain just a round dollar amount.
        `
        : oneLine`
          Sorry, but your message is supposed to
          contain just a round number.
        `
      }
      
      But nothing else.
      Can you please try it again?
      Or do you want to cancel this process?
    `, Markup.inlineKeyboard([
      [Markup.button.callback("Cancel", "cancel")],
    ]))
  }

  const setCurrency = async (currency: Currency) => {
    ctx.userSession.settings.currency = currency
    state.currency = currency
    state.exchangeRate = 1

    if (currency !== "USD") {
      const latest = await currencyApi.latest({
        base_currency: "USD",
        currencies: currency,
      })

      state.exchangeRate = latest.data[currency].value * (1 + conversionMargin)
    }

    const { dollarsInTotal } = state
    const { creditsPerRetailDollar } = ctx.userSession

    const creditsInTotal = dollarsInTotal! * creditsPerRetailDollar
    const currencyInTotal = Math.round(dollarsInTotal! * state.exchangeRate * 100) / 100

    const { language_code: lc } = ctx.userSession

    return { lc, creditsInTotal, currencyInTotal }
  }

  if (!state.dollarsInTotal) {
    if (number === 0) {
      return await ctx.reply(oneLine`
        You wrote $0.
        Does that mean you want to cancel this process?
      `, Markup.inlineKeyboard([
        [Markup.button.callback("Yes", "cancel")],
        [Markup.button.callback("No", "continue")],
      ]))
    }

    if (number < 0)
      return await ctx.reply(oneLine`
        Sorry, but I can't accept negative numbers.
        Please write any round number of dollars of at least $1.
        Or you can press cancel if you want to stop this process.
      `, Markup.inlineKeyboard([
        [Markup.button.callback("Cancel", "cancel")],
      ]))

    state.dollarsInTotal = number

    if (state.wantsToDonate) {
      return await ctx.reply(oneLine`
        Okay, how much of that $${number} do you want to spend on yourself?
        Please write any round number between $0
        (in case you want to donate all of it to other people)
        and $${number - 1}.
      `)
    }

    state.dollarsForSelf = state.dollarsInTotal
    state.dollarsForOthers = 0
    state.howManyOthers = 0

    const credits = number * ctx.userSession.creditsPerRetailDollar
    const available = ctx.userSession.credits.available
    const bottomLine = available + credits

    const currency = ctx.userSession.settings.currency
      ?? ctx.scene.state.currency ?? "USD"
    const { lc, currencyInTotal } = await setCurrency(currency)

    const message = currency === "USD"
      ? oneLine`
        Okay, $${state.dollarsInTotal} will buy you ${credits} credits.
        ${available < -1000 ? oneLine`
          But since you were ${available * -1} credits in the red.
          That leaves you with ${bottomLine} credits in the end.
        ` : ""}
        Do you want to continue?
      `
      : oneLine`
        Okay, $${state.dollarsInTotal} will buy you ${credits} credits.
        ${available < -1000 ? oneLine`
          But since you were ${(-available).toLocaleString(lc)} credits in the red.
          That leaves you with ${bottomLine.toLocaleString(lc)} credits in the end.
        ` : ""}
        But since you use ${currency} as your currency.
        It'll be ${currencyInTotal.toLocaleString(lc)} ${currency} for you.
        Do you want to continue?
      `

    return await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback(`Continue with ${currency}`, "continue")],
      [Markup.button.callback("No, change my currency", "change_currency")],
    ]))
  }

  if (!state.dollarsForSelf) {
    if (number > state.dollarsInTotal) {
      return await ctx.reply(oneLine`
        Sorry, but that's more than the total amount of money you want to spend.
        Please write any round number between $0 and $${state.dollarsInTotal - 1}.
      `)
    }

    state.dollarsForSelf = number
    state.dollarsForOthers = state.dollarsInTotal - state.dollarsForSelf
    const creditsForSelf = state.dollarsForSelf * ctx.userSession.creditsPerRetailDollar
    const creditsForOthers = state.dollarsForOthers * ctx.userSession.creditsPerRetailDollar

    const roundNumbers = Array.from({
      length: 100 },
      (_, i) => i + 1
    ).filter(n => creditsForOthers % n === 0)

    const chunkLength = Array.from({
      length: roundNumbers.length },
      (_, i) => i + 1
    )
    .filter(n => roundNumbers.length % n === 0)
    .filter(n => n <= 10)
    .at(-1)

    return await ctx.reply(stripIndents`
      ${oneLine`
        Okay, that'll buy you ${creditsForSelf} credits for yourself.
        And ${creditsForOthers} credits for other people.
      `}

      ${oneLine`
        So we can put those ${creditsForOthers} credits
        into 1 piggy bank for one person.
        Or we can split it up into multiple piggy banks.
      `}

      ${oneLine`
        How many piggy banks do you want to create?
        Please choose any of the numbers
        underneath your text input field.
        Those numbers will create piggy banks
        with a nice round number of credits in them.
      `}
    `, Markup.keyboard(chunk(
        roundNumbers.map(n => `${n}`), chunkLength
      )).resize())
  }

  if (state.wantsToDonate && !state.howManyOthers) {
    const creditsForSelf = state.dollarsForSelf * ctx.userSession.creditsPerRetailDollar
    const creditsForOthers = state.dollarsForOthers! * ctx.userSession.creditsPerRetailDollar

    if (
      number < 1 ||
      number > 100 ||
      creditsForOthers % number !== 0
    ) {
      return await ctx.reply(oneLine`
        Sorry, but that's not a valid number.
        Please choose any of the numbers underneath your keyboard.
        Or if you want to cancel this process, press cancel.
      `, Markup.inlineKeyboard([
        [Markup.button.callback("Cancel", "cancel")],
      ]))
    }

    state.howManyOthers = number
    const creditsPerPiggyBank = Math.round(creditsForOthers / state.howManyOthers)

    await ctx.reply(oneLine`
      Okay, that'll buy you ${creditsForSelf} credits for yourself.
      And ${state.howManyOthers} piggy banks
      with ${creditsPerPiggyBank} per piggy bank.
      Again, thank you so much for supporting people with lesser means! 🙏
    `)

    await ctx.sendChatAction("typing")
    await delay(500)

    if (!ctx.userSession.settings.donorName) {
      return await ctx.reply(oneLine`
        We always add a name to the list of donors for each piggy bank.
        By default that name is "anonymous",
        but if you'd like you could write your name or a pseudonym,
        so that people can know who contributed to their piggy banks.
        Whatever you write in your next message will be the name we use.
      `, Markup.keyboard([
        ["anonymous", ctx.userSession.settings.donorName ?? ""].filter(Boolean),
      ]).resize().oneTime())
    }
  }

  if (state.wantsToDonate && !state.identity) {
    if (!name && !ctx.userSession.settings.donorName) {
      return await ctx.reply(oneLine`
        Sorry, but your message doesn't seem to contain a name.
        Can you please try it again?
        Or do you want to cancel this process?
      `, Markup.inlineKeyboard([
        [Markup.button.callback("Cancel", "cancel")],
      ]))
    }

    const identity = name || ctx.userSession.settings.donorName!
    const isAnonymous = /anonymous/.test(identity)
    state.identity = isAnonymous ? "anonymous" : identity

    const message = ctx.userSession.settings.donorName
      ? ""
      : isAnonymous
        ? "Okay, I'll add you as an anonymous donor."
        : `Okay, I'll add you as a donor with the name "${name}".`

    const currency = ctx.userSession.settings.currency
      ?? state.currency ?? "USD"

    const { lc, creditsInTotal, currencyInTotal } = await setCurrency(currency)

    const currencyMessage = currency === "USD"
      ? ""
      : oneLine`
        Now you'll pay ${currencyInTotal.toLocaleString(lc)} ${currency}
        for the total of ${creditsInTotal.toLocaleString(lc)} credits.
      `

    await ctx.reply(stripIndents`
      ${message}

      ${ctx.userSession.settings.donorName
        ? ""
        : oneLine`
          This is now also saved in your settings.
          So that next time we can skip this step.
          If you want to change your donor name,
          you can do that in your settings.
        `
      }

      ${currencyMessage} Do you want to go to checkout?
    `.trim(), Markup.inlineKeyboard([
      [Markup.button.callback(`Yes, I'd like to pay in ${currency}`, "continue")],
      [Markup.button.callback("No, first change my currency", "change_currency")],
    ]))

    return ctx.userSession.settings.donorName = state.identity
  }

  if (currency) {
    if (!supportedCurrencies.includes(currency)) {
      return await ctx.reply(oneLine`
        Sorry, but we don't support ${currency} yet.
        Please try again with a different currency.
      `, currencyKeyboard)
    }

    const { lc, creditsInTotal, currencyInTotal } = await setCurrency(currency)

    return await ctx.reply(oneLine`
      Okay, your account is now set up to use ${currency} as your currency.
      That means that you'll pay ${currencyInTotal.toFixed(2)}
      ${currency} in total for the full ${creditsInTotal.toLocaleString(lc)} credits.
    `, Markup.inlineKeyboard([
      [Markup.button.callback("Go to checkout", "continue")],
      [Markup.button.callback("Cancel", "cancel")],
    ]))
  }

  return await ctx.reply(oneLine`
    I'm sorry, but we've completed all the questions.
    Now you just have to choose whether you want to go to checkout or not.
  `, Markup.inlineKeyboard([
    [Markup.button.callback("Go to checkout", "continue")],
    [Markup.button.callback("Cancel", "cancel")],
  ]))
})

type Dollars = number

export interface InvoicePayload {
  self: Dollars
  others: Dollars
  // number of piggy banks
  n: number
  // exchange rate
  er: number
}

buyCreditsScene.action("continue", async ctx => {
  const { state } = ctx.scene

  const {
    dollarsForSelf,
    dollarsForOthers,
    howManyOthers,
    currency = "USD",
    exchangeRate = 1,
  } = state as Required<typeof state>

  const kind = ctx.scene.state.wantsToDonate ? "Donation" : "Purchase"
  const creditsForSelf = dollarsForSelf * ctx.userSession.creditsPerRetailDollar
  const creditsForOthers = dollarsForOthers * ctx.userSession.creditsPerRetailDollar

  const prices = [
    { label: `${creditsForSelf} credits for you`, amount: Math.round(dollarsForSelf * exchangeRate * 100) },
    { label: `${creditsForOthers} credits for ${howManyOthers} piggy banks`, amount: Math.round(dollarsForOthers * exchangeRate * 100) }
  ].filter(({ amount }) => amount > 0)

  const invoicePayload: InvoicePayload = {
    self: dollarsForSelf,
    others: dollarsForOthers,
    n: howManyOthers,
    er: exchangeRate,
  }

  await ctx.sendInvoice({
		currency,
		title: `Credits for @${me.username}`,
		description: `Thank you for your ${kind.toLowerCase()}!`,
		payload: JSON.stringify(invoicePayload),
		provider_token: PAYMENT_TOKEN,
		prices,
    max_tip_amount: 0,
	})
})

const giveWaitingPeoplePiggyBanks = async (ctx: MyContext) => {
  const { data } = await supabase
    .from("piggy_banks")
    .select()
    .is("given_to", null)
    .order("credits", { ascending: true })
    .order("created_at", { ascending: true })
    .order("updated_at", { ascending: false, nullsFirst: false })

  if (!data?.length) return

  const availablePiggyBanks = data as PiggyBank[]

  const { data: rows, error } = await supabase
    .from("sessions")
    .select()
    .not("id", "like", "test%")
    .not("session->__scenes->state->waitingForPiggyBank", "is", null)
    .order("session->__scenes->state->waitingForPiggyBank", { ascending: true })
    .limit(availablePiggyBanks.length)

  if (error) {
    console.error(error)
    return
  }

  const peopleWaiting = [ ...rows.entries() ] as [number, {
    id: `chat:${number};user:${number}`
    session: Modify<WelcomeSceneSession, {
      __scenes: SetOptional<WelcomeSceneSession["__scenes"], "current">
    }>
  }][]

  for (const [i, { id, session: userChatSession }] of peopleWaiting) {
    const { groups } = id.match(/^chat:(?<chatId>\d+);user:(?<userId>\d+)$/)!
    const { chatId, userId } = groups! as { chatId: string, userId: string }

    const { data } = await supabase
      .from("sessions")
      .select()
      .eq("id", `user:${userId}`)
      .single() as { data: { id: `user:${number}`; session: Simplify<MyContext["userSession"]> } }

    const { id: userSessionId, session: userSession } = data

    const piggyBank = availablePiggyBanks[i]
    userSession.credits.received_from_gifts += piggyBank.credits
    ;(userSession.credits.available as number) += piggyBank.credits
    piggyBank.given_to = Number(userSessionId.split(":")[1])
    userChatSession.__scenes = {}

    let { error } = await supabase
      .from("sessions")
      .update({ session: userSession })
      .eq("id", userSessionId)

    if (error) {
      console.error(error)
      continue
    }

    (
      { error } = await supabase
        .from("piggy_banks")
        .update({ given_to: piggyBank.given_to })
        .eq("id", piggyBank.id)
    )

    if (error) {
      console.error(error)
      continue
    }

    (
      { error } = await supabase
        .from("sessions")
        .update({ session: userChatSession })
        .eq("id", id)
    )

    if (error) {
      console.error(error)
      continue
    }

    await ctx.telegram.sendMessage(chatId, oneLineCommaListsAnd`
      You were gifted a piggy bank with ${piggyBank.credits} credits in it!
      It was donated by ${piggyBank.donors}.
      ${
        userSession.credits.available > 0
        ? oneLine`
          You now have ${userSession.credits.available} credits available to use.
          So we can talk now, if you'd like. 😌
        `
        : oneLine`
          Unfortunately, you are still at ${userSession.credits.available} credits.
          So we can't talk quite yet. You can either buy some extra credits,
          or opt to wait for another piggy bank. Just say anything to start that process.
        `
      }
    `)
  }

  return peopleWaiting.length
}

const createPurchaseInDb = async (ctx: MyContext, purchase: Purchase) => {
  const { error } = await supabase
    .from("purchases")
    .insert(purchase)
  
  const {
    credits_for_self,
    credits_for_others,
    donor_name,
    num_of_piggy_banks,
  } = purchase

  if (ctx.session.__scenes?.current !== buyCreditsScene.id) {
    const dollarsForSelf = credits_for_self / ctx.userSession.creditsPerRetailDollar
    const dollarsForOthers = credits_for_others / ctx.userSession.creditsPerRetailDollar

    const sceneState: Required<SceneState> = {
      currency: ctx.userSession.settings.currency ?? "USD",
      exchangeRate: 0,
      wantsToDonate: purchase.credits_for_others > 0,
      dollarsForSelf,
      dollarsForOthers,
      dollarsInTotal: dollarsForSelf + dollarsForOthers,
      howManyOthers: num_of_piggy_banks,
      identity: donor_name,
      paymentCompleted: true,
      hasCanceled: false,
      attemptsToCreatePurchase: 0,
    }

    ctx.session.__scenes = {
      current: buyCreditsScene.id,
      state: sceneState,
    }
  }

  const state = ctx.scene.state as SceneState
  state.paymentCompleted = true
  
  state.attemptsToCreatePurchase ??= 0
  state.attemptsToCreatePurchase += 1
  const { attemptsToCreatePurchase } = state

  if (error) {
    console.error(error)

    if (attemptsToCreatePurchase === 1)
      await ctx.telegram.sendMessage(
        DEVELOPER_CHAT_ID,
        stripIndents`
          An error occurred while trying to create a purchase in the database.
          
          <code>${errorMessage(error)}</code>

          User:
          <a href="tg://user?id=${ctx.from!.id}">${ctx.from!.first_name}</a>
        `,
        { parse_mode: "HTML" }
      )

    const message = credits_for_others
      ? oneLine`
        ${attemptsToCreatePurchase < 2
          ? "Okay, you have received your credits. But u" : "U"
        }nfortunately something went wrong with creating the piggy banks.
        Maybe it was just a fluke, so maybe just wait a few seconds
        and then press the button below to try again.
      `
      : oneLine`
        ${attemptsToCreatePurchase < 2
          ? "Okay, you have received your credits. But u" : "U"
        }nfortunately something went wrong with saving the invoice in our database.
        It doesn't matter much for you, but it's important for us.
        Can you please click the button below to try again?
      `

    return await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback("Try again", "try_again")],
    ]))
  }

  const selfMessage = attemptsToCreatePurchase > 1
    ? `Okay, you have received your ${credits_for_self} credits! 🙂`
    : ""

  const prefix = attemptsToCreatePurchase > 1
    ? "And a" : "A"

  const piggyBanksMessage = num_of_piggy_banks > 0
    ? oneLine`
      ${prefix}t least ${num_of_piggy_banks}
      piggy banks have been upgraded or created
      with ${credits_for_others / num_of_piggy_banks}
      credits per piggy bank! Thank you! 🙏
    `
    : attemptsToCreatePurchase === 1
      ? oneLine`
        Okay, you now have ${ctx.userSession.credits.available} credits. 🙂
      `
      : ""

  await ctx.reply(stripIndents`
    ${selfMessage}

    ${piggyBanksMessage}
  `)

  const numOfPiggyBanksGifted = await giveWaitingPeoplePiggyBanks(ctx)

  if (num_of_piggy_banks && numOfPiggyBanksGifted) {
    await ctx.reply(oneLine`
      Oh and ${numOfPiggyBanksGifted}
      ${numOfPiggyBanksGifted === 1 ? "person" : "people"}
      who were already waiting for a piggy bank have now
      immediately been gifted one, thanks to you! 🙏
    `)
  }

  return await ctx.scene.leave()
}

bot.on("pre_checkout_query", async ctx => {
  const { self, others, er } = JSON.parse(ctx.preCheckoutQuery.invoice_payload) as InvoicePayload
  const total = ctx.preCheckoutQuery.total_amount

  const cSelf = Math.round(self * er * 100)
  const cOthers = Math.round(others * er * 100)

  console.log("pre_checkout_query", { cSelf, cOthers, er, total })

  if (cSelf + cOthers <= total)
    return await ctx.answerPreCheckoutQuery(true)
  
  await ctx.answerPreCheckoutQuery(false, stripIndents`
    I don't know why, but the numbers don't add up.

    You want to pay $${(self + others)}.
    ${others > 0 ? `(That's $${self} for yourself and $${others} for others.)` : ""}
    But the total amount on the invoice is $${total}.

    Again, I don't know what happened, but this invoice is invalid.
  `)
})

// I'd prefer to do bot.on instead of buyCreditsScene.on,
// because I want to be able to handle this event even if the user
// for whatever reason is not in the buyCreditsScene.
// But for some reason if I do that then the sessions aren't available...
console.log("setting up handler for successful_payment")
buyCreditsScene.on(message("successful_payment"), async ctx => {
  console.log("successful_payment")
  const { self, others, n } = JSON.parse(ctx.message.successful_payment.invoice_payload) as InvoicePayload

  const credits_for_self = self * ctx.userSession.creditsPerRetailDollar
  const credits_for_others = others * ctx.userSession.creditsPerRetailDollar
  const scene = ctx.session.__scenes
  const currentSceneState = scene && scene.current === buyCreditsScene.id
    ? scene.state as Simplify<Required<NewContext["scene"]["state"]>>
    : undefined

  const donor_name = currentSceneState?.identity || "anonymous"

  ctx.userSession.credits.purchased += credits_for_self

  const purchase: Purchase = {
    user_id: ctx.from.id,
    credits_for_self,
    credits_for_others,
    donor_name,
    num_of_piggy_banks: n,
  }

  return await createPurchaseInDb(ctx, purchase)
})

buyCreditsScene.action("try_again", async ctx => {
  await ctx.deleteMessage().catch(() => {})

  await delay(1000)

  const state = ctx.scene.state as Simplify<Required<SceneState>>

  const purchase: Purchase = {
    user_id: ctx.from!.id,
    credits_for_self: state.dollarsForSelf * ctx.userSession.creditsPerRetailDollar,
    credits_for_others: state.dollarsForOthers * ctx.userSession.creditsPerRetailDollar,
    donor_name: state.identity,
    num_of_piggy_banks: state.howManyOthers,
  }

  return await createPurchaseInDb(ctx, purchase)
})

buyCreditsScene.action("cancel", async ctx => {
  await ctx.deleteMessage().catch(() => {})

  ctx.scene.state.hasCanceled = true

  return ctx.scene.leave()
})

buyCreditsScene.command("stop", ctx => {
  ctx.scene.state.hasCanceled = true

  return ctx.scene.leave()
})

buyCreditsScene.leave(async ctx => {
  await bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  if (ctx.scene.state.hasCanceled) {
    return await ctx.reply(oneLine`
      Okay, the purchasing process has been canceled.
    `, Markup.removeKeyboard())
  }

  if (ctx.scene.state.paymentCompleted) {
    const postfix = "What's on your mind?"
    const message = oneLine`${ctx.userSession.credits.used
      ? `Okay, now we can talk again!`
      : `Now let's talk!`
    }`

    const lastMessage = ctx.chatSession.messages.at(-1)
    if (lastMessage && lastMessage.user_id === ctx.from?.id) {
      await ctx.reply(message, Markup.removeKeyboard())
      return await ctx.persistentChatAction(
        "typing",
        () => getAssistantResponse(ctx)
        .then(async reply => {
          await ctx.reply(reply)
        })
      )
    }

    ctx.chatSession.addMessage({
      message: message + " " + postfix,
    })

    return await ctx.reply(
      message + " " + postfix,
      Markup.removeKeyboard()
    )
  }
})
