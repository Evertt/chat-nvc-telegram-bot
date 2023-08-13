import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Buffer } from "node:buffer"
import { bot, setupStart } from "./bot.ts"
import type { MyContext, SubMessage } from "./context.ts"
import { me } from "./me.ts"
import { supabase, type AllMySessions } from "./middleware/session/session.ts"
import { SYSTEM_NAME, WELCOME_SCENE_ID } from "./constants.ts"

import { type Telegraf } from "npm:telegraf@4.12.3-canary.1"

import { getTranscription } from "./audio-transcriber.ts"
import {
  askAssistant,
  getAssistantResponse,
  roundToSeconds,
  getUserReference,
} from "./utils.ts"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import type { SetOptional } from "npm:type-fest@3.6.1"

const {
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
  SUPABASE_PREFIX = "",
  DEVELOPER_CHAT_ID,
  VOICE_ID,
  ELEVENLABS_KEY,
} = Deno.env.toObject()

async function blobToBuffer(blob: Blob) {
  // Convert Blob to ArrayBuffer, and then to Uint8Array
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Define the path to the temp file
  const tempFilePath = await Deno.makeTempFile()

  // Write Uint8Array to temp file
  await Deno.writeFile(tempFilePath, uint8Array);

  // Read the file as you have done in your previous example
  const file = await Deno.open(tempFilePath, { read: true });
  const fileInfo = await file.stat();
  const fileData = new Uint8Array(fileInfo.size);
  await file.read(fileData);
  file.close();

  // Optionally, delete the temp file after reading it
  await Deno.remove(tempFilePath);
  console.log("tempFilePath", tempFilePath)

  // return tempFilePath

  // Return the data as a Node.js Buffer
  return Buffer.from(fileData);
}

await (async () => {
  const { addMiddlewaresToBot } = await import("./middleware/add-all-to-bot.ts")
  addMiddlewaresToBot(bot)
})()

await (async () => {
  const { addScenesToBot } = await import("./scenes/add-all-to-bot.ts")
  addScenesToBot(bot)
})()

bot.start(async ctx => {
  console.log("start command")

  if (ctx.chat.type !== "private")
    return ctx.reply("Please write to me in a private chat 🙏")

  await bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  if (!ctx.userSession.haveSpokenBefore || !ctx.userSession.canConverse) {
    return ctx.scene.enter(WELCOME_SCENE_ID)
  }

  const greeting = oneLine`
    Okay, let's start over. How can I help you
    this time, ${ctx.from.first_name}?
  `

  console.log("Resetting session to start with greeting.")

  ctx.chatSession.resetMessages({ content: greeting })

  console.log("Sending greeting.")
  await ctx.reply(greeting, { reply_markup: { remove_keyboard: true } })
  console.log("Greeting sent.")
})

bot.help(ctx => ctx.reply(oneLine`
  I'm ChatNVC, a bot that tries to listen to you empathically.
  You can make me forget our conversation by typing /start,
  in case you want to start fresh.
`))

bot.command("check_credits", async ctx => {
  console.log("check_credits command")

  const { credits } = ctx.userSession
  const { used, available } = credits
  const usedDollars = (used / ctx.userSession.creditsPerRetailDollar).toFixed(2)
  const availableDollars = (available / ctx.userSession.creditsPerRetailDollar).toFixed(2)

  const usedMessage = used > 0
    ? oneLine`
      You have used ${used} credits so far.
      Which is about $${usedDollars}.
    `
    : "You have not used any credits yet."

  const availableMessage = available > 0
    ? oneLine`
      You have ${available} credits left.
      Which is about $${availableDollars}.
    `
    : available === 0
      ? "You have no credits left."
      : oneLine`
        You are ${-available} credits in the red.
        Or $${-availableDollars} in the red.
      `

  await ctx.reply(oneLine`
    ${usedMessage}
    ${availableMessage}
  `)
})

bot.command("is_empathy_requesting_group", async ctx => {
  if (ctx.from.id !== +DEVELOPER_CHAT_ID) return

  if (ctx.chat.type === "private")
    return await ctx.reply(oneLine`
      Sorry, this command only works in a group chat.
    `)
  
  bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat.id } }
  )
  
  bot.telegram.setMyCommands(
    [{
      command: "is_not_empathy_requesting_group",
      description: "Let me know that this is not an empathy requesting group (anymore).",
    }],
    { scope: {
      type: "chat_member",
      chat_id: ctx.chat.id,
      user_id: +DEVELOPER_CHAT_ID,
    } }
  )
  
  if (ctx.chatSession.isEmpathyRequestGroup)
    return await ctx.reply(oneLine`
      Yes, I already know. 🙂
    `)

  ctx.chatSession.isEmpathyRequestGroup = true

  await ctx.reply(oneLine`
    Okay, thanks for letting me know
    that this group is for requesting empathy. 🙂
  `)
})

