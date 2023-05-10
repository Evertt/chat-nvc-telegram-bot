// deno-lint-ignore-file ban-types
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { MyContext } from "./context.ts"
import { Telegraf } from "npm:telegraf@4.12.3-canary.1"
import { fetchTranscript } from "./utils.ts"
import { roundToSeconds } from "./fns.ts"
import { supabaseStore } from "./middleware/session/session.ts"

type WebHook = NonNullable<NonNullable<Telegraf.LaunchOptions["webhook"]>["cb"]>

declare const bot: Telegraf<MyContext>

// @ts-ignore blabla
type Ctx = Parameters<Extract<Parameters<typeof bot.on<"text">>[1], Function>>[0]

const { DOMAIN = "" } = Deno.env.toObject()

export const assemblAIWebhook: (bot: Telegraf<MyContext>) => WebHook = bot => async (req, res) => {
  const url = new URL(req.url!, DOMAIN)
  const updateId = parseInt(url.searchParams.get("update_id")!)

  const pausedUpdate: undefined | [
    transcriptionStart: number,
    update: Ctx["update"]
  ] = await supabaseStore.get(`paused-update:${updateId}`)

  console.log(`paused-update:${updateId}`, pausedUpdate)

  const [transcriptionStart, ctxUpdate] = pausedUpdate ?? []

  if (!ctxUpdate || !transcriptionStart) {
    console.error("No context found in cache for update", { updateId, ctxUpdate, transcriptionStart })
    await supabaseStore.delete(`paused-update:${updateId}`)
    return
  }

  try {
    let body = ''
    // parse each buffer to string and append to body
    for await (const chunk of req) body += String(chunk)

    console.log("assemblyai webhook body", body)

    // parse body to object
    const update = JSON.parse(body) as {
      status: "completed"
      transcript_id: string
    } | {
      status: "error"
      error: string
    }

    if (update.status === "error") {
      throw ["transcript status error", update.error]
    }

    const text = await fetchTranscript(update.transcript_id)

    if (!text) {
      throw ["No text found for transcript status update", updateId]
    } else {
      console.log("Transcript:", text)
    }

    const transcriptionEnd = performance.now()
    const transcriptionTime = `${roundToSeconds(transcriptionEnd - transcriptionStart)} seconds`
    // await bot.telegram.sendMessage(ctx.update.message.chat.id, oneLine`
    // 	All in all, it took ${transcriptionTime} to transcribe your voice message.
    // 	One thing to note though, is that the service has a start-up time of about 15 to 25 seconds,
    // 	regardless of the duration of the voice message.
    // 	But after that, it can transcribe voice messages around 3 to 6 times faster
    // 	than the duration of the message. So longer voice messages will "feel" faster to transcribe.
    // 	Maybe it's good to know that the voice message must be longer than 160 ms and shorter than 10 hours.
    // `)
    console.log(`Transcribed voice file in ${transcriptionTime}`)
    ctxUpdate.message.text = text
  } catch (error) {
    console.error("error", error)
    bot.telegram.sendMessage(ctxUpdate.message.chat.id, "There was an error transcribing your voice message.")
  } finally {
    await supabaseStore.delete(`paused-update:${updateId}`)
    res.statusCode = 200
    res.end()
  }

  bot.handleUpdate(ctxUpdate)
    .then(() => console.log("responded to voice message"))
    .catch(error => console.error("error responding to voice message", error))
}
