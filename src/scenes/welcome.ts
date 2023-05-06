import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { bot } from "../bot.ts"
import type { MyContext } from "../context.ts"
import { me } from "../me.ts"
import { supabase } from "../middleware/session/session.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { oneLine, oneLineCommaListsAnd, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { getUserReference, type Modify, getAssistantResponse } from "../utils.ts"
import { delay } from "https://deno.land/std@0.184.0/async/delay.ts"
import { WELCOME_SCENE_ID, BUY_CREDITS_SCENE_ID } from "../constants.ts"
import { Buffer } from "node:buffer"

const {
	DEVELOPER_CHAT_ID,
} = Deno.env.toObject()

interface PiggyBank {
  id: number,
  credits: number,
  donors: string[],
  given_to: number | null,
}

type Session = MyContext["session"]
type NewSession = Modify<Session, {
  __scenes: Modify<Session["__scenes"], {
    state?: {
      leavingIntentionally?: boolean
      waitingForPiggyBank?: boolean
      termsMessageId?: number
      writingFeedback?: boolean
      haveSentVoiceMessage?: boolean
    }
  }>
}>

type SceneSessionData = NewSession["__scenes"]

export type NewContext = Omit<MyContext, "scene"> & Modify<MyContext, {
  session: NewSession
}> & {
  scene: Scenes.SceneContextScene<NewContext, SceneSessionData>
}

export const welcomeScene = new Scenes.BaseScene<NewContext>(WELCOME_SCENE_ID)

const lookForPiggyBank = async (ctx: NewContext) => {
  const { data: row } = await supabase
    .from("piggy_banks")
    .select()
    .is("given_to", null)
    .order("credits", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!row) {
    return await ctx.reply(oneLine`
      I'm sorry, there are no piggy banks left.
      Would you like to buy some credits then after all?
      With just one dollar or euro, you can talk with me for quite a while.
      And if you would like, you can also donate a little extra.
      To create piggy banks for people who are in a tight spot financially.
      If you yourself are in a tight spot financially,
      I can also notify you when a new piggy bank becomes available.
    `, Markup.inlineKeyboard([
      [ Markup.button.callback("I want to buy credits", "buy_credits") ],
      [ Markup.button.callback("I'd like to be notified", "notify_me") ],
    ]))
  }

  const piggyBank = row as PiggyBank

  piggyBank.given_to = ctx.from!.id

  const { given_to } = piggyBank

  await supabase
    .from("piggy_banks")
    .update({ given_to })
    .eq("id", piggyBank.id)

  ctx.userSession.credits.received_from_gifts = piggyBank.credits

  const retailPrice = ctx.userSession
    .retailPriceForCredits(piggyBank.credits)
    .toFixed(2)

  const anonymousDonors = piggyBank.donors.filter(
    name => /anonymous/i.test(name)
  ).length

  const knownDonors = piggyBank.donors.filter(
    name => !/anonymous/i.test(name)
  )

  const contributors = knownDonors
    .concat(
      anonymousDonors > 0
        ? `${anonymousDonors} anonymous user${anonymousDonors > 1 ? "s" : ""}`
        : []
    )

  await ctx.reply(oneLineCommaListsAnd`
    Yay, there is a piggy bank available for you!
    It has ${piggyBank.credits} credits in it,
    which equates to about $${retailPrice}.
    And it was paid for by ${contributors}.
    And now it's yours!
    I can't tell you how long it will last exactly,
    because that depends on a lot of factors.
    But you'll see. Anyway, let's talk!
  `)

  await delay(400)

  const lastMessage = ctx.chatSession.messages.at(-1)

  if (!lastMessage || lastMessage.user_id !== ctx.from?.id) {
    const message = oneLine`
      Hey ${ctx.from!.first_name},
      what's on your mind?
    `

    await ctx.reply(message)

    ctx.chatSession.addMessage({ message })
  }

  ctx.scene.state.leavingIntentionally = true
  return ctx.scene.leave()
}

const getWelcomingVoiceMessage = async () => {
  const __dirname = new URL('.', import.meta.url).pathname
  const voiceMessageFile = await Deno.open(`${__dirname}/welcome.ogg`, { read: true })
  const info = await voiceMessageFile.stat()
  const data = new Uint8Array(info.size)
  await voiceMessageFile.read(data)

  try {
    voiceMessageFile.close()
  } catch {
    // ignore
  }

  return Buffer.from(data)
}

