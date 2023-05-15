import { NamedMessage as Message } from "../context.ts"
import { SYSTEM_NAME, SUMMARY_PROMPT } from "../constants.ts"
import { Assistant } from "./assistant.ts"

type TokenCounter = (input?: string) => number
type SummaryFactory = (tokenCounter: TokenCounter) => Message

export const makeSummaryMessage: SummaryFactory = tokenCounter => ({
  name: SYSTEM_NAME,
  message: SUMMARY_PROMPT,
  type: "text",
  get date() {
    return Date()
  },
  tokens: tokenCounter(SUMMARY_PROMPT),
})

type CalcCheckPointArgs = {
  messages: Message[]
  chatMessages: Message[]
  MAX_PROMPT_TOKENS: number
  SUMMARY_CHAT_MESSAGE: Message
}

export const needsNewCheckPoint = ({
  messages,
  chatMessages,
  MAX_PROMPT_TOKENS,
  SUMMARY_CHAT_MESSAGE,
}: CalcCheckPointArgs) => {
  let tokenCount = chatMessages.reduce((sum, msg) => sum + msg.tokens, 0)
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
