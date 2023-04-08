// deno-lint-ignore-file no-explicit-any
import type { Context, MiddlewareFn } from "npm:telegraf@4.12.3-canary.1"
import type { Chat, Update } from "npm:telegraf@4.12.3-canary.1/types"
import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"
import type { Modify } from "../utils.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"

const log = debug("telegraf:queues")
type ChatId = Chat["id"]
type UpdateId = Update["update_id"]
type Job = Promise<unknown>

type UpdatedQueue = Modify<Queue, {
  jobs: Map<UpdateId, Job>
  push: <C extends Context>(fn: (ctx: C) => Promise<void>, ctx: C) => Job
}>

const queues = new Map<ChatId, UpdatedQueue>()

const makeNewChatQueue = () => {
  const queue = new Queue() as unknown as UpdatedQueue
  queue.jobs = new Map()

  const originalPush = queue.push.bind(queue)

  const newPush = <C extends Context>(fn: (ctx: C) => Promise<void>, ctx: C) => {
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

export const queueMiddleware: MiddlewareFn<Context> = (ctx, next: ((ctx?: Context) => Promise<any>)) => {
  if (!ctx.chat) return next()

  if (!queues.has(ctx.chat.id)) {
    queues.set(ctx.chat.id, makeNewChatQueue())
    log(`new queue created for chat: ${ctx.chat.id}`)
  }

  const chatQueue = queues.get(ctx.chat.id)!
  chatQueue.push(next, ctx)
  log("return immediately")
}
