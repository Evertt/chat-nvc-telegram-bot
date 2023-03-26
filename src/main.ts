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
import { IntroData, getSystemPrompt } from "./system-prompt.ts"
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

const me = await bot.telegram.getMe()

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

const summarize = async (messages: ChatCompletionRequestMessage[]) => {
	const lastMessage = messages.pop()!

	messages.push({
		role: "system",
		content: oneLine`
			Please summarize the observations, feelings, needs,
			and possibly requests that the other person
			(or people, if there were more than one) had in the conversation.
			If there were any valuable insights in the conversation,
			you can include those too in the summary.
		`
	})

	console.log("Trying to get a summary")
	const assistantResp = await getAssistantResponse(messages)
	const summaryMessage = assistantResp.choices[0].message
	console.log("Got a summary:", summaryMessage?.content)

	if (!summaryMessage) throw new Error("No summary message returned")

	messages.splice(1, Infinity, summaryMessage, lastMessage)
}

const needsNewCheckPoint = (messages: Message[], excludeNames: boolean, request: IntroData["request"] = "translation") => {
	const chatMessages: ChatCompletionRequestMessage[] = messages.map(msg => (
		{ role: /chatnvc/i.test(msg.name) ? "assistant" : "user", content: `${excludeNames || msg.name === BOT_NAME ? '' : msg.name + ": "}${msg.message}` }
	))

	const names = new Set(messages.map(msg => msg.name))
	names.delete(BOT_NAME)

	const systemPrompt = getSystemPrompt(
		{
			request,
			names: [...names],
		},
		false,
	)

	chatMessages.unshift({ role: "system", content: systemPrompt })

	const tokenCount = chatMessages.reduce(
		(tokenCount, msg) => tokenCount + getTokens(msg.content),
		0
	)

	return [tokenCount > 3750, chatMessages] as const
}

const addNewCheckPointIfNeeded = (messages: Message[], excludeNames = false, request: IntroData["request"] = "translation") => {
	const [needsNewCheckpoint, chatMessages] = needsNewCheckPoint(messages, excludeNames, request)

	if (!needsNewCheckpoint) return

	summarize(chatMessages)
	const lastMessage = messages.pop()!

	const summaryMessage: Message = {
		type: "text",
		name: BOT_NAME,
		message: chatMessages[1].content,
		date: Date(),
		checkpoint: true,
	}

	messages.push(summaryMessage, lastMessage)
}

const getReply = async (messages: Message[], name: string, text: string, type: "text" | "voice", askForDonation: boolean, request: IntroData["request"] = "empathy") => {
	// console.log("Generating reply")

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
		{ role: /chatnvc/i.test(msg.name) ? "assistant" : "user", content: `${msg.name === BOT_NAME ? '' : msg.name + ": "}${msg.message}` }
	))

	const systemPrompt = getSystemPrompt(
		{
			request,
			names: [name],
		},
		askForDonation,
	)

	chatMessages.unshift({ role: "system", content: systemPrompt })

	const tokenCount = chatMessages.reduce(
		(tokenCount, msg) => tokenCount + getTokens(msg.content),
		0
	)

	if (tokenCount > 3750) {
		summarize(chatMessages)

		const lastMessage = messages.pop()!
		const summaryMessage: Message = {
			type: "text",
			name: BOT_NAME,
			message: chatMessages[1].content,
			date: Date(),
			checkpoint: true,
		}

		messages.push(summaryMessage, lastMessage)
	}

	const completionResponse: CreateChatCompletionResponse = await getAssistantResponse(chatMessages);
	
	let assistantResponse = completionResponse.choices[0]?.message?.content ?? ""

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

	assistantResponse = assistantResponse
		.replace(/^chatnvc\w*: /i, "")

	messages.push({
		type: "text",
		name: BOT_NAME,
		message: assistantResponse,
		date: Date(),
	})

	return assistantResponse
}

