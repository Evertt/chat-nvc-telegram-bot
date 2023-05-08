// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.20.0"
import { type Context, session, type MiddlewareFn } from "npm:telegraf@4.12.3-canary.1"
import { latestSessions } from "./versions/all.ts"
export { sessionVersions, type SceneSessionData } from "./versions/all.ts"
// import * as devalue from "npm:devalue@4.3.0"

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_PREFIX = ""
} = Deno.env.toObject()

type LatestSessions = typeof latestSessions

export type AllMySessions = {
  [K in keyof LatestSessions]: ReturnType<LatestSessions[K]>
}

export type ContextWithMultiSession = Context & AllMySessions

export const supabase = createClient(
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
    if (!id.startsWith(SUPABASE_PREFIX))
      id = SUPABASE_PREFIX + id

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
    if (!id.startsWith(SUPABASE_PREFIX))
      id = SUPABASE_PREFIX + id

    const { error } = await supabase
      .from("sessions")
      .upsert({ id, session })

    if (error) {
      console.error(error)
      throw error
    }
  },

  async delete(id) {
    if (!id.startsWith(SUPABASE_PREFIX))
      id = SUPABASE_PREFIX + id

    const { error } = await supabase
      .from("sessions")
      .delete()
      .eq("id", id)

    if (error) {
      console.error(error)
      throw error
    }
  },
}

const sessionKeyFactories: {
  [K in keyof LatestSessions]: (ctx: ContextWithMultiSession) => Promise<string | undefined> | string | undefined
} = {
  chatSession: ctx => Promise.resolve(
    ctx.chat ? `chat:${ctx.chat.id}` : undefined
  ),
  userSession: ctx => Promise.resolve(
    ctx.from ? `user:${ctx.from.id}` : undefined
  ),
  session: ctx => Promise.resolve(
    ctx.chat && ctx.from ? `chat:${ctx.chat.id};user:${ctx.from.id}` : undefined
  ),
  statistics: () => "statistics",
}

const sessionMiddlewares: MiddlewareFn<ContextWithMultiSession>[] = []

for (const property in latestSessions) {
  const key = property as keyof LatestSessions
  sessionMiddlewares.push(session({
    property,
    store: supabaseStore,
    defaultSession: latestSessions[key],
    getSessionKey: sessionKeyFactories[key],
  }))
}

export { sessionMiddlewares }

export { type LatestSessions as Sessions }
