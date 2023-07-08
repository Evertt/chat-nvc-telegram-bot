import { NamedMessage as Message } from "../context.ts"
import { SYSTEM_NAME, SUMMARY_PROMPT } from "../constants.ts"
import { Assistant } from "./assistant.ts"
import { encode } from "npm:gpt-3-encoder@1.1.4"
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from "npm:openai@3.3.0"
import { me } from "../me.ts"
// import { makeSummaryMessage, needsNewCheckPoint } from "./common.ts"

export class GPT_3_5 extends Assistant {
  readonly MAX_TOKENS = 4096
  readonly TOKENS_LEFT_FOR_SUMMARY = this.MAX_TOKENS / 8

  readonly rolesMap = new Map<string, "system" | "assistant">([
    [SYSTEM_NAME, "system"],
    [me.first_name, "assistant"],
  ])

  constructor(apiKey: string) {
    super(apiKey)
  }

  countTokens(input?: string): number {
    return encode(input || "").length
  }

  calcPromptTokens(messages: Message[]) {
    const names = new Set(messages.map(message => message.name))
    names.delete(me.first_name)
    names.delete(SYSTEM_NAME)

    const excludeNames = names.size < 2
    return messages.map(msg => {
      const { name, message } = msg
      const isUser = names.has(name)
      const role = this.rolesMap.get(name) || "user"
      const prefix = excludeNames || !isUser ? "" : `${name}: `
      const content = `${prefix}${message}`
      return {
        ...msg,
        role,
        content,
        tokens: this.countTokens(`\n\n${role}: ${content}\n`),
      }
    })
  }

  async queryAssistant(messages: Message[], query: string) {
    return await ""
  }

  async getNextResponse(messages: Message[]): Promise<string> {
    // const messagesCopy = [ ...messages ]
    const promptMessages = this.calcPromptTokens(messages)
    const lastMessages = this.needsNewCheckPoint({
      messages, chatMessages: promptMessages
    })

    if (lastMessages.length) {
      await this.addSummary(messages)
      messages.push(...lastMessages)
      return this.getNextResponse(messages)
    }

    return ""
  }

  async moderate(input: string) {
    const moderationRes = await fetch("https://api.openai.com/v1/moderations", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
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
}
