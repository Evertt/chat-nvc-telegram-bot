// deno-lint-ignore-file
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { ConditionalExcept } from "npm:type-fest@3.6.1"
import type { Context } from "npm:telegraf@4.12.3-canary.1"
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from "npm:openai@3.2.1"
import { type MyContext, BOT_NAME } from "./bot.ts"
import { getTokens, MAX_TOKENS } from "./tokenizer.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { findLastIndex } from "npm:lodash-es@4.17.21"
import { type IntroData, getSystemPrompt } from "./system-prompt.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

export type Message = MyContext["chatSession"]["messages"][number]

const { OPENAI_KEY, ASSEMBLYAI_KEY, DOMAIN } = Deno.env.toObject()

export type Modify<T, K> = Omit<T, keyof K> & ConditionalExcept<K, undefined>

export const sleep = (ms: number) => new Promise<void>(
	resolve => setTimeout(resolve, ms)
)

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

export const summarize = async (chatMessages: ChatCompletionRequestMessage[]) => {
	console.log("Trying to get a summary")
	const summaryMessage = await getAssistantResponse([...chatMessages, {
		role: "system",
		content: oneLine`
			Please summarize the observations, feelings, needs,
			and possibly requests that the other person
			(or people, if there were more than one) had in the conversation.
			If there were any valuable insights in the conversation,
			you can include those too in the summary.
		`
	}])
	console.log("Got a summary:", summaryMessage.content)

	return summaryMessage
}

export const getMessagesFromLastCheckpoint = (messages: Message[]) => {
	const i = findLastIndex(messages, message => !!message.checkpoint)
	return messages.slice(Math.max(i, 0))
}

export const getNamesFromMessages = (messages: Message[]) => {
	const names = new Set(messages.map(msg => msg.name))
	names.delete(BOT_NAME)
	return [...names]
}

export const convertToChatMessages = (messages: Message[], allNames: string[], excludeNames: boolean, request: IntroData["request"] = "translation") => {
	const chatMessages: ChatCompletionRequestMessage[] = messages.map(msg => (
		{ role: /chatnvc/i.test(msg.name) ? "assistant" : "user", content: `${excludeNames || msg.name === BOT_NAME ? '' : msg.name + ": "}${msg.message}` }
	))

	const systemPrompt = getSystemPrompt(
		{
			request,
			names: allNames,
		},
		false,
	)

	chatMessages.unshift({ role: "system", content: systemPrompt })

	return chatMessages
}

export const getTokenCount = (chatMessages: ChatCompletionRequestMessage[]) => {
	const tokenCount = chatMessages.reduce(
		(tokenCount, msg) => tokenCount + getTokens(msg.content),
		0
	)

	return tokenCount
}

export const addNewCheckPointIfNeeded = async (messages: Message[], excludeNames = false, request: IntroData["request"] = "translation") => {
	const allNames = getNamesFromMessages(messages)
	messages = getMessagesFromLastCheckpoint(messages)
	let chatMessages = convertToChatMessages(messages, allNames, excludeNames, request)
	let tokenCount = getTokenCount(chatMessages)
	const lastMessages: Message[] = []

	while (tokenCount >= MAX_TOKENS && messages.length) {
		lastMessages.unshift(messages.pop()!)
		chatMessages.pop()
		tokenCount = getTokenCount(chatMessages)
	}
	
	if (tokenCount >= MAX_TOKENS)
		throw new Error("Messages too long to summarize")

	if (!lastMessages.length)
		return { messages, chatMessages }
	
	const summary = await summarize(chatMessages)
	chatMessages = convertToChatMessages(lastMessages, allNames, excludeNames, request)
	chatMessages.splice(1, 0, summary)
	
	const summaryMessage: Message = {
		type: "text",
		name: BOT_NAME,
		message: summary.content,
		date: Date(),
		checkpoint: true,
	}

	return { messages: [summaryMessage, ...lastMessages], chatMessages }
}

export async function getAssistantResponse(chatMessages: ChatCompletionRequestMessage[]) {
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

	if(!chatResponse.ok) {
		const err = await chatResponse.text()
		throw new Error(err)
	}

	const completionResponse = await chatResponse.json() as CreateChatCompletionResponse
	const assistantMessage = completionResponse.choices[0]?.message

	if (!assistantMessage) {
		throw new Error("OpenAI returned an empty response")
	}

	assistantMessage.content = assistantMessage.content
		.replace(/^chatnvc\w*: /i, "")

	return assistantMessage
}

export const askAssistant = async (ctx: MyContext, question: string, saveInSession = false) => {
	const chatIsPrivate = ctx.chat?.type === "private"
	let messages = ctx.chatSession.messages
	const allNames = getNamesFromMessages(messages)
	messages = getMessagesFromLastCheckpoint(messages)
	const chatMessages = convertToChatMessages(messages, allNames, chatIsPrivate, chatIsPrivate ? "empathy" : "translation")

  const systemQuestion = {
		role: "system",
		content: question,
	} as const

	chatMessages.push(systemQuestion)

	if (saveInSession) {
		ctx.chatSession.messages.push({
			type: "text",
			name: "system",
			message: question,
			date: Date(),
		})
	}

	const assistantMessage = await getAssistantResponse(chatMessages)
	const answer = assistantMessage.content

	console.log("Assistant answer:", answer)

	if (saveInSession) {
		ctx.chatSession.messages.push({
			type: "text",
			name: BOT_NAME,
			message: answer,
			date: Date(),
		})
	}

	return answer
}

export const requestTranscript = async (url: URL, update_id: number) => {
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

export const roundToSeconds = (time: number) => Math.round(time * 1000) / 1000