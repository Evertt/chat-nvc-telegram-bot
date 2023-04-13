// import { telegrafThrottler } from "npm:telegraf-throttler@0.6.0"
import { migrateSessionMiddleware } from "./migration/migrate.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import { sessionMiddlewares, type ContextWithMultiSession } from "./session/session.ts"
import { rememberWeHaveSpokenBeforeMiddleware } from "./spoken-before.ts"
import { queueMiddleware } from "./queues.ts"

export const addMiddlewaresToBot = <C extends ContextWithMultiSession = ContextWithMultiSession>(bot: Telegraf<C>) => {
  console.log("Setting up the bot middleware...")
  bot.use(
    queueMiddleware,
    // telegrafThrottler(),
    ...sessionMiddlewares,
    migrateSessionMiddleware,
    (ctx, next: ((ctx: C) => void)) => {
      ctx.userSession.requests++
      
      return next(ctx)
    },
    rememberWeHaveSpokenBeforeMiddleware,
  )
  console.log("Bot middleware set up.")
}
