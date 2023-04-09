// deno-lint-ignore-file ban-types
import "https://deno.land/std@0.179.0/dotenv/load.ts"

// import * as http from "node:http"
import { bot, BOT_NAME, setupStart } from "./bot.ts"
import { queueMiddleware } from "./middleware/queues.ts"
import { addMiddlewaresToBot } from "./middleware/add-all-to-bot.ts"
import { addScenesToBot } from "./scenes/add-all-to-bot.ts"

import { type Telegraf, Markup } from "npm:telegraf@4.12.3-canary.1"

import { getTranscription } from "./audio-transcriber.ts"
import {
	type Message,
	moderate,
	getAssistantResponse,
	getMessagesFromLastCheckpoint,
	addNewCheckPointIfNeeded,
	requestTranscript,
	fetchTranscript,
} from "./utils.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "./error-messages.ts"
import { oneLine, oneLineCommaListsAnd, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import type {
	ChatCompletionRequestMessage,
} from "npm:openai@3.2.1"
import { isBotAskingForDonation } from "./donations.ts"

const {
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
	PAYMENT_TOKEN = "",
} = Deno.env.toObject()

addMiddlewaresToBot(bot)

addScenesToBot(bot)

const me = await bot.telegram.getMe()

bot.start(async ctx => {
	console.log("start command")

	if (ctx.chat.type !== "private")
		return ctx.reply("Please write to me in a private chat 🙏")

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
	await ctx.reply(greeting)
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

const getReply = async (chatMessages: ChatCompletionRequestMessage[]) => {
	let moderationResult = await moderate(chatMessages.at(-1)!.content)
	if (moderationResult) return oneLineCommaListsAnd`
		Your message was flagged by OpenAI for ${moderationResult}.
		Please try to rephrase your message. 🙏
	`

	const assistantResponse = await getAssistantResponse(chatMessages)
	
	moderationResult = await moderate(assistantResponse.content)
	if (moderationResult) return oneLine`
		Sorry, I was about to say something potentially inappropriate.
		I don't know what happened.
		Could you maybe try to rephrase your last message differently?
		That might help me to formulate a more appropriate response.
		Thank you. 🙏
	`

	return assistantResponse.content
}

// @ts-expect-error trust me
type Ctx = Parameters<Extract<Parameters<typeof bot.on<"text">>[1], Function>>[0]
const cache = new Map<number, Ctx>()

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

	let messages = ctx.chatSession.messages
	const messagesFromLastCheckpoint = getMessagesFromLastCheckpoint(messages)
	let chatMessages: ChatCompletionRequestMessage[] = []

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

		if (reply) {
			let text = "text" in reply ? reply.text : ""

			if ("voice" in reply) {
				const { file_id } = reply.voice
				const fileLink = await ctx.telegram.getFileLink(file_id)
				text = await getTranscription(fileLink as URL)
			}

			messages = [lastMessage]

			messages.unshift({
				type: "text" in reply ? "text" : "voice",
				name: reply.from!.first_name,
				message: text,
				date: new Date(reply.date).toString(),
			})

			;({ messages, chatMessages } = await addNewCheckPointIfNeeded(messages, false, "translation"))
		}

		return ctx.persistentChatAction(
			"typing",
			() => getReply(chatMessages)
				.then(async reply => {
					if (ctx.chatSession.storeMessages) {
						ctx.chatSession.messages.push({
							type: "text",
							name: BOT_NAME,
							message: reply,
							date: Date(),
						})
					}

					await ctx.reply(reply, { reply_to_message_id: ctx.message.message_id })
				})
				.catch(async error => {
					console.error(error)
					await ctx.reply(OPENAI_OVERLOADED_MESSAGE)
				})
		)
	}

	({ messages, chatMessages } = await addNewCheckPointIfNeeded(
		messages, chatIsPrivate, chatIsPrivate ? "empathy" : "translation"
	))

	if (messagesFromLastCheckpoint[0].message !== messages[0].message) {
		ctx.chatSession.messages.splice(
			ctx.chatSession.messages.length - messages.length + 1, 0, messages[0]
		)
	}

	return ctx.persistentChatAction(
		"typing",
		() => getReply(chatMessages)
		.then(async reply => {
			ctx.chatSession.messages.push({
				type: "text",
				name: BOT_NAME,
				message: reply,
				date: Date(),
			})

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
		I'm trying out a new transcription service,
		it may not even work.
		You'll see if you get a response within a few minutes or not.
	`)

	cache.set(ctx.update.update_id, ctx as unknown as Ctx)
	const { file_id } = ctx.message.voice
	const fileLink = await ctx.telegram.getFileLink(file_id)
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

				try {
					let body = ''
					// parse each buffer to string and append to body
					for await (const chunk of req) body += String(chunk)
					// parse body to object
					const update = JSON.parse(body) as {
						status: "completed"
						transcript_id: string
					} | { status: "error" }

					if (update.status === "error") {
						throw ["transcript status error", update]
					}

					const text = await fetchTranscript(update.transcript_id)

					if (!text) {
						console.error("No text found for transcript status update", updateId)
						return
					}

					const ctx = cache.get(updateId)

					if (!ctx) {
						console.error("No context found in cache for update", updateId)
						return
					}

					ctx.message.text = text

					const job = (ctx?: Ctx) => bot.handleUpdate(ctx!.update)

					queueMiddleware(ctx, job)
				} catch (error) {
					console.error("error", error)
				} finally {
					cache.delete(updateId)
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
console.log(`Setup took ${setupEnd - setupStart}ms.`)
