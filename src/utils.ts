// deno-lint-ignore-file
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { ConditionalExcept } from "npm:type-fest@3.6.1"
// import type { Context } from "npm:telegraf@4.12.3-canary.1"
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from "npm:openai@3.2.1"
import { type MyContext, BOT_NAME } from "./bot.ts"
import { getTokens, MAX_PROMPT_TOKENS, MAX_TOKENS } from "./tokenizer.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { findLastIndex, memoize } from "npm:lodash-es@4.17.21"
import { type IntroData, getSystemPrompt } from "./system-prompt.ts"
import { oneLine, oneLineCommaListsAnd } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "./error-messages.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"

const log = debug("telegraf:utils")
export type Message = MyContext["chatSession"]["messages"][number]

const { OPENAI_KEY, ASSEMBLYAI_KEY, DOMAIN } = Deno.env.toObject()

export type Modify<T, K> = Omit<T, keyof K> & ConditionalExcept<K, never>

export const sleep = (ms: number) => new Promise<void>(
	resolve => setTimeout(resolve, ms)
)

export type MyChatCompletionRequestMessage = ChatCompletionRequestMessage & {
	tokens: number
}

type Contra<T> =
  T extends any 
		? (arg: T) => void 
		: never

type Cov<T> = 
  T extends any 
		? () => T
		: never

type InferCov<T> = 
  [T] extends [() => infer I]
		? I
		: never

type InferContra<T> = 
  [T] extends [(arg: infer I) => void] 
		? I
		: never

type PickOne<T> = InferContra<InferContra<Contra<Contra<T>>>>

export type Union2Tuple<T> =
    PickOne<T> extends infer U                  // assign PickOne<T> to U
    ? Exclude<T, U> extends never               // T and U are the same
        ? [T]
        : [...Union2Tuple<Exclude<T, U>>, U]    // recursion
    : never

type ArrayLengthMutationKeys = 'splice' | 'push' | 'pop' | 'shift' |  'unshift'
export type FixedLengthArray<T, L extends number, TObj = [T, ...Array<T>]> =
  Pick<TObj, Exclude<keyof TObj, ArrayLengthMutationKeys>>
  & {
    readonly length: L 
    [ I : number ] : T
    [Symbol.iterator]: () => IterableIterator<T>   
  }