bot.command("is_not_empathy_requesting_group", async ctx => {
  if (ctx.from.id !== +DEVELOPER_CHAT_ID) return

  if (ctx.chat.type === "private")
    return await ctx.reply(oneLine`
      Sorry, this command only works in a group chat.
    `)

  bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat.id } }
  )

  bot.telegram.setMyCommands(
    [{
      command: "is_empathy_requesting_group",
      description: "Let me know that this is an empathy requesting group.",
    }],
    { scope: {
      type: "chat_member",
      chat_id: ctx.chat.id,
      user_id: +DEVELOPER_CHAT_ID,
    } }
  )

  if (!ctx.chatSession.isEmpathyRequestGroup) {
    if (Math.random() < 1/6)
      await ctx.replyWithHTML(oneLine`
        Yes, I already know that this
        is <i>not</i> a group for requesting empathy. 🙂
      `)
    
    return
  }

  ctx.chatSession.isEmpathyRequestGroup = false

  await ctx.replyWithHTML(oneLine`
    Okay, thanks for letting me know
    that this group is <i>not</i> an empathy requesting group (anymore). 🙂
  `)
})

const introduceMyself = async (ctx: MyContext) => {
  await ctx.replyWithHTML(stripIndents`
      ${oneLine`
        Hey, thanks for adding me to this group! 😊
        I'm a AI bot that can offer empathy to the best of my abilities.
        I want to explain a bit about how I work.
      `}

      ${oneLine`
        In a group, I have two modes of working. By default, I start in
        "support mode", which means that when asked,
        I will try to guess the feelings and needs of people in the group.
        Although, as long as I'm not asked, I will stay silent.
      `}

      ${oneLine`
        If this group is a group for requesting empathy,
        then you can let me know by typing /is_empathy_requesting_group.
        Then I will switch to a different mode, where I will once in a while
        remind people that I'm always available to offer empathy.
        (You know, in case no one else is available.) And that you can just
        <a href="tg://user?id=${ctx.botInfo.id}">message me privately</a>
        and then I'll be there for you.
      `}
    `)
}

bot.on(message("new_chat_members"), async ctx => {
  if (ctx.chat.type === "private") return

  const { new_chat_members } = ctx.message

  let meWasAdded = false

  for (const newMember of new_chat_members) {
    if (newMember.id === ctx.botInfo.id) {
      meWasAdded = true
      continue
    }

    ctx.chatSession.groupMembers.set(newMember.id, {
      id: newMember.id,
      username: newMember.username,
      first_name: newMember.first_name,
    })
  }

  ctx.chatSession.groupMemberCount =
    (await bot.telegram.getChatMembersCount(ctx.chat.id)) - 1

  if (meWasAdded) {
    bot.telegram.setMyCommands(
      [{
        command: "is_empathy_requesting_group",
        description: "Let me know that this is an empathy requesting group.",
      }],
      { scope: { type: "chat", chat_id: ctx.chat.id } }
    )

    await introduceMyself(ctx)
  }
})

bot.on(message("left_chat_member"), async ctx => {
  const { left_chat_member } = ctx.message
  
  if (left_chat_member.id !== ctx.botInfo.id) {
    ctx.chatSession.groupMembers.delete(left_chat_member.id)

    return ctx.chatSession.groupMemberCount =
      (await bot.telegram.getChatMembersCount(ctx.chat.id)) - 1
  }

  const newCtx = ctx as SetOptional<typeof ctx, keyof AllMySessions>
  newCtx.chatSession = undefined
  newCtx.session = undefined
  
  const { error } = await supabase
    .from("sessions")
    .delete()
    .like("id", `${SUPABASE_PREFIX}chat:${ctx.chat.id}%`)

  if (error) console.error(error)
  else console.log(`Deleted ${SUPABASE_PREFIX}chat:${ctx.chat.id} from Supabase.`)
})

const getReply = (ctx: MyContext) => {
  return ctx.userSession.assistant.getNextResponse(ctx)
  .catch((errorResponse: string) => {
    console.error("Error assistant response:", errorResponse)
    return errorResponse
  })
}

// @ts-expect-error trust me
// deno-lint-ignore ban-types
type Ctx = Parameters<Extract<Parameters<typeof bot.on<"text">>[1], Function>>[0]

