import "https://deno.land/std@0.179.0/dotenv/load.ts"
import "./cycle.js"

import { bot, me, MyContext, setupStart } from "./bot.ts"
import { supabaseStore } from "./middleware/session/session.ts"

import { type Telegraf } from "npm:telegraf@4.12.3-canary.1"

import { getTranscription } from "./audio-transcriber.ts"
import {
	type SubMessage,
	getAssistantResponse,
	requestTranscript,
	fetchTranscript,
	roundToSeconds,
} from "./utils.ts"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"

const {
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
} = Deno.env.toObject()

await (async () => {
	const { addMiddlewaresToBot } = await import("./middleware/add-all-to-bot.ts")
	addMiddlewaresToBot(bot)
})()

await (async () => {
	const { addScenesToBot } = await import("./scenes/add-all-to-bot.ts")
	addScenesToBot(bot)
})()

bot.start(async ctx => {
	const { welcomeScene } = await import("./scenes/welcome.ts")

	console.log("start command")

	if (ctx.chat.type !== "private")
		return ctx.reply("Please write to me in a private chat 🙏")

	await bot.telegram.deleteMyCommands(
		{ scope: { type: "chat", chat_id: ctx.chat!.id } }
	)

	if (!ctx.userSession.haveSpokenBefore || !ctx.userSession.canConverse) {
		return ctx.scene.enter(welcomeScene.id)
	}

	const greeting = oneLine`
		Okay, let's start over. How can I help you
		this time, ${ctx.from.first_name}?
	`

	console.log("Resetting session to start with greeting.")

	ctx.chatSession.resetMessages({ message: greeting })

	console.log("Sending greeting.")
	await ctx.reply(greeting, { reply_markup: { remove_keyboard: true } })
	console.log("Greeting sent.")
})

bot.help(ctx => ctx.reply(oneLine`
	I'm ChatNVC, a bot that tries to listen to you empathically.
	You can make me forget our conversation by typing /start,
  in case you want to start fresh.
	I also just want to mention that it does cost money to keep me running,
	so I'm basically able to run based on donations.
	So if you'd like to contribute, so that I can keep offering empathy to people,
	you can do so by typing /donate.
`))

bot.command("check_credits", async ctx => {
	console.log("check_credits command")

	const { credits } = ctx.userSession
	const { used, available } = credits
	const usedDollars = (used / ctx.userSession.creditsPerRetailDollar).toFixed(2)
	const availableDollars = (available / ctx.userSession.creditsPerRetailDollar).toFixed(2)

	const usedMessage = used > 0
		? oneLine`
			You have used ${used} credits so far.
			Which is about $${usedDollars}.
		`
		: "You have not used any credits yet."

	const availableMessage = available > 0
		? oneLine`
			You have ${available} credits left.
			Which is about $${availableDollars}.
		`
		: available === 0
			? "You have no credits left."
			: oneLine`
				You are ${-available} credits in the red.
				Or $${-availableDollars} in the red.
			`

	await ctx.reply(oneLine`
		${usedMessage}
		${availableMessage}
	`)
})

const getReply = (ctx: MyContext) => {
	return getAssistantResponse(ctx)
	.catch((errorResponse: string) => {
		console.error("Error assistant response:", errorResponse)
		return errorResponse
	})
}

// @ts-expect-error trust me
// deno-lint-ignore ban-types
type Ctx = Parameters<Extract<Parameters<typeof bot.on<"text">>[1], Function>>[0]

const handleGroupChat = async (ctx: Ctx, lastMessage: SubMessage) => {
	const { text } = ctx.message

	const wasMentioned = "voice" in ctx.message
		? text.includes(me.first_name) || text.includes(me.username)
		: text.includes(`@${ctx.me}`)

	const reply = ctx.message.reply_to_message

	if (ctx.chatSession.isEmpathyRequestGroup) {
		if (!wasMentioned && reply?.from?.id !== me.id) return

		return await ctx.reply(oneLine`
			Hey, I'm happy to offer empathy.
			Anyone can just message me privately
			and then I'm happy to listen.
		`, { reply_to_message_id: ctx.message.message_id })
	}

	if (!wasMentioned) {
		if (reply?.from?.id !== me.id) return
	}

	if (text.includes("/keep_track")) {
		ctx.chatSession.storeMessages = true

		return ctx.reply(oneLine`
			Okay, I'll keep track of all messages in this group from now on.
			So that I can hopefully offer better empathy when asked.
		`)
	}

	if (!ctx.userSession.canConverse)
		return await ctx.reply(oneLine`
			I'm sorry, but you've run out of credits.
			Please talk to me privately, so that you can buy some credits from me.
			Or so that I can put you on the waiting list for a piggy bank.
		`)

	if (!ctx.chatSession.storeMessages && reply) {
		let text = "text" in reply ? reply.text : ""

		if ("voice" in reply) {
			const { file_id } = reply.voice
			const fileLink = await ctx.telegram.getFileLink(file_id)
			text = await getTranscription(fileLink as URL)
		}

		ctx.chatSession.resetMessages()

		ctx.chatSession.addMessage({
			type: "text" in reply ? "text" : "voice",
			user_id: reply.from!.id,
			message: text,
			date: new Date(reply.date).toString(),
		})

		ctx.chatSession.addMessage(lastMessage)
	}

	return await ctx.persistentChatAction(
		"typing",
		() => getReply(ctx)
			.then(async reply => {
				if (!ctx.chatSession.storeMessages) ctx.chatSession.resetMessages()
				await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id })
			})
	)
}

