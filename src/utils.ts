// deno-lint-ignore-file
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { ConditionalExcept, Simplify, Merge } from "npm:type-fest@3.6.1"
// import type { Context } from "npm:telegraf@4.12.3-canary.1"
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from "npm:openai@3.2.1"
import type { MyContext, ChatSession, Message } from "./context.ts"
import { me } from "./me.ts"
import { getTokens, MAX_PROMPT_TOKENS, MAX_TOKENS } from "./tokenizer.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { findLastIndex } from "npm:lodash-es@4.17.21"
import { type IntroData, getSystemPrompt } from "./system-prompt.ts"
import { oneLine, oneLineCommaListsAnd } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "./error-messages.ts"
import { debug } from "https://deno.land/x/debug@0.2.0/mod.ts"
import type { ParseMode } from "npm:typegram@4.3.0"

const log = debug("telegraf:utils")

const { OPENAI_KEY, ASSEMBLYAI_KEY, DOMAIN } = Deno.env.toObject()

export type Modify<T, K> = Simplify<
	ConditionalExcept<Merge<T, K>, never>
>

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

export const SYSTEM_USER_ID = 0
export const SYSTEM_NAME = "System"

const rolesMap = new Map<number, "system" | "assistant">([
	[SYSTEM_USER_ID, "system"],
	[me.id, "assistant"]
])

const namesMap = new Map([
	[SYSTEM_USER_ID, SYSTEM_NAME],
	[me.id, me.first_name]
])

export const errorMessage = (error: any) => {
	let message = ''

	try {
		message = typeof error === "string"
			? error
			: error instanceof Error || "message" in error
				? error.message as string
				: "toString" in error
					? error.toString() as string
					: JSON.stringify(error) !== "{}"
						? JSON.stringify(error)
						: `${error}`
	} catch {
		message = `${error}`
	}

	return message
}

type UserReference = {
	userRef: string
	userId?: number
	parse_mode: ParseMode | undefined
}

export const getUserReference = (user: MyContext["from"]): UserReference => !user
	? { userRef: "An anonymous user", parse_mode: undefined }
	: user.username
		? {
				userRef: `@${user.username}`,
				parse_mode: undefined,
				userId: user.id
			}
		: {
				userRef: `<a href="tg://user?id=${user.id}">${user.first_name}</a>`,
				parse_mode: "HTML",
				userId: user.id
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
	user_id: SYSTEM_USER_ID,
	message: SUMMARY_PROMPT,
	type: "text",
	date: Date(),
	tokens: getTokens(SUMMARY_PROMPT),
}

const SUMMARY_CHAT_MESSAGE = convertToChatMessages(
	[SUMMARY_MESSAGE], true, "empathy"
)[1]

export const summarize = async (ctx: MyContext) => {
	const summaryMessage = await askAssistant(
		ctx, SUMMARY_PROMPT, true
	)

	ctx.chatSession.messages.at(-1)!.checkpoint = true

	return summaryMessage
}

type Messages = {
	messages: Message[]
	chatMessages: MyChatCompletionRequestMessage[]
}

export const getMessagesFromLastCheckpoint = async (ctx: MyContext): Promise<Messages> => {
	const messages = [ ...ctx.chatSession.messages ]
	let i = findLastIndex(messages, message => !!message.checkpoint)
	let messagesFromLastCheckpoint = messages.slice(Math.max(i, 0))

	const chatIsPrivate = ctx.chat?.type === "private"
	const { isEmpathyRequestGroup } = ctx.chatSession
	let chatMessages = convertToChatMessages(
		messagesFromLastCheckpoint,
		chatIsPrivate,
		chatIsPrivate ? "empathy" : isEmpathyRequestGroup ? "empathy_from_group" : "translation",
		ctx.chatSession,
	)

	const lastMessages = needsNewCheckPoint(
		messagesFromLastCheckpoint, chatMessages
	)

	if (lastMessages.length) {
		ctx.chatSession.messages = messagesFromLastCheckpoint
		await summarize(ctx)
		ctx.chatSession.messages.push(...lastMessages)
		ctx.chatSession.messages = [
			...messages.slice(0, i),
			...ctx.chatSession.messages
		]

		return getMessagesFromLastCheckpoint(ctx)
	}

	return { messages: messagesFromLastCheckpoint, chatMessages }
}

