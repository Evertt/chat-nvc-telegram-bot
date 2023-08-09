// deno-lint-ignore-file no-explicit-any
import type { Chat, Update } from "npm:telegraf@4.12.3-canary.1/types"
import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"
import type { Modify } from "../utils.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"
import { delay } from "https://deno.land/std@0.184.0/async/delay.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import type { CtxUpdateWithMeta } from "./webhook-proxy.ts"

const log = debug("telegraf:queues")
type ChatId = Chat["id"] // number
type UpdateId = Update["update_id"] // number
type Job = Promise<unknown>

type UpdatedQueue = Modify<Queue, {
  jobs: Map<UpdateId, Job>
  push: <C extends CtxUpdateWithMeta>(fn: (ctx: C) => Promise<void>, ctx: C) => Job
}>

const queues = new Map<ChatId, UpdatedQueue>()

const makeNewChatQueue = () => {
  const queue = new Queue() as unknown as UpdatedQueue
  queue.jobs = new Map()

  const originalPush = queue.push.bind(queue)

  const newPush = <C extends CtxUpdateWithMeta>(fn: (ctx: C) => Promise<void>, ctx: C) => {
    const promise = originalPush(fn, ctx)
    log(`pushed new job: ${ctx.update.update_id}`)

    queue.jobs.set(ctx.update.update_id, promise)
    promise.finally(() => {
      log(`job finished: ${ctx.update.update_id}`)
      queue.jobs.delete(ctx.update.update_id)
    })

    return promise
  }

  queue.push = newPush

  return queue
}

export const queueMiddleware = async <C extends CtxUpdateWithMeta = CtxUpdateWithMeta>(ctx: C, next: ((ctx?: C) => Promise<any>)) => {
  if (!ctx.chat) return next()

  if (!queues.has(ctx.chat.id)) {
    queues.set(ctx.chat.id, makeNewChatQueue())
    log(`new queue created for chat: ${ctx.chat.id}`)
  }

  const chatQueue = queues.get(ctx.chat.id)!
  const job = chatQueue.push(next, ctx)

  const wasSentByProxy = !!ctx.update.meta?.sentByProxy

  if (wasSentByProxy) return await job

  const { message } = ctx

  if (!message) return // no message, no need to await anything

  const isTextMessage = "text" in message
  const isVoiceMessage = "voice" in message

  const timeoutMS = isTextMessage
    ? 5_000
    : isVoiceMessage
      ? 10_000
      : 100

  if (timeoutMS >= 1000)
    log(`waiting ${(timeoutMS / 1000).toFixed(0)} seconds`)
  
  const timeout = delay(timeoutMS).then(() => "timeout")
  const whoWon = await Promise.race([job, timeout])

  if (timeoutMS < 1000) return

  if (whoWon === "timeout") {
    log(oneLine`
      The job is taking too long,
      so I'm returning early, partly to avoid
      a webhook timeout error from Telegram,
      and partly to save on CPU time / costs.
      But it will continue in the background, just slower.
    `)
  } else {
    log("job finished")
  }
}
