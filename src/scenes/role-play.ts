import type { MyContext } from "../context.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { askAssistant, type Modify } from "../utils.ts"
import { ROLE_PLAY_SCENE_ID } from "../constants.ts"

type Session = MyContext["session"]
type NewSession = Modify<Session, {
  __scenes: Modify<Session["__scenes"], {
    state?: {
      other?: Other
      role_play_kind?: "practice_nvc" | "feel_heard" | "see_example"
    }
  }>
}>

type SceneSessionData = NewSession["__scenes"]

export type NewContext = Omit<MyContext, "scene"> & Modify<MyContext, {
  session: NewSession
}> & {
  scene: Scenes.SceneContextScene<NewContext, SceneSessionData>
}

export const rolePlayScene = new Scenes.BaseScene<NewContext>(ROLE_PLAY_SCENE_ID)

type ByName = {
  type: "name"
  value: string
}

type ByRelation = {
  type: "relation"
  value: string
}

type ByBoth = {
  type: "both"
  value: string
}

type Unknown = {
  type: "unknown"
  value: "nobody"
}

type Other = ByName | ByRelation | ByBoth | Unknown

type Referrals = {
  [key in Other["type"]]: (value: string, direction?: "your" | "my" | "their") => string
}

const referrals: Referrals = {
  name: name => name,
  relation: (relation, direction = "your") =>
    relation.includes("they're") ? {
      my: `the ${relation.replace("they're", "I'm")}`,
      your: `the ${relation.replace("they're", "you're")}`,
      their: `the ${relation}`,
    }[direction] : `${direction} ${relation}`,
  both(both, direction = "your") {
    return this.relation(both, direction)
  },
  unknown: () => "?",
}

