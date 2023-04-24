// // deno-lint-ignore-file no-explicit-any
// import type { Context } from "npm:telegraf@4.12.3-canary.1"
// import type { Chat, Update } from "npm:telegraf@4.12.3-canary.1/types"
// import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"
// import type { Modify } from "../utils.ts"
// import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"

// const log = debug("telegraf:queues")
// type ChatId = Chat["id"] // number

// const workers = new Map<ChatId, Worker>()

// const makeNewChatWorker = () => {
//   const worker = new Worker(
//     new URL("./bot.ts", import.meta.url).href,
//     { type: "module" }
//   )

//   return worker
// }

// export const queueMiddleware = <C extends Context = Context>(update: C, next: ((ctx?: C) => Promise<any>)) => {
//   if (!update.chat) return next()

//   if (!workers.has(update.chat.id)) {
//     workers.set(update.chat.id, makeNewChatWorker())
//     log(`new worker created for chat: ${update.chat.id}`)
//   }
  
//   const chatWorker = workers.get(update.chat.id)!

//   ;(() => {
//     chatWorker.postMessage(update)
//   })()

//   log("return immediately")
// }
