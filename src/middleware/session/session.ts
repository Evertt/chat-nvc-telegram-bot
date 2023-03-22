// deno-lint-ignore-file no-explicit-any
import "npm:redis@4.6.5"
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { Update } from "npm:telegraf@4.12.2/types"
import { connect } from "https://deno.land/x/redis@v0.29.2/mod.ts"
import { session, type Context } from "npm:telegraf@4.12.2"
import { Redis } from "npm:@telegraf/session@2.0.0-beta.6/redis"
import type { LatestSession as Session } from "./versions/all.ts"
import { newLatestSession as defaultSession } from "./versions/all.ts"
export { sessionVersions, type SceneSessionData } from "./versions/all.ts"

const {
  REDIS_USERNAME,
  REDIS_PASSWORD,
	REDIS_PREFIX = "telegraf:",
} = Deno.env.toObject()

export interface ContextWithSession <U extends Update = Update> extends Context<U> {
	session: Session,
}

const redis = await connect({
  hostname: "redis-13943.c251.east-us-mz.azure.cloud.redislabs.com",
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
  port: 13943,
})

console.log("Instantiating Redis store...")
const store = Redis<Session>({
	client: redis as any,
	prefix: REDIS_PREFIX
})

export const sessionMiddleware = session<Session, ContextWithSession>({ store, defaultSession })

export { type Session }
