import type { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import type { ContextWithMultiSession } from "./session/session.ts"

export const addMiddlewaresToBot = async <C extends ContextWithMultiSession = ContextWithMultiSession>(bot: Telegraf<C>) => {
  console.log("Setting up the bot middleware...")

  const { migrateSessionMiddleware } = await import("./migration/migrate.ts")
  const { sessionMiddlewares } = await import("./session/session.ts")
  const { rememberWeHaveSpokenBeforeMiddleware } = await import("./spoken-before.ts")

  bot.use(
    ...sessionMiddlewares,
    migrateSessionMiddleware,
    rememberWeHaveSpokenBeforeMiddleware,
  )
  
  console.log("Bot middleware set up.")
}