const handler = async (ctx: Ctx) => {
	if (ctx.chat.type === "supergroup") return

	const chatIsPrivate = ctx.chat.type === "private"

	const { text } = ctx.message

	const lastMessage: SubMessage = {
		type: "voice" in ctx.message ? "voice" : "text",
		user_id: ctx.from.id,
		message: text,
	}

	if (ctx.chatSession.storeMessages) {
		ctx.chatSession.addMessage(lastMessage)
	}

	if (!chatIsPrivate)
		return await handleGroupChat(ctx, lastMessage)

	if (!ctx.userSession.canConverse) {
		const { welcomeScene } = await import("./scenes/welcome.ts")
		return ctx.scene.enter(welcomeScene.id)
	}

	return await ctx.persistentChatAction(
		"typing",
		() => getReply(ctx)
		.then(async reply => {
			await ctx.reply(reply)
		})
	)
}

bot.on("text", handler)
bot.on(message("voice"), async ctx => {
	if (ctx.chat.type !== "private") return
	if (!ctx.chatSession.storeMessages) return

	const { audioTranscriptionService } = ctx.userSession.settings

	if (audioTranscriptionService == null) {
		return await ctx.reply(stripIndents`
			${oneLine`
				By default, I no longer listen to voice messages.
				Because it turned out to be relatively quite expensive.
			`}
			
			You can turn it back on in your /settings.

			There are two options available:
			${oneLine`
				- A very slow one, called Whisper,
				that costs approximately the same as
				40 words of written text per 1 second of the audio.
			`}
			${oneLine`
				- A less slow one, called Conformer-1,
				that costs approximately the same as
				100 words of written text per 1 second of the audio.
			`}

			${oneLine`
				So as you can see, if you want to communicate with me
				via voice messages, your credits will run much more quickly.
				But if you're okay with that, then please go to /settings
				and choose whichever service you want to enable for voice messages.
		  `}
		`)
	}

	if (!ctx.userSession.canConverse) {
		const { welcomeScene } = await import("./scenes/welcome.ts")
		return await ctx.scene.enter(welcomeScene.id)
	}

	await ctx.reply(oneLine`
		Thanks for sharing, I'm listening.
	`)

	const { file_id, duration } = ctx.message.voice
	const fileLink = await ctx.telegram.getFileLink(file_id)
	ctx.userSession.credits.used +=
		duration * ctx.userSession.creditsPerSecond

	if (audioTranscriptionService === "Conformer-1") {
		const transcribeStart = performance.now()
		supabaseStore.set(`paused-update:${ctx.update.update_id}`, JSON.stringify([ transcribeStart, ctx.update ]))
		await requestTranscript(fileLink as URL, ctx.update.update_id)
		console.log("Got a voice message, waiting for transcription...")
		return
	}

	if (audioTranscriptionService === "Whisper") {
		// This function is so very slow,
		// because whisper can't process ogg files,
		// which is what telegram uses for voice messages.
		// So it first needs to convert the file to another format,
		// and that is the bottleneck in this case.
		const text = await getTranscription(fileLink as URL)

		// @ts-expect-error trust me on this one...
		ctx.message.text = text
		return await handler(ctx as unknown as Ctx)
	}
})

bot.on(message("new_chat_members"), async ctx => {
	if (ctx.chat.type === "supergroup") return

	const { new_chat_members } = ctx.message

	for (const newMember of new_chat_members) {
		ctx.chatSession.groupMembers.set(newMember.id, {
			id: newMember.id,
			username: newMember.username,
			first_name: newMember.first_name,
		})
	}

	ctx.chatSession.groupMemberCount =
		await bot.telegram.getChatMembersCount(ctx.chat.id)
})

bot.on(message("left_chat_member"), async ctx => {
	if (ctx.chat.type === "supergroup") return

	const { left_chat_member } = ctx.message

	ctx.chatSession.groupMembers.delete(left_chat_member.id)

	ctx.chatSession.groupMemberCount =
		await bot.telegram.getChatMembersCount(ctx.chat.id)
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: "/",
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
			cb: async (req, res) => {
				const url = new URL(req.url!, DOMAIN)
				const updateId = parseInt(url.searchParams.get("update_id")!)

				const pausedUpdate: undefined | [
					transcriptionStart: number,
					update: Ctx["update"]
				] = await supabaseStore.get(`paused-update:${updateId}`)

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

					await bot.handleUpdate(ctxUpdate)
				} catch (error) {
					console.error("error", error)
					bot.telegram.sendMessage(ctxUpdate.message.chat.id, "There was an error transcribing your voice message.")
				} finally {
					await supabaseStore.delete(`paused-update:${updateId}`)
					res.statusCode = 200
					res.end()
				}
			}
    }
  : undefined

console.log("Starting bot...")
bot.launch({ webhook, dropPendingUpdates: !!webhook })
	.catch(error => {
		console.error(error)
		Deno.exit(1)
	})

const setupEnd = performance.now()
console.log(`Setup took ${roundToSeconds(setupEnd - setupStart)} seconds.`)
