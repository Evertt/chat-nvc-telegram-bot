// /// <reference lib="deno.worker" />
// import type { Context } from "npm:telegraf@4.12.3-canary.1"
// import type { Update } from "npm:telegraf@4.12.3-canary.1/types"
// import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"
// import type { Modify } from ".././utils.ts"
// import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"
// import { migrateSessionMiddleware } from "../middleware/migration/migrate.ts"
// import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
// import { sessionMiddlewares, type ContextWithMultiSession } from "../middleware/session/session.ts"
// import { rememberWeHaveSpokenBeforeMiddleware } from "../middleware/spoken-before.ts"
// // import { saveRecentChatsMiddleware } from "../middleware/say-hi-and-goodbye.ts"
// import { queueMiddleware } from "./queues.ts"

// const log = debug("telegraf:queues")
// type UpdateId = Update["update_id"] // number
// type Job = Promise<unknown>

// type UpdatedQueue = Modify<Queue, {
//   jobs: Map<UpdateId, Job>
//   push: <C extends Context>(fn: (ctx: C) => Promise<void>, ctx: C) => Job
// }>

// const makeNewChatQueue = () => {
//   const queue = new Queue() as unknown as UpdatedQueue
//   queue.jobs = new Map()

//   const originalPush = queue.push.bind(queue)

//   const newPush = <C extends Context>(fn: (ctx: C) => Promise<void>, ctx: C) => {
//     const promise = originalPush(fn, ctx)
//     log(`pushed new job: ${ctx.update.update_id}`)

//     queue.jobs.set(ctx.update.update_id, promise)
//     promise.finally(() => {
//       log(`job finished: ${ctx.update.update_id}`)
//       queue.jobs.delete(ctx.update.update_id)
//     })

//     return promise
//   }

//   queue.push = newPush

//   return queue
// }

// const queue = makeNewChatQueue()

// self.onmessage = (evt) => {
//   console.log(evt.data);
// }

// export const addMiddlewaresToBot = <C extends ContextWithMultiSession = ContextWithMultiSession>(bot: Telegraf<C>) => {
//   console.log("Setting up the bot middleware...")
//   bot.use(
//     queueMiddleware,
//     // telegrafThrottler(),
//     ...sessionMiddlewares,
//     migrateSessionMiddleware,
//     rememberWeHaveSpokenBeforeMiddleware,
//     // saveRecentChatsMiddleware,
//   )
//   console.log("Bot middleware set up.")
// }
