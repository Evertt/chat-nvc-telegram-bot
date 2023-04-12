// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Scenes } from "npm:telegraf@4.12.3-canary.1"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.20.0"
import { type Context, session } from "npm:telegraf@4.12.3-canary.1"
import type { LatestSession } from "../deprecated/session/versions/all.ts"
export { sessionVersions } from "../deprecated/session/versions/all.ts"
import type { MyContext } from "../../bot.ts"

const {
  SUPABASE_URL,
  SUPABASE_KEY,
} = Deno.env.toObject()

type Message = LatestSession["messages"][number]

export interface ChatSession {
  messages: Message[]
  storeMessages: boolean
  language_code: string
  type: "private" | "group"
}

export interface UserSettings {
  receiveVoiceTranscriptions: boolean
  askForDonation: boolean
}

export interface UserSession {
  haveSpokenBefore: boolean
  settings: UserSettings
  totalTokensUsed: number
  totalTokensPaidFor: number
  totalTokensGifted: number
}

export interface UserChatSession {
  __scenes: Scenes.SceneSessionData
}

export type SceneSessionData = UserChatSession["__scenes"]

export type AllMySessions = {
  chatSession: ChatSession,
  userSession: UserSession,
  session: UserChatSession,
}

export type ContextWithMultiSession<C extends Context = Context> = C & AllMySessions

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
)

// deno-lint-ignore ban-types
interface AsyncSessionStore<T = object> {
  get: (key: string) => Promise<T | undefined>;
  set: (key: string, session: T) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
}

export const supabaseStore: AsyncSessionStore<any> = {
  async get(id) {
    const { data, error } = await supabase
      .from("sessions")
      .select("session")
      .eq("id", id)
      .maybeSingle()

    if (error) {
      console.error(error)
      throw error
    }

    return data?.session
  },

  async set(id, session) {
    const { error } = await supabase
      .from("sessions")
      .upsert({ id, session })

    if (error) {
      console.error(error)
      throw error
    }
  },

  async delete(key) {
    const { error } = await supabase
      .from("sessions")
      .delete()
      .eq("id", key)

    if (error) {
      console.error(error)
      throw error
    }
  },
}

export const chatSessionMiddleware = session<ChatSession, MyContext, "chatSession">({
  store: supabaseStore,
  defaultSession: ctx => ({
    messages: [],
    storeMessages: ctx.chat?.type === "private",
    language_code: ctx.chat?.type !== "private" ? "en" : ctx.from?.language_code ?? "en",
    type: ctx.chat?.type === "private" ? "private" : "group",
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.chat ? `chat:${ctx.chat.id}` : undefined
  ),
  property: "chatSession",
})

export const userSessionMiddleware = session<UserSession, MyContext, "userSession">({
  store: supabaseStore,
  defaultSession: () => ({
    haveSpokenBefore: false,
    settings: {
      receiveVoiceTranscriptions: true,
      askForDonation: true,
    },
    totalTokensUsed: 0,
    totalTokensPaidFor: 0,
    totalTokensGifted: 200_000,
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.from ? `user:${ctx.from.id}` : undefined
  ),
  property: "userSession",
})

export const userChatSession = session<UserChatSession, MyContext, "session">({
  store: supabaseStore,
  defaultSession: () => ({
    __scenes: {},
  }),
  getSessionKey: ctx => Promise.resolve(
    ctx.chat && ctx.from ? `chat:${ctx.chat.id};user:${ctx.from.id}` : undefined
  ),
  property: "session",
})

export { type LatestSession as Session }