bot.on([message("text"), message("voice")], async ctx => {
	if (ctx.chat.type === "supergroup") return

	let text = ''

	if ("text" in ctx.message) {
		text = ctx.message.text
	} else if ("voice" in ctx.message) {
		const { file_id } = ctx.message.voice
		const fileLink = await ctx.telegram.getFileLink(file_id)
		text = await getTranscription(fileLink as URL)

		if (ctx.session.settings.receiveVoiceTranscriptions && ctx.chat.type === "private")
			await ctx.replyWithHTML(oneLine`
				Thanks for sharing. I just want to share
				my transcription of your voice message,
				just so that you can check if I heard you correctly:
			` + `\n\n<i>${text}</i>`)
	}

	if (ctx.chat.type === "private" || ctx.session.settings.storeMessagesInGroups) {
		ctx.session.messages.push({
			type: "text" in ctx.message ? "text" : "voice",
			name: ctx.from.first_name,
			message: text,
			date: Date(),
		})

		addNewCheckPointIfNeeded(ctx.session.messages, ctx.chat.type === "private")
	}

	if (ctx.chat.type === "group") {
		const wasMentioned = "text" in ctx.message
			? ctx.message.text.includes(`@${ctx.me}`)
			: text.includes(BOT_NAME)

		const reply = ctx.message.reply_to_message
		const messages = [ ...ctx.session.messagesFromLastCheckpoint ]

		if (!reply || ctx.session.settings.storeMessagesInGroups) {
			// do nothing
		} else if ("text" in reply) {
			messages.push({
				type: "text",
				name: reply.from!.first_name,
				message: reply.text,
				date: new Date(reply.date).toString()
			})
		} else if ("voice" in reply) {
			const { file_id } = reply.voice
			const fileLink = await ctx.telegram.getFileLink(file_id)
			const transcription = await getTranscription(fileLink as URL)

			messages.push({
				type: "voice",
				name: reply.from!.first_name,
				message: transcription,
				date: new Date(reply.date).toString()
			})
		}

		if (!wasMentioned) {
			if (!reply) return // void (console.log("and there was no reply either"))
			if (reply.from?.id !== me.id) return
		}

		if (text.includes("/keep_track")) {
			ctx.session.settings.storeMessagesInGroups = true

			return ctx.reply(oneLine`
				Okay, I'll keep track of all messages in this group from now on.
				So that I can hopefully offer better empathy when asked.
			`)
		}

		const stopTyping = repeat(
			() => ctx.sendChatAction("typing"),
			5100
		)

		return getReply(
			messages,
			ctx.from.first_name,
			text,
			"text" in ctx.message ? "text" : "voice",
			false,
			"translation",
		)
		.then(reply => {
			if (ctx.session.settings.storeMessagesInGroups) {
				ctx.session.messages.push({
					type: "text",
					name: BOT_NAME,
					message: reply,
					date: Date(),
				})
			}

			return ctx.reply(reply, { reply_to_message_id: ctx.message.message_id })
		})
		.catch(error => {
			console.error(error)
			return ctx.reply(OPENAI_OVERLOADED_MESSAGE)
		})
		.finally(stopTyping)
	}

	const replyStub = await ctx.replyWithHTML(oneLine`
		<i>I'll need a moment to process what you said, please wait...</i> 🙏
	`)

	const stopTyping = repeat(
		() => ctx.sendChatAction("typing"),
		5100
	)

	await getReply(
		ctx.session.messagesFromLastCheckpoint,
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

	// console.log("Reply sent.")
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

async function getAssistantResponse(chatMessages: ChatCompletionRequestMessage[]) {
  const chatRequestOpts: CreateChatCompletionRequest = {
    model: "gpt-3.5-turbo",
    temperature: 0.9,
    messages: chatMessages,
  };

  const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    body: JSON.stringify(chatRequestOpts)
  })

  if(!chatResponse.ok) {
    const err = await chatResponse.text()
    throw new Error(err)
  }

  return await chatResponse.json() as CreateChatCompletionResponse
}
