import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
// import { telegrafThrottler } from "npm:telegraf-throttler@0.6.0"
import { chatSessionMiddleware, userSessionMiddleware, userChatSession, type ContextWithMultiSession } from "./session/session.ts"
// import { migrateSessionMiddleware } from "./migration/migrate.ts"
import { rememberWeHaveSpokenBeforeMiddleware } from "./spoken-before.ts"

export const addMiddlewaresToBot = <C extends ContextWithMultiSession = ContextWithMultiSession>(bot: Telegraf<C>) => {
  console.log("Setting up the bot middleware...")
  bot.use(
    // telegrafThrottler(),
    // migrateSessionMiddleware,
    chatSessionMiddleware,
    userSessionMiddleware,
    userChatSession,
    rememberWeHaveSpokenBeforeMiddleware,
  )
  console.log("Bot middleware set up.")
}