export const moderate = async (input: string) => {
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

const SUMMARY_PROMPT = oneLine`
	Please summarize the observations, feelings, needs,
	and possibly requests that the other person
	(or people, if there were more than one) had in the conversation.
	If there were any valuable insights in the conversation,
	you can include those too in the summary.
`

const SUMMARY_MESSAGE: Message = {
	name: "system",
	message: SUMMARY_PROMPT,
	type: "text",
	date: Date(),
	tokens: getTokens(SUMMARY_PROMPT),
}

const SUMMARY_CHAT_MESSAGE = convertToChatMessages(
	[SUMMARY_MESSAGE], [], true, "empathy"
)[1]

log(`SUMMARY_CHAT_MESSAGE: ${JSON.stringify(SUMMARY_CHAT_MESSAGE, null, 2)}`)

export const summarize = async (ctx: MyContext) => {
	log("Trying to get a summary")

	const summaryMessage = await askAssistant(
		ctx, SUMMARY_PROMPT, true
	)

	log(`Got a summary: ${summaryMessage}`)

	ctx.chatSession.messages.at(-1)!.checkpoint = true

	return summaryMessage
}

export const getMessagesFromLastCheckpoint = async (ctx: MyContext) => {
	const messages = [ ...ctx.chatSession.messages ]
	log(`first messages.length: ${messages.length}`)
	let i = findLastIndex(messages, message => !!message.checkpoint)
	log(`first i: ${i}`)
	let messagesFromLastCheckpoint = messages.slice(Math.max(i, 0))

	const chatIsPrivate = ctx.chat?.type === "private"
	const allNames = getNamesFromMessages(messages)
	let chatMessages = convertToChatMessages(messagesFromLastCheckpoint, allNames, chatIsPrivate, chatIsPrivate ? "empathy" : "translation")

	log(`messagesFromLastCheckpoint.length: ${messagesFromLastCheckpoint.length}`)
	const lastMessages = needsNewCheckPoint(
		messagesFromLastCheckpoint, chatMessages
	)
	log(`messagesFromLastCheckpoint.length: ${messagesFromLastCheckpoint.length}`)

	if (lastMessages.length) {
		ctx.chatSession.messages = messagesFromLastCheckpoint
		log(`ctx.chatSession.messages.length: ${ctx.chatSession.messages.length}`)
		await summarize(ctx)
		ctx.chatSession.messages.push(...lastMessages)
		ctx.chatSession.messages = [
			...messages.slice(0, i),
			...ctx.chatSession.messages
		]
		i = findLastIndex(ctx.chatSession.messages, message => !!message.checkpoint)
		log(`new i: ${i}`)
		messagesFromLastCheckpoint = ctx.chatSession.messages.slice(Math.max(i, 0))
		log(`new messagesFromLastCheckpoint:\n\n${messagesFromLastCheckpoint.map(m => `${m.name}: ${m.message}`).join("\n\n")}`)
		chatMessages = convertToChatMessages(messagesFromLastCheckpoint, allNames, chatIsPrivate, chatIsPrivate ? "empathy" : "translation")
	}

	return { messages: messagesFromLastCheckpoint, chatMessages }
}

export const getNamesFromMessages = (messages: Message[]) => {
	const names = new Set(messages.map(msg => msg.name))
	names.delete(BOT_NAME)
	names.delete("system")
	return [...names]
}

export function convertToChatMessages(messages: Message[], allNames: string[], excludeNames: boolean, request: IntroData["request"] = "translation") {
	const chatMessages: MyChatCompletionRequestMessage[] = messages.map(msg => ({
		role: msg.name === "system" ? "system" : /chatnvc/i.test(msg.name) ? "assistant" : "user",
		content: `${excludeNames || [BOT_NAME, "system"].includes(msg.name) ? '' : msg.name + ": "}${msg.message}`,
		tokens: (excludeNames || [BOT_NAME, "system"].includes(msg.name) ? 0 : getTokens(msg.name + ": ")) + ((msg.tokens ??= getTokens(msg.message)) + 4),
	}))

	const systemPrompt = getSystemPrompt(
		{
			request,
			names: allNames,
		},
		false,
	)

	chatMessages.unshift({
		role: "system",
		content: systemPrompt,
		tokens: getTokens(systemPrompt) + 4,
	})

	return chatMessages
}

export const getTokenCount = (chatMessages: MyChatCompletionRequestMessage[]) => {
	const tokenCount = chatMessages.reduce(
		(tokenCount, msg) => tokenCount + (msg.tokens ??= getTokens(msg.content) + 4),
		0
	)

	return tokenCount
}

export const needsNewCheckPoint = (messages: Message[], chatMessages: MyChatCompletionRequestMessage[]) => {
	let tokenCount = getTokenCount(chatMessages)
	if (tokenCount < MAX_PROMPT_TOKENS) return []
	tokenCount += SUMMARY_CHAT_MESSAGE.tokens
	const lastMessages: Message[] = []

	while (tokenCount >= MAX_PROMPT_TOKENS && messages.length) {
		// I thought this should actually be .push() instead of .unshift()
		// but apparently .push() retults in lastMessages being in the reversed order.
		lastMessages.unshift(messages.pop()!)
		const deletedMessage = chatMessages.pop()
		tokenCount -= deletedMessage!.tokens
	}
	
	if (tokenCount >= MAX_PROMPT_TOKENS)
		throw new Error("Messages too long to summarize")

	log(`messages.length: ${messages.length}`)
	log(`lastMessages.length: ${lastMessages.length}`)

	return lastMessages
}

export async function getAssistantResponse(ctx: MyContext, saveInSession = true, temperature = 0.9) {
	const { chatMessages } = await getMessagesFromLastCheckpoint(ctx)

	const moderationResult = await moderate(chatMessages.at(-1)!.content)
	ctx.userSession.tokens.used += chatMessages.at(-1)!.tokens
	
	if (moderationResult) {
		ctx.chatSession.messages.pop()

		throw oneLineCommaListsAnd`
			Your message was flagged by OpenAI for ${moderationResult}.
			Please try to rephrase your message. 🙏
		`
	}

	const promptTokenCount = getTokenCount(chatMessages)

	const chatRequestOpts: CreateChatCompletionRequest = {
		model: "gpt-3.5-turbo",
		temperature,
		messages: chatMessages.map(msg => ({
			role: msg.role,
			content: msg.content,
		})),
		max_tokens: MAX_TOKENS - promptTokenCount,
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
		log("OpenAI error (maybe overloaded?):", await chatResponse.text())
		throw OPENAI_OVERLOADED_MESSAGE
	}

	const completionResponse = await chatResponse.json() as CreateChatCompletionResponse
	const assistantMessage = completionResponse.choices[0]?.message
	const finishReason = completionResponse.choices[0]?.finish_reason

	const sumTokens = memoize(() => ctx.chatSession.messages.slice(0, -1).reduce(
		(sum, msg) => sum + ((msg.tokens ??= getTokens(msg.message)) + 4),
		chatMessages[0].tokens ??= getTokens(chatMessages[0].content) + 4
	))

	if (ctx.chatSession.messages.at(-1)!.tokens == null) {
		const promptTokens = completionResponse.usage?.prompt_tokens ?? sumTokens()
		ctx.chatSession.messages.at(-1)!.tokens = Math.max((promptTokens - sumTokens()), getTokens(ctx.chatSession.messages.at(-1)!.message))
	}

	ctx.userSession.tokens.used ||= sumTokens() + ctx.chatSession.messages.at(-1)!.tokens! + 4
	ctx.userSession.tokens.used += completionResponse.usage?.total_tokens
		?? ctx.userSession.tokens.used + getTokens(assistantMessage?.content) + 4

	if (finishReason === "content_filter") {
		ctx.chatSession.messages.pop()

		throw oneLine`
			Sorry, I was about to say something potentially inappropriate.
			I don't know what happened.
			Could you maybe try to rephrase your last message differently?
			That might help me to formulate a more appropriate response.
			Thank you. 🙏
		`
	}

	if (!assistantMessage) {
		throw oneLine`
			OpenAI returned an empty response.
			I have no idea why. Maybe try again later?
		`
	}

	const content = assistantMessage.content
		.replace(/^chatnvc\w*: /i, "")

	if (!saveInSession) ctx.chatSession.messages.pop()
	else {
		ctx.chatSession.messages.push({
			type: "text",
			name: BOT_NAME,
			message: content,
			date: Date(),
			tokens: completionResponse.usage?.completion_tokens
				|| (getTokens(assistantMessage.content) + 4),
		})
	}

	return content
}

export const askAssistant = async (ctx: MyContext, question: string, saveInSession = false) => {
	ctx.chatSession.messages.push({
		type: "text",
		name: "system",
		message: question,
		date: Date(),
		tokens: getTokens(question),
	})

	const answer = await getAssistantResponse(ctx, saveInSession, 0.2)
		.then(answer => {
			log(`Assistant answer: ${answer}`)
			return answer
		})
		.catch((errorAnswer: string) => {
			console.error("Error response:", errorAnswer)
			return errorAnswer
		})

	return answer
}

export const requestTranscript = async (url: URL, update_id: number) => {
	const requestingTranscriptStart = performance.now()

	const resp = await fetch("https://api.assemblyai.com/v2/transcript", {
		headers: {
			Authorization: ASSEMBLYAI_KEY,
			"Content-Type": "application/json"
		},
		method: "POST",
		body: JSON.stringify({
			audio_url: url.toString(),
			language_detection: true,
			webhook_url: `${DOMAIN}/?update_id=${update_id}`
		})
	})

	if (!resp.ok) {
		const err = await resp.text()
		console.error(err)
		throw new Error(err)
	}

	const { id } = await resp.json() as { id: string }

	const requestingTranscriptEnd = performance.now()
	log(`Requested transcript in ${requestingTranscriptEnd - requestingTranscriptStart} seconds`)

	return id
}

export const fetchTranscript = async (transcriptId: string) => {
	const resp = await fetch(
		`https://api.assemblyai.com/v2/transcript/${transcriptId}`,
		{ headers: { Authorization: ASSEMBLYAI_KEY } }
	)

	if (!resp.ok) {
		const err = await resp.text()
		console.error("problem fetching transcript", err)
		return err
		// throw new Error(err)
	}

	const { text } = await resp.json() as { text: string }

	return text
}

export const roundToSeconds = (time: number) => Math.round(time / 10) / 100