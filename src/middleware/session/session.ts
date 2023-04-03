// deno-lint-ignore-file no-explicit-any
import "npm:redis@4.6.5"
// @deno-types="npm:@types/pg@8.6.6"
// import pg from "npm:pg@8.10.0"
import "npm:kysely@0.24.2"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Scenes } from "npm:telegraf@4.12.3-canary.1"
// import type { Update } from "npm:telegraf@4.12.3-canary.1/types"
import { connect } from "https://deno.land/x/redis@v0.29.2/mod.ts"
import { session } from "./session_base.ts"
import { type Context } from "npm:telegraf@4.12.3-canary.1"
// import { type SessionStore } from "npm:@telegraf/session@2.0.0-beta.6/types.d.ts"
// import { Postgres } from "npm:@telegraf/session@2.0.0-beta.6/pg"
import { Redis } from "npm:@telegraf/session@2.0.0-beta.6/redis"
import type { LatestSession } from "./versions/all.ts"
// import { newLatestSession as defaultSession } from "./versions/all.ts"
export { sessionVersions } from "./versions/all.ts"
// import type { Simplify } from "npm:type-fest@3.6.1"
import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"

const jobs = new Map<number, Promise<unknown>>()

const queue = new Queue()
const originalPush = queue.push.bind(queue)

const newPush = <C extends Context>(fn: (ctx: C) => Promise<void>, ctx: C) => {
  const promise = originalPush(fn, ctx)
  jobs.set(ctx.update.update_id, promise)
  promise.finally(() => {
    jobs.delete(ctx.update.update_id)
  })
}

queue.push = newPush as any

export { queue }

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

// export const chatSessionMiddleware = session<ChatSession, Context, "chatSession">({
//   store: store as any,
//   defaultSession: ctx => ({
//     messages: [],
//     storeMessages: ctx.chat?.type === "private",
//     language_code: ctx.chat?.type !== "private" ? "en" : ctx.from?.language_code ?? "en",
//   }),
//   getSessionKey: ctx => Promise.resolve(
//     (ctx.chat?.type === "private" && ctx.from?.is_bot) ||
//       ctx.chat?.type === "channel" ? undefined : ctx.chat?.id.toString()
//   ),
// })

// console.log("Instantiating postgres stores...")

// const chatStore = Postgres<ChatSession>({
//   pool,
//   table: "chat_sessions",
//   onInitError: err => console.log("Error connecting to postgress db:", err),
// })

// const userStore = Postgres<UserSession>({
//   pool,
//   table: "user_sessions",
//   onInitError: err => console.log("Error connecting to postgress db:", err),
// })

// console.log("Instantiating Redis store...")
// const store = Redis<Session>({
// 	client: redis as any,
// 	prefix: REDIS_PREFIX
// })

// interface SessionOptions<S extends object[], C extends Context = Context> {
//   [key: string]: {
//     getSessionKey: (ctx: C) => Promise<string | undefined>
//     store: SessionStore<S[number]>
//     defaultSession: (ctx: C) => S[number]
//   }
// }

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
  closeSessionPromise: ctx => {
    console.log("Job is running", jobs.has(ctx.update.update_id))
    return jobs.get(ctx.update.update_id) ?? Promise.resolve()
  },
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
  closeSessionPromise: ctx => jobs.get(ctx.update.update_id) ?? Promise.resolve(),
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
  closeSessionPromise: ctx => jobs.get(ctx.update.update_id) ?? Promise.resolve(),
})

// type SessionMiddleware<S extends object> = ReturnType<typeof session<S>>

// export function sessions<SO extends SessionOptions<object[]>>(sessionOptions: SO) {
//   type SCtx = Context & { [K in keyof SO]: Session<SO[K]["defaultSession"]> }

//   const middlewares = Object.entries(sessionOptions).map(([key, options]) => {
//     const newSession = session(options)

//     const middleware: MiddlewareFn<Context> = (ctx, next) => {
//       const { update, chat, from } = ctx
//       const subCtx = { update, chat, from } as Context & { session: ReturnType<typeof options.defaultSession> }

//       const subMiddleware: MiddlewareFn<Context> = (ctx, next) => {
//         return newSession(ctx, next)
//       }

//       return subMiddleware(subCtx, async () => {
//         Object.defineProperty(ctx, key, {
//           get() {
//             return subCtx.session
//           },
//           set(value: object) {
//             subCtx.session = value
//           },
//         })

//         await next()
//       })
//     }

//     return middleware
//   })

//   return middlewares as MiddlewareFn<SCtx>[]
// }

// export const sessionMiddleware = sessions({
//   chatSession: {
//     store: chatStore,
//     defaultSession: ctx => ({
//       messages: [],
//       storeMessages: ctx.chat?.type === "private",
//       language_code: ctx.chat?.type !== "private" ? "en" : ctx.from?.language_code ?? "en",
//     }),
//     getSessionKey: ctx => Promise.resolve(
//       (ctx.chat?.type === "private" && ctx.from?.is_bot) ||
//         ctx.chat?.type === "channel" ? undefined : ctx.chat?.id.toString()
//     ),
//   },
//   userSession: {
//     store: userStore,
//     defaultSession: (): UserSession => ({
//       haveSpokenBefore: false,
//       settings: {
//         receiveVoiceTranscriptions: true,
//         askForDonation: true,
//       }
//     }),
//     getSessionKey: ctx => Promise.resolve(
//       ctx.from?.is_bot || ctx.chat?.type === "channel"
//         ? undefined : ctx.from?.id.toString()
//     ),
//   },
// })

export { type LatestSession as Session }
