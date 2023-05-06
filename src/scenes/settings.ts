// deno-lint-ignore-file no-explicit-any
import type { MyContext } from "../context.ts"
import { Scenes, Markup } from "npm:telegraf@4.12.3-canary.1"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { stripIndents, oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { Modify, Union2Tuple } from "../utils.ts"
import type { ConditionalKeys, Simplify, UnionToIntersection } from "npm:type-fest@3.6.1"
import { SETTINGS_SCENE_ID, supportedCurrencies } from "../constants.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { chunk } from "npm:lodash-es@4.17.21"

type Settings = MyContext["userSession"]["settings"]

type SettingsKeys = keyof Settings

type SceneState = {
  settingsMessageId?: number
  reentering?: boolean
  waitingForInputFor?: SettingsKeys
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

type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true
type IsTuple<T> = T extends [any, ...any]
    ? true
    : T extends ReadonlyArray<any>
        ? T extends Array<any>
            ? false
            : true
        : false

type Setting<key extends SettingsKeys> = NonNullable<Settings[key]>

type SettingsMenu = {
  [key in SettingsKeys]: {
    readonly dependsOn?: SettingsKeys
    readonly subject: string
    readonly verb?: string
    readonly options: Setting<key> extends boolean
      ? "boolean"
      : IsTuple<Setting<key>> extends true
        ? Setting<key>
        : IsUnion<Setting<key>> extends true
          ? Union2Tuple<Setting<key>>
          : Setting<key> extends string
            ? "string"
            : never
    readonly required: undefined extends Settings[key] ? false : true
  }
}

const settingsMenu: Partial<SettingsMenu> = {
  audioTranscriptionService: {
    subject: "voice messages",
    verb: "able to use",
    options: ["Whisper", "Conformer-1"],
    required: false,
  },
  receiveVoiceTranscriptions: {
    dependsOn: "audioTranscriptionService",
    subject: "voice message transcriptions",
    verb: "receiving",
    options: "boolean",
    required: true,
  },
  backendAssistant: {
    subject: "backend assistant",
    options: ["ChatGPT", "Claude"],
    required: true,
  },
  donorName: {
    subject: "donor name",
    options: "string",
    required: false,
  },
  // @ts-ignore excessively deep type
  currency: {
    subject: "currency",
    // @ts-ignore excessively deep type
    options: supportedCurrencies,
    required: false,
  },
}

const settingsMenuKeys = Object.keys(settingsMenu).concat("leave") as (SettingsKeys | "leave")[] // Union2Tuple<SettingsKeys>

export const settingsScene = new Scenes.BaseScene<NewContext>(SETTINGS_SCENE_ID)

type EnumKeys = Simplify<ConditionalKeys<Settings, string | undefined>>
type EnumValues = Exclude<Pick<Settings, EnumKeys>[EnumKeys], undefined> | "undefined"

settingsScene.enter(async ctx => {
  ctx.scene.state.reentering = false
  console.log("Entering settings scene...")
  // @ts-ignore excessively deep type
  const currentSettingsList = Object.entries(settingsMenu)
    .flatMap(([key, { subject, verb, dependsOn }]) => {
      if (dependsOn) {
        if (ctx.userSession.settings[dependsOn] == null) return []
      }

      const value = ctx.userSession.settings[key as SettingsKeys]
      if (typeof value === "boolean")
        return stripIndents`

          - You <b>${value ? "are" : "are not"}</b> ${verb ?? 'using'} ${subject}.
        `
      if (value === undefined)
        return stripIndents`

        - You <b>are not</b> ${verb ?? 'using'} ${subject}.
      `
      
      return stripIndents`

        - You are using <b>${value}</b> ${verb ? `to ${verb}` : 'as'} ${subject}.
      `
    })
    .join("\n")

  const currentSettingsChoices = Object.entries(settingsMenu)
    .filter(([, { dependsOn }]) => {
      if (dependsOn) {
        if (ctx.userSession.settings[dependsOn] == null) return false
      }
      return true
    })
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

  ctx.scene.state.reentering = true

  if (newValue === "undefined") {
    // @ts-expect-error trust me...
    ctx.userSession.settings[key] = undefined
    return ctx.scene.enter(settingsScene.id, ctx.scene.state)
  }

  // @ts-expect-error trust me...
  ctx.userSession.settings[key] = newValue
  return ctx.scene.enter(settingsScene.id, ctx.scene.state)
})

settingsScene.action("go_back", ctx => {
  ctx.scene.state.reentering = true
  ctx.scene.enter(settingsScene.id, ctx.scene.state)
})

settingsScene.action(settingsMenuKeys, ctx => {
  const key = ctx.match[0] as typeof settingsMenuKeys[number]
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
    if (Array.isArray(options)) {
      console.log("options.length", options.length)

      const optionsList = options.length > 6
        ? chunk(options.map(option => Markup.button.callback(option, `set_${key}_to_${option}`)), 6)
        : options.map(option => 
          [Markup.button.callback(`Yes, I want to use ${option}`, `set_${key}_to_${option}`)]
        )

      optionsList.push([Markup.button.callback("No, send me back", "go_back")])

      console.log("optionsList", optionsList)

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
    } else {
      ctx.scene.state.waitingForInputFor = key

      return ctx.telegram.editMessageText(
        ctx.chat!.id,
        settingsMessageId!,
        undefined,
        stripIndents`
          Okay, please write what you'd like to ${verb ?? "use as"} ${subject}.
        `
      )
    }
  }

  if (typeof options === "string") {
    ctx.scene.state.waitingForInputFor = key

    return ctx.telegram.editMessageText(
      ctx.chat!.id,
      settingsMessageId!,
      undefined,
      stripIndents`
        Okay, please write what you'd like to ${verb ?? "use as"} ${subject}.
      `
    )
  }

  const optionsList = options.length > 6
    ? chunk(options.map(option => Markup.button.callback(option, `set_${key}_to_${option}`)), 6)
    : options.map(option =>
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
      Okay, so currently using ${value} ${verb ? `to ${verb}` : 'as'} ${subject}.

      Do you want to change this?
    `,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(optionsList)
    }
  )
})

settingsScene.on(message("text"), ctx => {
  const { waitingForInputFor } = ctx.scene.state

  if (!waitingForInputFor)
    return ctx.reply("Sorry, please just choose any of the buttons.")

  ;(ctx.userSession.settings[waitingForInputFor] as string) = ctx.message.text

  ctx.scene.state.reentering = true
  return ctx.scene.enter(settingsScene.id, ctx.scene.state)
})

settingsScene.leave(async ctx => {
  const state = ctx.scene.state

  if (state.settingsMessageId)
    await ctx.telegram.deleteMessage(
      ctx.chat!.id,
      state.settingsMessageId!
    ).catch(() => {})

  state.settingsMessageId = undefined

  if (state.reentering) return

  await ctx.reply(oneLine`
    Great! Your settings have been saved.
    ${ctx.chatSession.messages.length > 1
      ? "Please continue sharing if you would like to receive more empathy from me."
      : "Shall we continue talking?"
    }
  `)
})
