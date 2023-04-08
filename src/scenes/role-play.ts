import { bot, type MyContext, BOT_NAME } from "../bot.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { askAssistant } from "../utils.ts";

export const ROLE_PLAY_SCENE = "ROLE_PLAY"
export const rolePlayScene = new Scenes.BaseScene<MyContext>(ROLE_PLAY_SCENE)

type ByName = {
  type: "name"
  value: string
}

type ByRelation = {
  type: "relation"
  value: string
}

type Unknown = {
  type: "unknown"
  value: "nobody"
}

type Other = ByName | ByRelation | Unknown

type Referrals = {
  [key in Other["type"]]: (value: string, direction?: "your" | "my") => string
}

const referrals: Referrals = {
  name: name => name,
  relation: (relation, direction = "your") => `${direction} ${relation}`,
  unknown: () => "?",
}

rolePlayScene.enter(async ctx => {
  const name = ctx.from!.first_name

  const answerJson = await askAssistant(ctx, oneLine`
    Please tell me who ${name} has mainly been talking about in this conversation.
    Preferably by name, but otherwise by relation. Of course it might also be that
    ${name} hasn't yet referred to a specific other person yet.
    In any case, I want you to give me the answer in json format.
    In the case that ${name} referred to the other by a relation,
    like "my colleague", respond: {"type":"relation","value":"colleague"}.
    Or other examples might be "my boss" results in {"type":"relation","value":"boss"}.
    Or "my friend" results in {"type":"relation","value":"friend"}.
    But maybe ${name} has already referred to the other person by a name,
    like "John", respond: {"type":"name","value":"John"}.
    Or another example might be that they first referred to the other by relation,
    but then added a name, so like "my friend, Jane" would result in {"type":"name","value":"Jane"}.
    Finally, in the case that ${name} hasn't yet referred to another person,
    respond: {"type":"unknown","value":"nobody"}.
    In any case, respond with just the json and nothing else.
  `)

  const other = JSON.parse(answerJson) as Other

  const yourReferral = referrals[other.type](other.value, "your")
  const myReferral = referrals[other.type](other.value, "my")

  ctx.chatSession.messages.push({
    name,
    type: "text",
    message: "Can we do a role-play?",
    date: Date(),
  })

  const reply = myReferral === "?"
    ? oneLine`
      Okay, let's role-play. Who do you want me to play?
      And do you want me to play them as if they were using NVC skills?
      Or like how they would probably act normally, without NVC skills?
    `
    : stripIndents`
      Okay, so I can imagine three different kinds of role-play that we could do.

      ${oneLine`
        If you want to practice your NVC skills in a conversation with ${yourReferral},
        then I can pretend to be ${yourReferral} and you can play yourself, trying your best to speak and listen in NVC.
      `}

      ${oneLine`
        If you would like to have the experience of being heard by ${yourReferral},
        then I can pretend I am ${yourReferral} with my NVC skills, and you can just play yourself.
      `}

      ${oneLine`
        Or if you would like to see an example of how you might be able to have a conversation with ${yourReferral},
        then I can pretend I'm you with my NVC skills, and you can play ${yourReferral} as naturally as you can.
        That last one is a bit tricky though, because that one doesn't work if you have a strong enemy image of ${yourReferral}.
      `}

      Do you know which one you would like to do?
    `
  
  await ctx.reply(reply, myReferral === "?"
    ? undefined : Markup.keyboard([
      [`I want to practice NVC, so you play ${myReferral} and I'll play myself.`],
      [`I want to feel heard, so I'll play myself and you pretend as if you're ${myReferral} with NVC skills.`],
      [`I'd like to see how you'd handle this situation, so I'll play ${myReferral} and you pretend you're me and will try to apply your NVC skills.`],
    ]).resize().oneTime())

  ctx.chatSession.messages.push({
    type: "text",
    name: BOT_NAME,
    message: reply,
    date: Date(),
  })

  bot.telegram.setMyCommands(
    [{ command: "stop_role_play", description: "End the current role-play." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )
})

rolePlayScene.command("stop_role_play", ctx => ctx.scene.leave())

rolePlayScene.leave(async ctx => {
  bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  const message = oneLine`
    Okay, end of role-play. How was it for you?
    Did you learn anything or feel heard?
  `

  await ctx.reply(message)

  ctx.chatSession.messages.push({
    type: "text",
    name: BOT_NAME,
    message,
    date: Date(),
  })
})
