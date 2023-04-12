// deno-lint-ignore-file ban-types
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import "./cycle.js"

// import * as http from "node:http"
import { bot, BOT_NAME, MyContext, setupStart } from "./bot.ts"
import { addMiddlewaresToBot } from "./middleware/add-all-to-bot.ts"
import { addScenesToBot } from "./scenes/add-all-to-bot.ts"
import { supabaseStore } from "./middleware/session/session.ts"

import { type Telegraf, Markup } from "npm:telegraf@4.12.3-canary.1"

import { getTranscription } from "./audio-transcriber.ts"
import {
	type Message,
	moderate,
	getAssistantResponse,
	getMessagesFromLastCheckpoint,
	requestTranscript,
	fetchTranscript,
	roundToSeconds,
} from "./utils.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "./error-messages.ts"
import { oneLine, oneLineCommaListsAnd, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { isBotAskingForDonation } from "./donations.ts"
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const {
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
	PAYMENT_TOKEN = "",
	EMAIL_HOST,
	EMAIL_USERNAME,
	EMAIL_PASSWORD,
	EMAIL_PORT,
} = Deno.env.toObject()

addMiddlewaresToBot(bot)

addScenesToBot(bot)

const me = await bot.telegram.getMe()

bot.start(async ctx => {
	console.log("start command")

	if (ctx.chat.type !== "private")
		return ctx.reply("Please write to me in a private chat 🙏")

	await bot.telegram.deleteMyCommands(
		{ scope: { type: "chat", chat_id: ctx.chat!.id } }
	)

	const greeting = ctx.userSession.haveSpokenBefore
		? `Okay, let's start over. How can I help you this time, ${ctx.from.first_name}?`
		: stripIndents`
			Hi ${ctx.from.first_name}, I'm ChatNVC.
			I would love to listen to whatever is on your mind, according to the principles of NVC.

			I also want to let you know that on the left side of your text input,
			you can find a menu button, which will show you a list of commands you can give me.

			Finally, I'm still in alpha, which means that I probably still have lots of bugs,
			and I'm still learning how to be a really good listener.

			Okay, now that that's out of the way, how can I help you today?
		`

	console.log("Resetting session to start with greeting.")
	ctx.chatSession.messages = [
		{
			type: "text",
			name: BOT_NAME,
			message: greeting,
			date: Date(),
		}
	]

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

bot.command("donate", async ctx => {
	if (ctx.chat.type !== "private") return

	await ctx.reply(oneLine`
		Oh, you want to donate to me? Thank you, I really appreciate that!
		Choose any of the options below to donate. And really, thank you! 🙏
	`, Markup.inlineKeyboard([
		[
			Markup.button.callback("$1", "donate_1"),
			Markup.button.callback("$2", "donate_2"),
			Markup.button.callback("$4", "donate_4"),
		]
	]))
})

bot.command("email", async ctx => {
	if (ctx.chat.type !== "private") return

	const emailEntity = ctx.message.entities?.find(e => e.type === "email")

	if (!emailEntity) return ctx.reply(oneLine`
		Please write your email address after the /email command.
		So for example: /email example@gmail.com
	`)

	const email = ctx.message.text.slice(emailEntity.offset, emailEntity.offset + emailEntity.length)

	console.log("email", email)

	const messages = "<h1>Your Chat History</h1>\n<p>" + ctx.chatSession.messages.map(
		msg => `<strong>${msg.name}:</strong> ${msg.message}`
	).join("</p>\n<p>") + "</p>"

	const client = new SMTPClient({
		connection: {
			hostname: EMAIL_HOST,
			port: +EMAIL_PORT,
			tls: true,
			auth: {
				username: EMAIL_USERNAME,
				password: EMAIL_PASSWORD,
			},
		},
	})

	await client.send({
		from: `ChatNVC <${EMAIL_USERNAME}>`,
		to: `${ctx.from!.first_name} <${email}>`,
		subject: "ChatNVC - Chat History",
		content: "auto",
		html: messages,
	});
	
	await client.close()

	await ctx.reply(oneLine`
		Okay, I sent you an email with your chat history.
		Please check your inbox and / or spambox.
	`)
})

const getReply = async (ctx: MyContext) => {
	const { chatMessages } = await getMessagesFromLastCheckpoint(ctx)

	const moderationResult = await moderate(chatMessages.at(-1)!.content)
	if (moderationResult) return oneLineCommaListsAnd`
		Your message was flagged by OpenAI for ${moderationResult}.
		Please try to rephrase your message. 🙏
	`

	const assistantResponse = await getAssistantResponse(ctx, ctx.chatSession.storeMessages)
	
	// TODO: this information should already be in the assistant response
	// moderationResult = await moderate(assistantResponse)
	// if (moderationResult) return oneLine`
	// 	Sorry, I was about to say something potentially inappropriate.
	// 	I don't know what happened.
	// 	Could you maybe try to rephrase your last message differently?
	// 	That might help me to formulate a more appropriate response.
	// 	Thank you. 🙏
	// `

	return assistantResponse
}

// @ts-expect-error trust me
type Ctx = Parameters<Extract<Parameters<typeof bot.on<"text">>[1], Function>>[0]

const handler = async (ctx: Ctx) => {
	if (ctx.chat.type === "supergroup") return

	const chatIsPrivate = ctx.chat.type === "private"

	const { text } = ctx.message

	const lastMessage: Message = {
		type: "voice" in ctx.message ? "voice" : "text",
		name: ctx.from.first_name,
		message: text,
		date: Date(),
	}

	if (ctx.chatSession.storeMessages) {
		ctx.chatSession.messages.push(lastMessage)
	}

	if (!chatIsPrivate) {
		const wasMentioned = "voice" in ctx.message
			? text.includes(BOT_NAME)
			: ctx.message.text.includes(`@${ctx.me}`)

		const reply = ctx.message.reply_to_message

		if (!wasMentioned) {
			if (!reply) return // void (console.log("and there was no reply either"))
			if (reply.from?.id !== me.id) return
		}

		if (text.includes("/keep_track")) {
			ctx.chatSession.storeMessages = true

			return ctx.reply(oneLine`
				Okay, I'll keep track of all messages in this group from now on.
				So that I can hopefully offer better empathy when asked.
			`)
		}

		if (!ctx.chatSession.storeMessages && reply) {
			let text = "text" in reply ? reply.text : ""

			if ("voice" in reply) {
				const { file_id } = reply.voice
				const fileLink = await ctx.telegram.getFileLink(file_id)
				text = await getTranscription(fileLink as URL)
			}

			ctx.chatSession.messages = [lastMessage]

			ctx.chatSession.messages.unshift({
				type: "text" in reply ? "text" : "voice",
				name: reply.from!.first_name,
				message: text,
				date: new Date(reply.date).toString(),
			})
		}

		return await ctx.persistentChatAction(
			"typing",
			() => getReply(ctx)
				.then(async reply => {
					await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id })
				})
				.catch(async error => {
					console.error(error)
					await ctx.reply(OPENAI_OVERLOADED_MESSAGE)
				})
		)
	}

	return await ctx.persistentChatAction(
		"typing",
		() => getReply(ctx)
		.then(async reply => {
			const askForDonation =
				PAYMENT_TOKEN
				&& ctx.chat.type === "private"
				&& ctx.userSession.settings.askForDonation !== false
				&& isBotAskingForDonation(reply)

				await ctx.reply(
					reply,
					!askForDonation ? {} : Markup.inlineKeyboard([
						[
							Markup.button.callback("No, I don't want to donate right now.", "no_donation"),
							Markup.button.callback("No, and please don't ask me again.", "never_donation"),
						],
						[
							Markup.button.callback("$1", "donate_1"),
							Markup.button.callback("$2", "donate_2"),
							Markup.button.callback("$4", "donate_4"),
						]
					])
				)
		})
		.catch(async error => {
			console.log("Error:", error)

			await ctx.reply(
				OPENAI_OVERLOADED_MESSAGE,
			)
		})
	)
}

bot.on("text", handler)
bot.on(message("voice"), async ctx => {
	await ctx.reply(oneLine`
		Thanks for sharing your voice message. Just to let you know,
		I'm currently transcribing it, so I can read it, and that
		takes me at the very least 30 seconds.
		But I'll get back to you as soon as I can.
	`)

	const { file_id } = ctx.message.voice
	const fileLink = await ctx.telegram.getFileLink(file_id)
	const transcribeStart = performance.now()
	supabaseStore.set(`paused-update:${ctx.update.update_id}`, JSON.decycle([ transcribeStart, ctx.update ]))
	await requestTranscript(fileLink as URL, ctx.update.update_id)
	console.log("Got a voice message, waiting for transcription...")
})

bot.action("no_donation", ctx =>
	ctx.editMessageText(oneLine`
		Thank you for taking care of yourself, I sincerely appreciate it.
		You are always welcome to ask for more empathy whenever you need it.
		You can always change your mind by typing /donate.
	`
))

bot.action("never_donation", async ctx => {
	ctx.userSession.settings.askForDonation = false
	await ctx.editMessageText(oneLine`
		Thank you for taking care of yourself, I sincerely appreciate it.
		You are always welcome to ask for more empathy whenever you need it.
	`)
})

bot.action(/donate_(\d+)/, async ctx => {
	const donationAmount = parseInt(ctx.match[1])
	await ctx.answerCbQuery(`Thank you for your donation of $${donationAmount}!`)
	await ctx.deleteMessage()
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
				] = JSON.retrocycle(await supabaseStore.get(`paused-update:${updateId}`))

				const [transcriptionStart, ctxUpdate] = pausedUpdate ?? []

				if (!ctxUpdate || !transcriptionStart) {
					console.error("No context found in cache for update", { updateId, ctxUpdate, transcriptionStart })
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

// Enable graceful stop
Deno.addSignalListener("SIGINT", () => {
  bot.stop("SIGINT")
  Deno.exit()
})

Deno.addSignalListener("SIGTERM", () => {
  bot.stop("SIGTERM")
  Deno.exit()
})

console.log("Starting bot...")
bot.launch({ webhook, dropPendingUpdates: true })
	.catch(error => {
		console.error(error)
		Deno.exit(1)
	})

const setupEnd = performance.now()
console.log(`Setup took ${roundToSeconds(setupEnd - setupStart)} seconds.`)
