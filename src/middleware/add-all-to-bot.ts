// import { telegrafThrottler } from "npm:telegraf-throttler@0.6.0"
// import { migrateSessionMiddleware } from "./migration/migrate.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import { chatSessionMiddleware, userSessionMiddleware, userChatSession, type ContextWithMultiSession } from "./session/session.ts"
import { rememberWeHaveSpokenBeforeMiddleware } from "./spoken-before.ts"
import { queueMiddleware } from "./queues.ts"

export const addMiddlewaresToBot = <C extends ContextWithMultiSession = ContextWithMultiSession>(bot: Telegraf<C>) => {
  console.log("Setting up the bot middleware...")
  bot.use(
    queueMiddleware,
    // telegrafThrottler(),
    // migrateSessionMiddleware,
    
    // @ts-expect-error I know the types don't match, but it works.
    chatSessionMiddleware,
    userSessionMiddleware,
    userChatSession,
    rememberWeHaveSpokenBeforeMiddleware,
  )
  console.log("Bot middleware set up.")
}
