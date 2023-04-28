import type { MyContext } from "../bot.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { stripIndents, oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { Modify, Union2Tuple } from "../utils.ts"
import type { ConditionalKeys, Simplify } from "npm:type-fest@3.6.1"

type Settings = MyContext["userSession"]["settings"]

type SettingsKeys = keyof Settings

type SceneState = {
  settingsMessageId?: number
}

type Session = MyContext["session"]
type NewSession = Modify<Session, {
  __scenes: Modify<Session["__scenes"], {
    state?: SceneState
  }>
}>

type SceneSessionData = NewSession["__scenes"]

export type NewContext = Omit<MyContext, "scene"> & Modify<MyContext, {
  session: NewSession
}> & {
  scene: Scenes.SceneContextScene<NewContext, SceneSessionData>
}

type SettingsMenu = {
  [key in SettingsKeys]: {
    subject: string
    verb: string
    options: Exclude<Settings[key], undefined> extends boolean
      ? "boolean" : Union2Tuple<Exclude<Settings[key], undefined>>
    required: undefined extends Settings[key] ? false : true
  }
}

const settingsMenu: Partial<SettingsMenu> = {
  receiveVoiceTranscriptions: {
    subject: "voice message transcriptions",
    verb: "receive",
    options: "boolean",
    required: true,
  },
  notifyOnShutdownDuringTesting: {
    subject: "notifications when the test-bot is rebooted",
    verb: "receive",
    options: "boolean",
    required: true,
  },
  backendAssistant: {
    subject: "backend assistant",
    verb: "string",
    options: ["ChatGPT", "Claude"],
    required: true,
  },
  audioTranscriptionService: {
    subject: "voice messages",
    verb: "be able to use",
    options: ["Whisper", "Conformer-1"],
    required: false,
  }
}

export const SETTINGS_SCENE = "SETTINGS"
export const settingsScene = new Scenes.BaseScene<NewContext>(SETTINGS_SCENE)

type EnumKeys = Simplify<ConditionalKeys<Settings, string | undefined>>
type EnumValues = Exclude<Pick<Settings, EnumKeys>[EnumKeys], undefined> | "undefined"

settingsScene.enter(async ctx => {
  console.log("Entering settings scene...")
  const currentSettingsList = Object.entries(settingsMenu)
    .map(([key, { subject, verb }]) => {
      const value = ctx.userSession.settings[key as SettingsKeys]
      if (typeof value === "boolean")
        return stripIndents`

          - You <b>${value ? "will" : "will not"}</b> ${verb} ${subject}.
        `
      if (value === undefined)
        return stripIndents`

        - You <b>will not</b> ${verb} ${subject}.
      `
      
      return stripIndents`

        - You are using <b>${value}</b> to ${verb} ${subject}.
      `
    })
    .join("\n")

  const currentSettingsChoices = Object.entries(settingsMenu)
    .map(([key, { subject }]) =>
      [Markup.button.callback(subject, key)]
    )
  
  currentSettingsChoices.push([Markup.button.callback("Leave settings menu", "leave")])

  console.log("currentSettingsChoices", currentSettingsChoices)

  const state = ctx.scene.state

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
})

settingsScene.action(/^toggle_(.+)$/, ctx => {
  const key = ctx.match[1] as ConditionalKeys<Settings, boolean>
  const value = ctx.userSession.settings[key]
  ctx.userSession.settings[key] = !value
})

settingsScene.action(/^set_(.+)_to_(.+)$/, ctx => {
  const [key, newValue] = ctx.match.slice(1) as [EnumKeys, EnumValues]

  if (newValue === "undefined") {
    // @ts-expect-error trust me...
    ctx.userSession.settings[key] = undefined
    return ctx.scene.enter(settingsScene.id, ctx.scene.state, true)
  }

  // @ts-expect-error trust me...
  ctx.userSession.settings[key] = newValue
  return ctx.scene.enter(settingsScene.id, ctx.scene.state, true)
})

settingsScene.action("go_back", ctx =>
  ctx.scene.enter(settingsScene.id, ctx.scene.state, true)
)

settingsScene.action(/.+/, ctx => {
  const key = ctx.match[0] as SettingsKeys | "leave"
  if (key === "leave") return ctx.scene.leave()

  if (!settingsMenu[key]) throw new Error(`Unknown setting key: ${key}`)

  const { options, required, verb, subject } = settingsMenu[key]!
  const value = ctx.userSession.settings[key]
  const { settingsMessageId } = ctx.scene.state

  if (options === "boolean")
    return ctx.telegram.editMessageText(
      ctx.chat!.id,
      settingsMessageId!,
      undefined,
      stripIndents`
        Okay, so currently you <b>${value ? "will" : "will not"}</b> ${verb} ${subject}.

        Do you make it so that you <b>${value ? "will not" : "will"}</b> ${verb} ${subject}?
      `, Markup.inlineKeyboard([
      Markup.button.callback("Yes I do", `toggle_${key}`),
      Markup.button.callback("No, send me back", "go_back")
    ]))

  if (value === undefined) {
    const optionsList = options.map(option => 
      [Markup.button.callback(`Yes, I want to use ${option}`, `set_${key}_to_${option}`)]
    )

    optionsList.push([Markup.button.callback("No, send me back", "go_back")])

    return ctx.telegram.editMessageText(
      ctx.chat!.id,
      settingsMessageId!,
      undefined,
      stripIndents`
        Okay, so currently ${subject} are <b>disabled</b> for you.

        Do you want to enable ${subject}?
      `,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(optionsList)
      }
    )
  }

  const optionsList = options.map(option =>
    [Markup.button.callback(`Yes, I want to use ${option}`, `set_${key}_to_${option}`)]
  )

  if (!required)
    optionsList.push([Markup.button.callback(
      `No, I want to disable ${subject}`,
      `set_${key}_to_undefined`
    )])

  optionsList.push([Markup.button.callback(
    "No, send me back", "go_back"
  )])

  return ctx.telegram.editMessageText(
    ctx.chat!.id,
    settingsMessageId!,
    undefined,
    stripIndents`
      Okay, so currently using ${value} to ${verb} ${subject}.

      Do you want to change this?
    `,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(optionsList)
    }
  )
})

settingsScene.leave(async ctx => {
  const state = ctx.scene.state

  await ctx.telegram.deleteMessage(
    ctx.chat!.id,
    state.settingsMessageId!
  )

  state.settingsMessageId = undefined

  await ctx.reply(oneLine`
    Great! Your settings have been saved.
    ${ctx.chatSession.messages.length > 1
      ? "Please continue sharing if you would like to receive more empathy from me."
      : "Shall we continue talking?"
    }
  `)
})
