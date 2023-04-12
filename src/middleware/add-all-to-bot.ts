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
    (ctx, next) => {
      // @ts-expect-error trust me...
      delete ctx.chatSession.pausedUpdates

      const chatType = ctx.chat?.type ?? ""
      if (chatType === "private" || chatType === "group")
        ctx.chatSession.type ??= chatType

      ctx.userSession.totalTokensGifted ??= 200_000
      ctx.userSession.totalTokensPaidFor ??= 0
      ctx.userSession.totalTokensUsed ??= 0

      // Remove duplicate messages
      ctx.chatSession.messages = ctx.chatSession.messages.reduce((messages, message) => {
        const lastMessage = messages.at(-1)
        if (!lastMessage) return [message]
        if (lastMessage.message === message.message) return messages
        return [...messages, message]
      }, [] as typeof ctx.chatSession.messages)
      
      return next()
    },
    rememberWeHaveSpokenBeforeMiddleware,
  )
  console.log("Bot middleware set up.")
}
