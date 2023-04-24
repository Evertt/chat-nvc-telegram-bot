import { parentThread } from "https://deno.land/x/grammy_runner@v2.0.3/platform.deno.ts"
import { Telegraf, type Context } from "npm:telegraf@4.12.3-canary.1"
import { Queue } from "https://deno.land/x/queue@1.2.0/mod.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"

const log = debug("telegraf:worker")

type Update = Context["update"]
type UserFromGetMe = Context["botInfo"]

/**
* A `BotWorker` instance is a like a `Bot` instance in the sense that it can
* process updates. It is different from `Bot` because it cannot pull in these
* updates, so it cannot be be started or stopped. Instead, it has to receive
* these updates from a central Bot instance that fetches updates.
*
* Create an instance of this class in a separate file.
*
* ```ts
* // worker.ts
* const bot = new BotWorker("") // <-- pass your bot token here (again)
*
* bot.on("message", (ctx) => ctx.reply("yay!"))
* ```
*
* This is the place where you should define all your bot logic. Install
* plugins, add handlers, process messages and other updates. Basically, instead
* of creating a bot, you only create a bot worker.
*
* Next, you can define a very minimal central bot instance to pull in updates.
* You can use this central instance to sequentialize your updates. However, it
* generally makes sense to put as little logic as possible in it.
*
* Install the `distribute` middleware exported from grammY runner to send the
* updates to your bot workers.
*
* Note that any plugins you install in the central bot instance will not be
* available inside the bot worker. In fact, you can even use different context
* types in the central bot instance and in your bot workers.
*/
export class TelegrafWorker<C extends Context = Context> extends Telegraf<C> {
  queue = new Queue()
  processing = 0
  timer: number | undefined

  constructor(token: string, options?: Partial<Telegraf.Options<C>>) {
      super(token, options)
      const noop = () => {}
      this.launch = (() => {
        log("Cannot launch a bot worker!")
      }) as any

      const p = parentThread<"stop", Update, UserFromGetMe>()
      p.seed.then((me) => {
        this.botInfo = me
      })
      p.onMessage(update => {
        log("received update!!")
        if (this.timer) {
          log("clearing timer")
          clearTimeout(this.timer)
          this.timer = undefined
        }

        this.processing++
        this.queue.push(this.handleUpdate.bind(this), update)
          .finally(() => {
            this.processing--
            if (this.processing === 0) {
              log("setting timer")
              this.timer = setTimeout(() => {
                log(`timer expired, am I gonna stop? ${this.processing === 0 ? "YES" : "NO"}`)
                if (this.processing === 0) {
                  p.postMessage("stop")
                  Deno.exit()
                }
              }, 1000 * 5)
            }
          })
      })
      this.stop = () => {
        throw new Error("Cannot stop a bot worker!")
      }
  }
}