export function convertToChatMessages(messages: Message[], excludeNames: boolean, request: IntroData["request"] = "translation", chatSession?: ChatSession) {
	const allNames = new Set(chatSession?.allMemberNames ?? [])

	const chatMessages: MyChatCompletionRequestMessage[] = messages.map(msg => {
		const { user_id, message } = msg
		const name = chatSession?.getName(user_id)
			?? namesMap.get(user_id)
			?? `User ${user_id}`

		const role = rolesMap.get(user_id) ?? "user"
		const prefix = excludeNames || role !== "user" ? "" : `${name}: `
		const content = `${prefix}${message}`
		const tokens = getTokens(`\n\n${role}: ${content}\n`)

		return { role, content, tokens }
	})

	const systemPrompt = getSystemPrompt(
		{
			request,
			names: [ ...allNames ],
			missingMemberCount: chatSession?.missingGroupMemberCount,
		},
	)

	chatMessages.unshift({
		role: "system",
		content: systemPrompt,
		tokens: getTokens(`\n\nsystem: ${systemPrompt}\n`),
	})

	return chatMessages
}

export const getTokenCount = (chatMessages: MyChatCompletionRequestMessage[]) => {
	const tokenCount = chatMessages.reduce(
		(sum, msg) => sum + msg.tokens,
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

	return lastMessages
}

export async function getAssistantResponse(ctx: MyContext, saveInSession = ctx.chatSession?.storeMessages ?? true, temperature = 0.9) {
	const { chatMessages } = await getMessagesFromLastCheckpoint(ctx)

	let resetCreditsTo = -1
	if (ctx.chatSession.isEmpathyRequestGroup) {
		resetCreditsTo = ctx.userSession.credits.used
	}

	// const moderationResult = await moderate(chatMessages.at(-1)!.content)
	// ctx.userSession.credits.used += chatMessages.at(-1)!.tokens
	
	// if (moderationResult) {
	// 	ctx.chatSession.messages.pop()

	// 	throw oneLineCommaListsAnd`
	// 		Your message was flagged by OpenAI for ${moderationResult}.
	// 		Please try to rephrase your message. 🙏
	// 	`
	// }

	const estimatedPromptTokenCount = getTokenCount(chatMessages)
	// log(`estimatedPromptTokenCount: ${estimatedPromptTokenCount}`)

	const chatRequestOpts: CreateChatCompletionRequest = {
		model: "gpt-3.5-turbo",
		temperature,
		messages: chatMessages.map(msg => ({
			role: msg.role,
			content: msg.content,
		})),

		// this 4 * 6 is an arbitrary number,
		// because I don't know yet how to calculate the
		// correct / precise number for `estimatedPromptTokenCount`.
		// Sometimes it's higher than it should be, sometimes lower.
		// And I don't know why. But whenever it's lower than it should be,
		// then there's a chance that the API will return an error.
		// Saying that I'm asking for too many tokens.
		// So I'm adding a buffer of 4 * 6 tokens,
		// because that seems to help most of the time.
		// But it still doesn't guarantee that the API won't return an error.
		max_tokens: MAX_TOKENS - estimatedPromptTokenCount - 4 * 6,
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
		log(`messages.length: ${chatMessages.length}`)

		const errorText = await chatResponse.json()
			.then(({ error }) => error.message as string)
			.catch(() => chatResponse.text())
			.catch(() => OPENAI_OVERLOADED_MESSAGE)
		
		log(`OpenAI error: ${errorText}`)

		throw errorText || OPENAI_OVERLOADED_MESSAGE
	}

	const completionResponse = await chatResponse.json() as CreateChatCompletionResponse
	const assistantMessage = completionResponse.choices[0]?.message
	const finishReason = completionResponse.choices[0]?.finish_reason

	const actualPromptTokenCount = completionResponse.usage!.prompt_tokens
	// log("actual prompt token count:", actualPromptTokenCount)
	const errorPerMessage = (actualPromptTokenCount - estimatedPromptTokenCount) / chatMessages.length
	// log("error per message:", errorPerMessage)
	const { averageTokenErrorPerMessage, requests } = ctx.userSession

	const newAverageTokenErrorPerMessage =
		(averageTokenErrorPerMessage * requests + errorPerMessage) / (requests + 1)

	ctx.userSession.averageTokenErrorPerMessage = newAverageTokenErrorPerMessage
	ctx.userSession.requests++

	ctx.userSession.credits.used = Math.max(
		ctx.userSession.credits.used,
		completionResponse.usage?.prompt_tokens
		?? estimatedPromptTokenCount
	)

	ctx.userSession.credits.used += completionResponse.usage?.total_tokens
		?? ctx.userSession.credits.used + getTokens(assistantMessage?.content)

	if (resetCreditsTo !== -1) {
		ctx.userSession.credits.used = resetCreditsTo
	}

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
		ctx.chatSession.addMessage({
			message: content,
			tokens: completionResponse.usage?.completion_tokens,
		})
	}

	return content
}

export const askAssistant = async (ctx: MyContext, question: string, saveInSession = false) => {
	ctx.chatSession.addMessage({
		user_id: 0, // 0 = system
		message: question,
	})

	log(`Asking assistant: ${question}`)
	const answer = await getAssistantResponse(ctx, saveInSession, 0.2)
		.then(answer => {
			log(`Assistant answered: ${answer}`)
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