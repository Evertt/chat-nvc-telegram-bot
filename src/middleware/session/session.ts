// deno-lint-ignore-file no-explicit-any
import "npm:redis@4.6.5"
// @deno-types="npm:@types/pg@8.6.6"
// import pg from "npm:pg@8.10.0"
import "npm:kysely@0.24.2"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Scenes } from "npm:telegraf@4.12.3-canary.1"
import { connect } from "https://deno.land/x/redis@v0.29.2/mod.ts"
import { type Context, session } from "npm:telegraf@4.12.3-canary.1"
// import { type SessionStore } from "npm:@telegraf/session@2.0.0-beta.6/types.d.ts"
// import { Postgres } from "npm:@telegraf/session@2.0.0-beta.6/pg"
import { Redis } from "npm:@telegraf/session@2.0.0-beta.6/redis"
import type { LatestSession } from "./versions/all.ts"
// import { newLatestSession as defaultSession } from "./versions/all.ts"
export { sessionVersions } from "./versions/all.ts"

const {
  REDIS_USERNAME,
  REDIS_PASSWORD,
	REDIS_PREFIX = "telegraf:",
  // SUPERBASE_CONNECTION_STRING,
} = Deno.env.toObject()

// const pool = new pg.Pool({
//   connectionString: SUPERBASE_CONNECTION_STRING,
// })

type Message = LatestSession["messages"][number]

export interface ChatSession {
  messages: Message[]
  storeMessages: boolean
  language_code: string
  
}

export interface UserSettings {
  receiveVoiceTranscriptions: boolean
  askForDonation: boolean
}

export interface UserSession {
  haveSpokenBefore: boolean
  settings: UserSettings
}

export type MySceneSessionData = Scenes.SceneSessionData & {
  settingsMessageId?: number
}

export interface UserChatSession {
  __scenes: MySceneSessionData
}

export type SceneSessionData = UserChatSession["__scenes"]

export type AllMySessions = {
  chatSession: ChatSession,
  userSession: UserSession,
  session: UserChatSession,
}

export type ContextWithMultiSession = Context & AllMySessions

const redis = await connect({
  hostname: "redis-13943.c251.east-us-mz.azure.cloud.redislabs.com",
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
  port: 13943,
})

console.log("Instantiating Redis store...")
const store = Redis<any>({
	client: redis as any,
	prefix: REDIS_PREFIX
})

export const chatSessionMiddleware = session<ChatSession, Context, "chatSession">({
  store: store as any,
  defaultSession: ctx => ({
    messages: [],
    storeMessages: ctx.chat?.type === "private",
    language_code: ctx.chat?.type !== "private" ? "en" : ctx.from?.language_code ?? "en",
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.chat ? `chat:${ctx.chat.id}` : undefined
  ),
  property: "chatSession",
})

export const userSessionMiddleware = session<UserSession, Context, "userSession">({
  store: store as any,
  defaultSession: () => ({
    haveSpokenBefore: false,
    settings: {
      receiveVoiceTranscriptions: true,
      askForDonation: true,
    },
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.from ? `user:${ctx.from.id}` : undefined
  ),
  property: "userSession",
})

export const userChatSession = session<UserChatSession, Context, "session">({
  store: store as any,
  defaultSession: () => ({
    __scenes: {},
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.chat && ctx.from ? `chat:${ctx.chat.id};user:${ctx.from.id}` : undefined
  ),
  property: "session",
})

export { type LatestSession as Session }
