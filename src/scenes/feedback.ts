import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { MyContext } from "../context.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { type Modify, getUserReference } from "../utils.ts"
import { FEEDBACK_SCENE_ID } from "../constants.ts"

const {
	DEVELOPER_CHAT_ID,
} = Deno.env.toObject()

type SceneState = {
  user?: MyContext["from"]
  messages?: string[]
}

type Session = MyContext["session"]
type SceneSessionData = Modify<Session["__scenes"], {
  state?: SceneState
}>
type NewSession = Modify<Session, {
  __scenes: SceneSessionData
}>

export type NewContext = Omit<MyContext, "scene">
  & Modify<MyContext, { session: NewSession }>
  & { scene: Scenes.SceneContextScene<NewContext, SceneSessionData> }

export const feedbackScene = new Scenes.BaseScene<NewContext>(FEEDBACK_SCENE_ID)

feedbackScene.enter(async ctx => {
  await ctx.replyWithHTML(oneLine`
    Thank you for wanting to provide feedback.
    Before we begin, I first want to ask you
    if you prefer to send you feedback anonymously or not.
    If you choose to <i>not</i> send your feedback anonymously,
    then my developer can contact you here on Telegram to ask you more questions for example.
    But of course you can always choose to stay anonymous if you want.
  `, Markup.inlineKeyboard([
    [Markup.button.callback("I prefer anonymously", "anonymously")],
    [Markup.button.callback("I'm open that the developer can reach out to me.", "including_username")],
  ]))

  ctx.telegram.setMyCommands(
    [{ command: "done", description: "Send your feedback." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )
})

feedbackScene.action(["anonymously", "including_username"], async ctx => {
  const trigger = ctx.match[0] as "anonymously" | "including_username"

  if (trigger === "including_username") {
    ctx.scene.state.user = ctx.from
  }

  const strings = {
    anonymously: "anonymously",
    including_username: "along with your username",
  } as const

  await ctx.deleteMessage()

  await ctx.replyWithHTML(oneLine`
    Okay, I will send your feedback ${strings[trigger]}.
    You can start writing your feedback now.
    You can write it in one message or multiple messages.
    When you're done, you can use the command /done to send your feedback.
    Or write a message that ends with <code>DONE</code>, that also works.
  `, Markup.keyboard([["DONE"]]).resize())
})

feedbackScene.command("done", ctx => ctx.scene.leave())

feedbackScene.on(message("text"), ctx => {
  let done = false
  let message = ctx.message.text.trim()

  if (/DONE$/g.test(message)) {
    message = message.replace(/\s*DONE$/g, "")
    done = true
  }

  if (message.length) {
    ctx.scene.state.messages = [
      ...(ctx.scene.state.messages ?? []),
      message,
    ]
  }

  if (done) ctx.scene.leave()
})

feedbackScene.leave(async ctx => {
  await ctx.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  ctx.from!.username

  const {
    user,
    messages = [],
  } = ctx.scene.state

  if (!messages.length) {
    return await ctx.reply(oneLine`
      You didn't write any feedback?
      That's okay. :-)
    `, Markup.removeKeyboard())
  }

  const { userRef, userId } = getUserReference(user)

  const message = stripIndents`
    ${userRef} sent the following feedback about ${ctx.botInfo!.first_name}:
    
    <i>${messages.join("\n\n")}</i>

    ${userId ? `User ID: <code>${userId}</code>` : ""}
  `

  await ctx.telegram.sendMessage(
    DEVELOPER_CHAT_ID,
    message,
    { parse_mode: "HTML" }
  )

  await ctx.reply(oneLine`
    Thank you, your feedback has been sent.
  `, Markup.removeKeyboard())
})
