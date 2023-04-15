import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { type MiddlewareFn } from "npm:telegraf@4.12.3-canary.1"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { Message } from "npm:telegraf@4.12.3-canary.1/types"
import { supabaseStore, type ContextWithMultiSession } from "./session/session.ts"
import { bot } from "../bot.ts"

type ChatId = number
type Timestamp = number

const recentChatIds = new Map<ChatId, Timestamp>()

const {
  DOMAIN = "",
  SUPABASE_PREFIX = "",
} = Deno.env.toObject()

const recentChatsStoreId = `${SUPABASE_PREFIX}recentChats`

export const saveRecentChatsMiddleware: MiddlewareFn<ContextWithMultiSession> =
  (ctx, next: (ctx: ContextWithMultiSession) => Promise<void>) => {
    if (DOMAIN || ctx.chat?.type !== "private") return next(ctx)
    if (!ctx.userSession.settings.notifyOnShutdownDuringTesting) {
      recentChatIds.delete(ctx.chat.id)
    }
    else {
      recentChatIds.set(ctx.chat.id, Date.now())
    }
    return next(ctx)
  }

const sayGoodyeToRecentChats = async () => {
  const now = Date.now()
  const promises: Promise<Message.TextMessage>[] = []
  const reallyRecentChatIds: Record<ChatId, Timestamp> = {}

  for (const [chatId, timestamp] of recentChatIds.entries()) {
    const diffInMinutes = (now - timestamp) / 1000 / 60
    if (diffInMinutes > 5) continue
    
    reallyRecentChatIds[chatId] = timestamp
    promises.push(bot.telegram.sendMessage(
      chatId,
      oneLine`
        Just FYI, I'm shutting down right now.
        Maybe my developer just wants to test a new feature or bugfix.
        In that case I'll be back in a few seconds or minutes.
        But maybe my developer is just done with me for today.
        In that case I don't know when I'll be back.
        But I'll let you know when I'm back.
      `
    ))
  }

  recentChatIds.clear()

  await supabaseStore.set(
    recentChatsStoreId,
    reallyRecentChatIds
  )

  await Promise.allSettled(promises)

  console.log("Said goodbyes")
}

// Enable graceful stop
Deno.addSignalListener("SIGINT", async () => {
  if (!DOMAIN) await sayGoodyeToRecentChats()
  bot.stop("SIGINT")
  Deno.exit()
})

Deno.addSignalListener("SIGTERM", async () => {
  if (!DOMAIN) await sayGoodyeToRecentChats()
  bot.stop("SIGTERM")
  Deno.exit()
})

Promise.resolve().then(async () => {
  if (DOMAIN) return
  const recentChats = await supabaseStore.get(recentChatsStoreId) as Record<ChatId, Timestamp> | undefined
  if (!recentChats) return
  const now = Date.now()

  const reallyRecentChats = Object.entries(recentChats).filter(([, timestamp]) => {
    const diffInMinutes = (now - timestamp) / 1000 / 60
    return diffInMinutes < 60
  })

  if (reallyRecentChats.length) {
    console.log("Saying hi to recent chats:", reallyRecentChats)
  }

  for (const [chatId, timestamp] of reallyRecentChats) {
    const diffInSeconds = (now - timestamp) / 1000
    const diffInMinutes = diffInSeconds / 60
    const diffPerFiveMinutes = Math.ceil(diffInMinutes / 5) * 5

    await bot.telegram.sendMessage(
      chatId,
      oneLine`
        I'm back!
        ${diffInMinutes <= 30
          ? "I was gone " + (
            diffInMinutes < 1
              ? `less than 1 minute`
              : `less than ${diffPerFiveMinutes} minutes`
          ) + "!"
          : ""
        }
      `
    )
  }

  await supabaseStore.delete(recentChatsStoreId)
})