welcomeScene.enter(async ctx => {
  ctx.scene.state.leavingIntentionally = false
  console.log(ctx.userSession, ctx.scene.state)

  if (
    ctx.userSession.hasAgreedToTerms &&
    ctx.userSession.canConverse
  ) return ctx.scene.leave()

  await bot.telegram.setMyCommands(
    [{ command: "start", description: "Start again." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  if (!ctx.userSession.haveSpokenBefore) {
    await ctx.persistentChatAction(
      "record_voice",
      async () => {
        const buffer = await getWelcomingVoiceMessage()
        await ctx.sendVoice({ source: buffer })
      }
    )

    ctx.scene.state.haveSentVoiceMessage = true
  
    return await ctx.reply(oneLine`
      Hello there! I'm ${me.first_name}.
      Please listen to that voice message first.
      And when you're done, press one of the buttons below.
    `, Markup.inlineKeyboard([
      [ Markup.button.callback("I've listened, please continue", "continue") ],
      [ Markup.button.callback("I don't want to continue", "dont_continue") ],
    ]))
  }

  if (!ctx.userSession.hasAgreedToTerms) {
    if (ctx.scene.state.termsMessageId) {
      await ctx.deleteMessage(ctx.scene.state.termsMessageId).catch(() => {})
    }

    if (!ctx.scene.state.haveSentVoiceMessage) {
      await ctx.persistentChatAction(
        "record_voice",
        async () => {
          const buffer = await getWelcomingVoiceMessage()
          await ctx.sendVoice({ source: buffer })
        }
      )

      ctx.scene.state.haveSentVoiceMessage = true

      const termsMessage = await ctx.reply(oneLine`
        I've had an update recently,
        I've sent you a voice message from Evert, my creator.
        Please listen to that voice message first.
        And when you're done, press one of the buttons below.
      `, Markup.inlineKeyboard([
        [ Markup.button.callback("I've listened, please continue", "continue") ],
        [ Markup.button.callback("I don't want to continue", "dont_continue") ],
      ]))

      ctx.scene.state.termsMessageId = termsMessage.message_id

      console.log("Updated state!", ctx.scene.state)

      return
    }

    const termsMessage = await ctx.reply(
      oneLine`
        Sorry, but before we can continue,
        I first need to know if you agree with what Evert explained
        about how this bot works, in that first voice message.
        If you don't agree, you could always send Evert a message about it.
      `,
      Markup.inlineKeyboard([
        [ Markup.button.callback("Okay, I agree", "continue") ],
        [ Markup.button.callback("I don't agree", "dont_agree") ],
      ])
    )

    ctx.scene.state.termsMessageId = termsMessage.message_id

    return
  }

  if (
    !ctx.userSession.credits.received_from_gifts
    && !ctx.userSession.credits.purchased
  ) {
    if (!ctx.scene.state.waitingForPiggyBank) {
      return await lookForPiggyBank(ctx)
    }

    return await ctx.reply(oneLine`
      I'm sorry, but no new piggy banks have become available yet.
      I'll let you know when one becomes available, okay?
      Or you can always still buy some credits.
      It can be as little as one dollar or euro.
    `, Markup.inlineKeyboard([
      [ Markup.button.callback("Okay, I'll buy credits", "buy_credits") ],
      [ Markup.button.callback("I'll keep waiting", "notify_me") ],
    ]))
  }

  return ctx.reply(oneLine`
    I'm sorry, but you've used up all your credits.
    Do you want to buy some more?
    Or do you want to be notified when a new piggy bank becomes available?
  `, Markup.inlineKeyboard([
    [ Markup.button.callback("I want to buy credits", "buy_credits") ],
    [ Markup.button.callback("I'd like to be notified", "notify_me") ],
  ]))
})

welcomeScene.action(["continue", "take_piggy_bank"], async ctx => {
  ctx.userSession.hasAgreedToTerms = true
  const trigger = ctx.match[0] as "continue" | "take_piggy_bank"

  await ctx.deleteMessage().catch(() => {})

  if (ctx.userSession.credits.used && trigger === "continue") {
    return await ctx.reply(oneLine`
      Okay, great! I see that you've already been using the bot
      since before it was officially released. (Which it now is.)
      Evert has a small preference to save the piggy banks for new users.
      So I just want to ask, would you be willing to buy some credits?
      If you are really not in a financially comfortable position,
      then you can choose to take a piggy bank if there's one available.
      Let me know what you prefer by pressing one of the buttons below.
    `, Markup.inlineKeyboard([[
      Markup.button.callback("buy credits", "buy_credits"),
      Markup.button.callback("take piggy bank", "take_piggy_bank"),
    ]]))
  }

  await ctx.reply(oneLine`
    Okay! I'm gonna check if there's a piggy bank available for you.
  `)

  return await lookForPiggyBank(ctx)
})

welcomeScene.action("dont_continue", async ctx => {
  await ctx.deleteMessage().catch(() => {})

  await ctx.reply(oneLine`
    Okay, I'm assuming you're not comfortable with the lack of encryption.
    If you ever change your mind, you can always continue by pressing the button below.
  `, Markup.inlineKeyboard([
    [ Markup.button.callback("Okay, I do want to continue", "continue") ],
    [ Markup.button.callback("I want to send Evert a message", "dont_agree") ],
  ]))
})

welcomeScene.action("buy_credits", async ctx => {
  await ctx.deleteMessage().catch(() => {})
  await ctx.scene.enter(BUY_CREDITS_SCENE_ID)
})

welcomeScene.action("notify_me", async ctx => {
  await ctx.deleteMessage().catch(() => {})

  ctx.scene.state.waitingForPiggyBank = true

  await ctx.reply(oneLine`
    Okay, I'll notify you when somebody donates a new piggy bank.
  `)
})

welcomeScene.action("dont_agree", async ctx => {
  await ctx.deleteMessage().catch(() => {})
  await ctx.reply(oneLine`
    Okay, do you want to write Evert a message about why you don't agree?
    Just know that if you want to do that,
    I'll also send Evert your Telegram username, so he can get back to you.
  `, Markup.inlineKeyboard([
    [ Markup.button.callback("Yes, I want to write a message", "write_feedback") ],
  ]))
})

welcomeScene.action("write_feedback", async ctx => {
  await ctx.deleteMessage().catch(() => {})

  await ctx.reply(oneLine`
    Okay, please write your message below.
    Or record a voice message.
    And then I will forward that to Evert.
  `)

  ctx.scene.state.writingFeedback = true
})

welcomeScene.command("start", async ctx => {
  ctx.scene.state.leavingIntentionally = true
  await ctx.scene.reenter()
})

welcomeScene.on([message("text"), message("voice")], async ctx => {
  if (ctx.scene.state.writingFeedback) {
    const { userRef, parse_mode, userId } = getUserReference(ctx.from)

    if ("voice" in ctx.message) {
      await ctx.telegram.sendMessage(DEVELOPER_CHAT_ID, oneLine`
        ${userRef}${userId ? ` (id: ${userId})` : ""}
        doesn't agree with the terms
        and they sent you a voice message about it.
      `, { parse_mode })

      await ctx.forwardMessage(DEVELOPER_CHAT_ID)
    }

    if ("text" in ctx.message) {
      await ctx.telegram.sendMessage(DEVELOPER_CHAT_ID, stripIndents`
        ${userRef} doesn't agree with the terms, and they wrote:

        <i>${ctx.message.text}</i>

        ${userId ? `User ID: <code>${userId}</code>` : ""}
      `, { parse_mode: "HTML" })
    }

    await ctx.reply(oneLine`
      Okay, I've sent your message to Evert.
      He'll get back to you as soon as possible.
      For now, all we can do is wait, unfortunately.
    `)

    ctx.scene.state.writingFeedback = false
  }

  else if (ctx.userSession.canConverse)
    await ctx.scene.leave()

  ctx.scene.state.leavingIntentionally = true
  await ctx.scene.reenter()
})

welcomeScene.leave(async ctx => {
  await bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  if (ctx.scene.state.leavingIntentionally) {
    if (!ctx.userSession.canConverse) return

    const lastMessage = ctx.chatSession.messages.at(-1)
    if (lastMessage && lastMessage.user_id === ctx.from?.id) {
      await ctx.sendChatAction("typing")
      const reply = await getAssistantResponse(ctx)
      await ctx.reply(reply)
    }

    return
  }

  if (ctx.userSession.canConverse)
    return await ctx.reply(oneLine`
      I'm sorry, something went wrong.
      Can you repeat that?
    `)
})
