import { Telegraf } from "npm:telegraf@4.12.2"
import { telegrafThrottler } from "npm:telegraf-throttler@0.6.0"
import { sessionMiddleware, type ContextWithSession } from "./session/session.ts"
import { migrateSessionMiddleware } from "./migration/migrate.ts"
import { rememberWeHaveSpokenBeforeMiddleware } from "./spoken-before.ts"

export const addMiddlewaresToBot = <C extends ContextWithSession = ContextWithSession>(bot: Telegraf<C>) => {
  console.log("Setting up the bot middleware...")
  bot.use(
    telegrafThrottler(),
    sessionMiddleware,
    migrateSessionMiddleware,
    rememberWeHaveSpokenBeforeMiddleware,
  )
  console.log("Bot middleware set up.")
}