const handleGroupChat = async (ctx: Ctx, lastMessage: SubMessage) => {
  const { text } = ctx.message

  const wasMentioned = "voice" in ctx.message
    ? text.includes(me.first_name) || text.includes(me.username)
    : text.includes(`@${ctx.me}`)

  const reply = ctx.message.reply_to_message

  if (ctx.chatSession.isEmpathyRequestGroup) {
    if (wasMentioned || reply?.from?.id === me.id)
      return await ctx.reply(oneLine`
        Hey, I'm happy to offer empathy.
        You can just message me privately
        and then I'm happy to listen.
      `, { reply_to_message_id: ctx.message.message_id })

    if (Math.random() < .2) {
      ctx.chatSession.resetMessages({
        content: text,
        name: ctx.from.first_name,
      })

      const copy = ctx.chatSession.messages.slice()

      const answer = await askAssistant(ctx, oneLine`
        Is the user asking for empathy / listening / support
        in the previous message?
        Just answer yes or no.
      `, false)

      if (!/yes/i.test(answer)) return
      if (Math.random() > .1) return

      const userName = getUserReference(ctx.from)
      const supportOfferMessage = oneLine`
        Let ${userName} know that you would be happy to support her.
        Maybe tell them that close to 50 people have tried you already
        and found you very helpful. Youd'd really just like to help.
        But try to sound natural, genuinely caring,
        and not too much like you're promoting yourself.
      `

      ctx.chatSession.messages = copy
      ctx.chatSession.addMessage({
        content: supportOfferMessage,
        name: SYSTEM_NAME,
      })

      const message = await getAssistantResponse(ctx, false)
      ctx.chatSession.addMessage({
        content: message,
        name: ctx.botInfo.first_name,
      })

      return await ctx.reply(
        message,
        { reply_to_message_id: ctx.message.message_id }
      )
    }
  }

  if (!wasMentioned) {
    if (reply?.from?.id !== me.id) return
  }

  if (!ctx.userSession.canConverse)
    return await ctx.reply(oneLine`
      I'm sorry, but you've run out of credits.
      Please talk to me privately, so that you can buy some credits from me.
      Or so that I can put you on the waiting list for a piggy bank.
    `)

  if (!ctx.chatSession.storeMessages && reply) {
    let text = "text" in reply ? reply.text : ""

    if ("voice" in reply) {
      const { file_id } = reply.voice
      const fileLink = await ctx.telegram.getFileLink(file_id)
      text = await getTranscription(fileLink as URL)
    }

    ctx.chatSession.resetMessages()

    ctx.chatSession.addMessage({
      type: "text" in reply ? "text" : "voice",
      name: reply.from!.first_name,
      content: text,
      date: new Date(reply.date).toString(),
    })

    ctx.chatSession.addMessage(lastMessage)
  }

  return await ctx.persistentChatAction(
    "typing",
    () => getReply(ctx)
      .then(async reply => {
        if (!ctx.chatSession.storeMessages) ctx.chatSession.resetMessages()
        await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id })
      })
  )
}

const handler = async (ctx: Ctx) => {
  const chatIsPrivate = ctx.chat.type === "private"

  const { text } = ctx.message

  const lastMessage: SubMessage = {
    type: "voice" in ctx.message ? "voice" : "text",
    name: ctx.from.first_name,
    content: text,
  }

  if (ctx.chatSession.storeMessages) {
    ctx.chatSession.addMessage(lastMessage)
  }

  if (!chatIsPrivate)
    return await handleGroupChat(ctx, lastMessage)

  if (!ctx.userSession.canConverse)
    return ctx.scene.enter(WELCOME_SCENE_ID)

  if ("voice" in ctx.message) {
    // if (text.length < 3000) {
    //   await ctx.replyWithHTML(stripIndents`
    //     Here's what I heard, you can check if I heard you correctly:

    //     <i>${oneLine`${text}`}</i>

    //     (If you want me to stop sending these kinds of messages, you can turn it off in your /settings.)
    //   `)
    // }
  }

  if (lastMessage.type === "voice") {
    const reply = await getReply(ctx)
    return await ctx.persistentChatAction(
      "record_voice",
      async () => {
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

        const headers = {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_KEY
        }

        const data = {
          "text": reply,
          "model_id": "eleven_multilingual_v2",
          "voice_settings": {
            "style": 0.5,
            "stability": 0.5,
            "similarity_boost": 0.8,
            "use_speaker_boost": true,
            "optimize_streaming_latency": 0 // Set to 0 for highest quality ignoring latency
          }
        }

        await fetch(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(data)
        }).then(response => {
          // Handle the response
          if (!response.ok) {
            throw new Error("HTTP error " + response.status);
          }

          return response.blob()
        }).then(async data => {
          // Work with the data
          const buffer = await blobToBuffer(data)
          await ctx.sendAudio({ source: buffer })
        }).catch(error => {
          console.log(error)
          return ctx.reply(reply)
        })
      }
    )
  }

  return await ctx.persistentChatAction(
    "typing",
    // @ts-ignore this
    () => getReply(ctx).then(reply => ctx.reply(reply))
  )
}

bot.on("text", handler)
bot.on(message("voice"), async ctx => {
  if (ctx.chat.type !== "private") return
  if (!ctx.chatSession.storeMessages) return

  if (!ctx.userSession.canConverse) {
    return await ctx.scene.enter(WELCOME_SCENE_ID)
  }

  await ctx.reply(oneLine`
    Thanks for sharing, I'm listening.
  `)

  const { file_id, duration } = ctx.message.voice
  const fileLink = await ctx.telegram.getFileLink(file_id)
  ctx.userSession.credits.used +=
    duration * ctx.userSession.creditsPerSecond

  const text = await getTranscription(fileLink as URL)

  // @ts-expect-error trust me on this one...
  ctx.message.text = text
  return await handler(ctx as unknown as Ctx)
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: "/",
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
    }
  : undefined

console.log("Starting bot...")
bot.launch({ webhook, dropPendingUpdates: true })
  .catch(error => {
    console.error(error)
    Deno.exit(1)
  })

const setupEnd = performance.now()
console.log(`Setup took ${roundToSeconds(setupEnd - setupStart)} seconds.`)