rolePlayScene.enter(async ctx => {
  const name = ctx.from!.first_name

  const answerJson = await askAssistant(ctx, oneLine`
    Please tell me who ${name} has mainly been talking about in this conversation.
    Preferably by relation, but otherwise by name. Of course it might also be that
    ${name} hasn't yet mentioned any other person yet.
    In any case, I want you to give me the answer in json format.
    In the case that ${name} referred to the other by a relation,
    like if ${name} said "my colleague", then respond: {"type":"relation","value":"colleague"}.
    Or other examples might be "my mother" results in {"type":"relation","value":"mother"}.
    Or "a guy I'm dating" results in {"type":"relation","value":"guy they're dating"}.
    In the case ${name} has referred to the other person by a name, but not their relation,
    like "John", respond: {"type":"name","value":"John"}.
    It's also possible that they've referred to the other person both by name and their relation,
    so like "my friend, her name is Jane" would result in {"type":"both","value":"friend, Jane"},
    or "some girl I'm dating, called Sarah" would result in {"type":"both","value":"girl they're dating, Sarah"}.
    Finally, in the case that ${name} hasn't yet talked about another person,
    respond: {"type":"unknown","value":"nobody"}.
    In any case, respond with just the json and nothing else.
  `)

  const other = JSON.parse(answerJson) as Other

  ctx.scene.state.other = other

  const yourReferral = referrals[other.type](other.value, "your")
  const myReferral = referrals[other.type](other.value, "my")

  const user_id = ctx.from!.id
  const message = "Can we do a role-play?"
  ctx.chatSession.addMessage({ user_id, message })

  const reply = myReferral === "?"
    ? oneLine`
      Okay, let's role-play. Who do you want me to play?
      And do you want me to play <i>with</i> NVC skills?
      Or do you want me to play <i>without</i> NVC skills,
      so more like how normal people talk?
    `
    : stripIndents`
      Okay, so I can imagine three different kinds of role-play that we could do.

      ${oneLine`
        <u>If you want to practice your NVC skills</u> in a conversation with ${yourReferral},
        then I can pretend to be ${yourReferral} and you can play yourself, trying your best to speak and listen in NVC.
      `}

      ${oneLine`
        <u>If you would like to have the experience of being heard by ${yourReferral}</u>,
        then I can pretend I am ${yourReferral} with my NVC skills, and you can just play yourself.
      `}

      ${oneLine`
        Or <u>if you would like to see an example of how you might be able to have a conversation with ${yourReferral}</u>,
        then I can pretend I'm you with my NVC skills, and you can play ${yourReferral} as naturally as you can.
        That last one is a bit tricky though, because that one doesn't work if you have a strong enemy image of ${yourReferral}.
      `}

      Do you know which one you would like to do?
    `

  await ctx.replyWithHTML(reply, myReferral === "?"
    ? undefined : Markup.inlineKeyboard([
      [Markup.button.callback("I want to practice NVC", "practice_nvc")],
      [Markup.button.callback("I want to feel heard", "feel_heard")],
      [Markup.button.callback("I'd like to see how you'd handle this", "see_example")],
    ]))

  ctx.chatSession.addMessage({ message: reply })

  ctx.telegram.setMyCommands(
    [{ command: "stop", description: "End the current role-play." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )
})

rolePlayScene.action("practice_nvc", async ctx => {
  const name = ctx.from!.first_name
  const other = ctx.scene.state.other!

  ctx.scene.state.role_play_kind = "practice_nvc"
  const theirReferral = referrals[other.type](other.value, "their")

  const answer = await askAssistant(ctx, oneLine`
    Okay, so ${name} wants to practice NVC in a role-play with you.
    So ${name}'ll play themself, trying to speak NVC.
    And you'll play ${theirReferral} without NVC skills,
    but as people normally talk, and also based on what ${name} has told you about ${theirReferral} so far.
    If ${name} has told you that ${theirReferral} can be a little difficult, then also be a little difficult.
    But don't overdo it, if ${name} is doing a good job at listening empathetically then allow yourself to be touched by that.
    Now tell ${name} that you're ready and that they can start. Also tell ${name} that they can end the role-play at any time by typing /stop.
  `, true)

  await ctx.deleteMessage()

  await ctx.replyWithHTML(answer)
})

rolePlayScene.action("feel_heard", async ctx => {
  const name = ctx.from!.first_name
  const other = ctx.scene.state.other!

  ctx.scene.state.role_play_kind = "feel_heard"
  const theirReferral = referrals[other.type](other.value, "their")

  const answer = await askAssistant(ctx, oneLine`
    Okay, so ${name} wants to have the experience of being heard by ${theirReferral}.
    So you'll play as if you're ${theirReferral} with NVC skills and you'll listen empathically to ${name}.
    Maybe at some point ${name} will ask you why you did what you did.
    At that point, you'll move to expression and you'll tell ${name} what feelings and needs drove you to do the thing you (${theirReferral}) did.
    After that it just becomes a two-way conversation, and you'll switch between listening and expressing as needed.
    At all times, you'll be ${theirReferral} with NVC skills.
    Now tell ${name} that you're ready and that they can start. Also tell ${name} that they can end the role-play at any time by typing /stop.
  `, true)

  await ctx.deleteMessage()

  await ctx.replyWithHTML(answer)
})

rolePlayScene.action("see_example", async ctx => {
  const name = ctx.from!.first_name
  const other = ctx.scene.state.other!

  ctx.scene.state.role_play_kind = "see_example"
  const theirReferral = referrals[other.type](other.value, "their")

  const answer = await askAssistant(ctx, oneLine`
    Okay, so ${name} wants to see an example of how they could deal with the situation they have with ${theirReferral}.
    So ${name} will play ${theirReferral} and you'll play ${name} with NVC skills.
    ${other.type === "name" ? "" : `Since you don't yet know the name of ${theirReferral}, first ask ${name} the name of ${theirReferral}.`}
    ${other.type === "name" ? "Start" : "Then start"} the role-play and ask if they have a moment to talk.
    Wait for the response, if they say yes, then you'll start expressing your feelings and needs about the situation.
    After that I assume that they will start expressing their thoughts and feelings about the situation, although probably not in NVC language.
    And then you just listen to them empathically using your NVC skills. But always remember that you're playing ${name} and they are playing ${theirReferral}.
    You can also switch between listening and expressing as needed, whatever seems the most natural in the moment.
    When you think the role-play is complete, tell them they can end the role-play by typing /stop.
    Oh, and don't write out the whole role-play in one message!
    The role-play has to go one message at a time!
    And finally, don't start your messages with "${name}:".
  `, true)

  await ctx.deleteMessage()

  await ctx.replyWithHTML(answer)
})

rolePlayScene.command("stop", ctx => ctx.scene.leave())

rolePlayScene.leave(async ctx => {
  await ctx.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

  let message = oneLine`
    Okay, end of role-play.
    How was it for you?
  `

  switch (ctx.scene.state.role_play_kind) {
    case "practice_nvc":
      message = oneLine`
        ${message}
        Would you like to receive any feedback from me?
      `
      break
    case "feel_heard":
      message = oneLine`
        ${message}
        Did you feel heard?
      `
      break
    case "see_example":
      message = oneLine`
        ${message}
        Did you feel heard?
        Was it helpful in any way to see how I handled the situation?
      `
      break
    default:
      message = oneLine`
        ${message}
        Do you have any reflections you want to share?
        Or how you're feeling right now?
      `
      break
  }

  await ctx.reply(message)

  ctx.chatSession.addMessage({ message })
})
