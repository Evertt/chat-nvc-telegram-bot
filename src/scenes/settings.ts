import type { MyContext } from "../bot.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { stripIndents, oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

export const SETTINGS_SCENE = "SETTINGS"
export const settingsScene = new Scenes.BaseScene<MyContext>(SETTINGS_SCENE)

type SettingsKeys = keyof MyContext["userSession"]["settings"]

type SettingsMenuState = {
  settingsMessageId?: number
}

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
  notifyOnShutdownDuringTesting: {
    subject: "notifications when the bot is shut down during testing",
    verb: "receive",
    type: "boolean",
  }
} as SettingsMenu

settingsScene.enter(async ctx => {
  console.log("Entering settings scene...")
  const currentSettingsList = Object.entries(settingsMenu)
    .filter(([key]) => typeof ctx.userSession.settings[key as SettingsKeys] === "boolean")
    .map(([key, { subject, verb }]) => stripIndents`
      - I <b>${ctx.userSession.settings[key as SettingsKeys] ? "do" : "do not"}</b> want to ${verb} ${subject}.
    `)
    .join("\n")

  const currentSettingsChoices = Object.entries(settingsMenu)
    .map(([key, { subject, verb }]) =>
      [Markup.button.callback(oneLine`
        I ${ctx.userSession.settings[key as SettingsKeys] ? "DO NOT" : "DO"}
        want to ${verb} ${subject}.
      `, key)]
    )
  
  currentSettingsChoices.push([Markup.button.callback("Leave settings menu", "leave")])

  console.log("currentSettingsChoices", currentSettingsChoices)

  const state = ctx.scene.state as SettingsMenuState

  const settingsMessageId = state.settingsMessageId ??= await ctx
    .reply("Loading settings...")
    .then(msg => msg.message_id)

  ctx.telegram.editMessageText(
    ctx.chat!.id,
    settingsMessageId,
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

  ctx.userSession.settings[key] = !ctx.userSession.settings[key]

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
  const state = ctx.scene.state as SettingsMenuState

  await ctx.telegram.deleteMessage(
    ctx.chat!.id,
    state.settingsMessageId!
  )

  state.settingsMessageId = undefined

  await ctx.reply(oneLine`
    Great! Your settings have been saved.
    ${ctx.chatSession.messages.length > 1
      ? "Please continue sharing if you would like to receive more empathy from me."
      : "Would you like to receive empathy for anything?"
    }
  `)
})
