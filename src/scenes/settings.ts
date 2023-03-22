import { type MyContext } from "../bot.ts"
import { Telegraf, Scenes, Markup } from "npm:telegraf@4.12.2"
// @deno-types="npm:@types/common-tags@1.8.1"
import { stripIndents, oneLine } from "npm:common-tags@1.8.1"

export const SETTINGS_SCENE = "SETTINGS"
export const settingsScene = new Scenes.BaseScene<MyContext>(SETTINGS_SCENE)

type SettingsKeys = keyof MyContext["session"]["settings"]

type SettingsMenu = {
  [key in SettingsKeys]: {
    subject: string
    verb: string
    type: "boolean" | "string"
  }
}

const settingsMenu = {
  receiveVoiceTranscriptions: {
    subject: "transcriptions of my voice messages",
    verb: "receive",
    type: "boolean",
  },
} as SettingsMenu

settingsScene.enter(async ctx => {
  console.log("Entering settings scene...")
  const currentSettingsList = Object.entries(settingsMenu)
    .filter(([key]) => typeof ctx.session.settings[key as SettingsKeys] === "boolean")
    .map(([key, { subject, verb }]) => stripIndents`
      - I <b>${ctx.session.settings[key as SettingsKeys] ? "do" : "do not"}</b> want to ${verb} ${subject}.
    `)
    .join("\n")

  const currentSettingsChoices = Object.entries(settingsMenu)
    .map(([key, { subject, verb }]) =>
      [Markup.button.callback(oneLine`
        I ${ctx.session.settings[key as SettingsKeys] ? "DO NOT" : "DO"}
        want to ${verb} ${subject}.
      `, key)]
    )
  
  currentSettingsChoices.push([Markup.button.callback("Leave settings menu", "leave")])

  console.log("currentSettingsChoices", currentSettingsChoices)

  ctx.scene.session.settingsMessageId ??= await ctx
    .reply("Loading settings...")
    .then(msg => msg.message_id)

  ctx.telegram.editMessageText(
    ctx.chat!.id,
    ctx.scene.session.settingsMessageId,
    undefined,
    stripIndents`
      Welcome to the settings menu.
      These are the current settings:

      ${currentSettingsList}

      Which setting would you like to change?
    `,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(currentSettingsChoices)
    }
  )

  // await ctx.reply(stripIndents`
  //   Welcome to the settings menu.
  //   These are the current settings:

  //   ${currentSettingsList}

  //   Which setting would you like to change?
  // `, Markup.inlineKeyboard(currentSettingsChoices))
})

settingsScene.action(/.+/, async ctx => {
  const key = ctx.match[0] as SettingsKeys | "leave"
  if (key === "leave") return ctx.scene.leave()

  if (!settingsMenu[key]) throw new Error(`Unknown setting key: ${key}`)

  ctx.session.settings[key] = !ctx.session.settings[key]

  const current = ctx.scene.current!
  const handler =
      'enterMiddleware' in current &&
      typeof current.enterMiddleware === 'function'
        ? current.enterMiddleware()
        : current.middleware()
  
  const noop = () => Promise.resolve()

  return await handler(ctx, noop)
})

settingsScene.leave(async ctx => {
  await ctx.telegram.deleteMessage(
    ctx.chat!.id,
    ctx.scene.session.settingsMessageId!
  )

  ctx.scene.session.settingsMessageId = undefined

  await ctx.reply(oneLine`
    Great! Your settings have been saved.
    ${ctx.session.messages.length > 1
      ? "Please continue sharing if you would like to receive more empathy from me."
      : "Would you like to receive empathy for anything?"
    }
  `)
})

export const addSettingsToBot = <C extends MyContext = MyContext>(bot: Telegraf<C>) => {
  console.log("Setting up bot scenes...")
  const stage = new Scenes.Stage<MyContext>([settingsScene], {
    ttl: 100000,
  })
  
  bot.use(stage.middleware())
  console.log("Bot scenes set up.")
  
  bot.command("settings", ctx => ctx.scene.enter(SETTINGS_SCENE))
}
