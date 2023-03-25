import "https://deno.land/std@0.179.0/dotenv/load.ts"

import { bot } from "./bot.ts"
import { addMiddlewaresToBot } from "./middleware/add-all-to-bot.ts"
import { addScenesToBot } from "./scenes/add-all-to-bot.ts"
import type { Session } from "./middleware/session/session.ts"

import { type Telegraf, Markup } from "npm:telegraf@4.12.2"
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
import { isBotAskingForDonation } from "./donations.ts";

type Message = Session["messages"][number]

const {
  OPENAI_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = "",
  PORT,
	PAYMENT_TOKEN = "",
} = Deno.env.toObject()

const BOT_NAME = "ChatNVC"

addMiddlewaresToBot(bot)

addScenesToBot(bot)

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

const getReply = async (messages: Message[], name: string, text: string, type: "text" | "voice", askForDonation: boolean) => {
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

	const systemPrompt = getSystemPrompt(
		{
			request: "empathy",
			names: [name],
		},
		askForDonation,
	)

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

bot.on([message("text"), message("voice")], async ctx => {
	if (ctx.chat.type !== "private") return

	const stopTyping = repeat(
		() => ctx.sendChatAction("typing"),
		5100
	)

	let text = ''

	if ("text" in ctx.message) {
		text = ctx.message.text
	} else if ("voice" in ctx.message) {
		const { file_id } = ctx.message.voice
		const fileLink = await ctx.telegram.getFileLink(file_id)
		text = await getTranscription(fileLink)

		if (ctx.session.settings.receiveVoiceTranscriptions)
			await ctx.replyWithHTML(oneLine`
				Thanks for sharing. I just want to share
				my transcription of your voice message,
				just so that you can check if I heard you correctly:
			` + `\n\n<i>${text}</i>`)
	}

	const replyStub = await ctx.replyWithHTML(oneLine`
		<i>I'll need a moment to process what you said, please wait...</i> 🙏
	`)

	await getReply(
		ctx.session.messages,
		ctx.from.first_name,
		text,
		"text" in ctx.message ? "text" : "voice",
		ctx.session.settings.askForDonation !== false
	)
		.then(reply => {
			const askForDonation =
				PAYMENT_TOKEN
				&& ctx.session.settings.askForDonation !== false
				&& isBotAskingForDonation(reply)

				return ctx.telegram.editMessageText(
					ctx.chat.id,
					replyStub.message_id,
					undefined,
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

bot.action("no_donation", ctx =>
	ctx.editMessageText(oneLine`
		Thank you for taking care of yourself, I sincerely appreciate it.
		You are always welcome to ask for more empathy whenever you need it.
		You can always change your mind by typing /donate.
	`
))

bot.action("never_donation", async ctx => {
	ctx.session.settings.askForDonation = false
	await ctx.editMessageText(oneLine`
		Thank you for taking care of yourself, I sincerely appreciate it.
		You are always welcome to ask for more empathy whenever you need it.
	`)
})

bot.action(/donate_(\d+)/, async ctx => {
	const donationAmount = parseInt(ctx.match[1])
	await ctx.answerCbQuery(`Thank you for your donation of $${donationAmount}!`)
	await ctx.editMessageText(oneLine`
		Thank you for your donation of $${donationAmount}!
		You are always welcome to ask for more empathy whenever you need it.
	`)
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

console.log("Starting bot...")
await bot.launch({ webhook })
