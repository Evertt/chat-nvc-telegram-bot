// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { Context } from "npm:telegraf@4.12.3-canary.1"
import type { Modify } from "../utils.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

const {
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
} = Deno.env.toObject()

const log = debug("telegraf:webook-proxy")

export type CtxUpdateWithMeta = Modify<Context, {
  update: Modify<Context["update"], {
    meta?: {
      sentByProxy: boolean
    }
  }>
}>

export const webhookProxyMiddleware = <C extends CtxUpdateWithMeta = CtxUpdateWithMeta>(ctx: C, next: ((ctx?: C) => Promise<any>)) => {
  const isUsingWebhook = !!DOMAIN
  const isVoiceMessage = ctx.message
    && "voice" in ctx.message
    && !("text" in ctx.message)

  if (!isUsingWebhook) return next()
  if (!isVoiceMessage) return next()
  if (!ctx.chat) return next()
  if (!ctx.message) return next()

  const { update } = ctx
  if (update.meta?.sentByProxy) {
    log(oneLine`
      Webhook update request ${update.update_id} was sent by proxy.
      So now I should have a long time to process it.
    `)
    return next()
  }

  update.meta = { sentByProxy: true }

  fetch(DOMAIN, {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": TELEGRAM_WEBBOOK_TOKEN,
    },
    body: JSON.stringify(update),
  })
    .then(resp => { if (!resp.ok) throw resp })
    .catch(error => {
      console.error("Error forwarding webhook update to proxy:", error)
      console.log("Trying to handle it locally now. This will probably be very slow...")
      delete update.meta
      return next()
    })

  log(oneLine`
    Forwarding / proxying webhook update request: ${update.update_id}.
    Returning immediately for now...
  `)
}
