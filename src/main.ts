// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.179.0/dotenv/load.ts"

import { bot } from "./bot.ts"
import { addMiddlewaresToBot } from "./middleware/add-all-to-bot.ts"
import { addSettingsToBot } from "./bot/settings.ts"
import type { Session } from "./middleware/session/session.ts"

import { type Telegraf } from "npm:telegraf@4.12.2"
import { getTokens } from "./tokenizer.ts"

import { getTranscription } from "./audio-transcriber.ts"
import { repeat } from "./utils.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "./error-messages.ts"
// @deno-types="npm:@types/common-tags@1.8.1"
import { oneLine, oneLineCommaListsAnd, stripIndents } from "npm:common-tags@1.8.1"
import { message } from "npm:telegraf@4.12.2/filters"
import { getSystemPrompt } from "./system-prompt.ts"
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from "npm:openai@3.2.1"

type Message = Session["messages"][number]

const {
  OPENAI_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
} = Deno.env.toObject()

const BOT_NAME = "ChatNVC"

addMiddlewaresToBot(bot)
addSettingsToBot(bot)

bot.start(async ctx => {
	console.log("start command")

	if (ctx.chat.type !== "private")
		return ctx.reply("Please write to me in a private chat 🙏")

	const greeting = ctx.session.metaData.haveSpokenBefore
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
	ctx.session.messages = [
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
`))

const moderate = async (input: string) => {
	const moderationRes = await fetch("https://api.openai.com/v1/moderations", {
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${OPENAI_KEY}`
		},
		method: "POST",
		body: JSON.stringify({ input })
	})

	const moderationData: CreateModerationResponse = await moderationRes.json()
	const [results] = moderationData.results

	if (results.flagged) {
		const categories = Object.entries(results.categories)
			.filter(([_, value]) => value)
			.map(([category]) => category)

		return categories
	}

	return false
}

const getReply = async (messages: Message[], name: string, text: string, type: "text" | "voice") => {
	console.log("Generating reply")

	let moderationResult = await moderate(text)
	if (moderationResult) return oneLineCommaListsAnd`
		Your message was flagged by OpenAI for ${moderationResult}.
		Please try to rephrase your message. 🙏
	`

	messages.push({
		type,
		name: name,
		message: text,
		date: Date(),
	})
	
	const chatMessages: ChatCompletionRequestMessage[] = messages.map(msg => (
		{ role: msg.name === BOT_NAME ? "assistant" : "user", content: msg.message }
	))

	const systemPrompt = getSystemPrompt({
		request: "empathy",
		names: [name],
	})

	chatMessages.unshift({ role: "system", content: systemPrompt })

	const tokenCount = chatMessages.reduce(
		(tokenCount, msg) => tokenCount + getTokens(msg.content),
		0
	)

	if (tokenCount >= 4000) {
		return oneLine`
			This conversation has become too long for me to be able to process it.
			In the future I will add a button with which you can order me to summarize the conversation.
			For now, what you can do is to wipe my memory by typing /start.
		`
	}

	const chatRequestOpts: CreateChatCompletionRequest = {
		model: "gpt-3.5-turbo",
		temperature: 0.9,
		messages: chatMessages,
	}

	const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
		headers: {
			Authorization: `Bearer ${OPENAI_KEY}`,
			"Content-Type": "application/json"
		},
		method: "POST",
		body: JSON.stringify(chatRequestOpts)
	})

	if (!chatResponse.ok) {
		const err = await chatResponse.text()
		throw new Error(err)
	}

	const completionResponse: CreateChatCompletionResponse = await chatResponse.json()
	
	const assistantResponse = completionResponse.choices[0]?.message?.content ?? ""

	if (assistantResponse === "") {
		throw new Error("OpenAI returned an empty response")
	}

	moderationResult = await moderate(assistantResponse)
	if (moderationResult) return oneLine`
		Sorry, I was about to say something potentially inappropriate.
		I don't know what happened.
		Could you maybe try to rephrase your last message differently?
		That might help me to formulate a more appropriate response.
		Thank you. 🙏
	`

	messages.push({
		type: "text",
		name: BOT_NAME,
		message: assistantResponse,
		date: Date(),
	})

	return assistantResponse
}

bot.on(message("text"), async ctx => {
	if (ctx.chat.type !== "private") return

	const stopTyping = repeat(
		() => ctx.sendChatAction("typing"),
		5100
	)

	const handleError = (error: any) => {
		console.log("Reply error:", error)
	
		ctx.reply(OPENAI_OVERLOADED_MESSAGE)
	}

	await getReply(
		ctx.session.messages,
		ctx.from.first_name,
		ctx.message.text,
		"text"
	)
		.then(reply => ctx.replyWithHTML(reply))
    .catch(handleError)
    .finally(stopTyping)

	console.log("Reply sent.")
})

bot.on(message("voice"), async ctx => {
	if (ctx.chat.type !== "private") return

	const stopTyping = repeat(
		() => ctx.sendChatAction("typing"),
		5100
	)

	const voiceLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id)
  const transcription = await getTranscription(voiceLink);

	if (ctx.session.settings.receiveVoiceTranscriptions)
		await ctx.replyWithHTML(oneLine`
			Thanks for sharing. I just want to share
			my transcription of your voice message,
			just so that you can check if I heard you correctly:
		` + `\n\n<i>${transcription}</i>`)

	const replyStub = await ctx.reply(oneLine`
		I'll need a moment to process what you said, please wait 🙏
	`)

	await getReply(
		ctx.session.messages,
		ctx.from.first_name,
		transcription,
		"voice"
	)
		.then(reply =>
			ctx.telegram.editMessageText(
				ctx.chat.id,
				replyStub.message_id,
				undefined,
				reply,
				{ parse_mode: "HTML" }
			)
		)
		.catch(error => {
			console.log("Error:", error)

			return ctx.telegram.editMessageText(
				ctx.chat.id,
				replyStub.message_id,
				undefined,
				OPENAI_OVERLOADED_MESSAGE,
			)
		})
		.finally(stopTyping)

	console.log("Reply sent.")
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: "/",
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
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

await bot.launch({ webhook })
