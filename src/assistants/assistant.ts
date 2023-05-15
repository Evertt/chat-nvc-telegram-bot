import { NamedMessage as Message } from "../context.ts"
import { SYSTEM_NAME, SUMMARY_PROMPT } from "../constants.ts"

type TokenCounter = (input?: string) => number

type CalcCheckPointArgs = {
  messages: Message[]
  chatMessages: Message[]
}

export abstract class Assistant {
  abstract readonly MAX_TOKENS: number
  abstract readonly TOKENS_LEFT_FOR_SUMMARY: number
  get MAX_PROMPT_TOKENS() {
    return this.MAX_TOKENS - this.TOKENS_LEFT_FOR_SUMMARY
  }

  private static makeSummaryMessage(tokenCounter: TokenCounter): Message {
    return {
      name: SYSTEM_NAME,
      message: SUMMARY_PROMPT,
      type: "text",
      get date() {
        return Date()
      },
      tokens: tokenCounter(SUMMARY_PROMPT),
    }
  }

  readonly SUMMARY_MESSAGE = Assistant.makeSummaryMessage(this.countTokens)
  readonly SUMMARY_CHAT_MESSAGE = this.calcPromptTokens([this.SUMMARY_MESSAGE])[0]

  constructor(protected apiKey: string) {}

  abstract countTokens(input?: string): number
  abstract calcPromptTokens(messages: Message[]): Message[]

  abstract getNextResponse(messages: Message[]): Promise<string>
  abstract queryAssistant(messages: Message[], query: string): Promise<string>

  protected needsNewCheckPoint({ messages, chatMessages }: CalcCheckPointArgs) {
    let tokenCount = chatMessages.reduce((sum, msg) => sum + msg.tokens, 0)
    if (tokenCount < this.MAX_PROMPT_TOKENS) return []
    tokenCount += this.SUMMARY_CHAT_MESSAGE.tokens
    const lastMessages: Message[] = []
  
    while (tokenCount >= this.MAX_PROMPT_TOKENS && messages.length) {
      // I thought this should actually be .push() instead of .unshift()
      // but apparently .push() retults in lastMessages being in the reversed order.
      lastMessages.unshift(messages.pop()!)
      const deletedMessage = chatMessages.pop()
      tokenCount -= deletedMessage!.tokens
    }
    
    if (tokenCount >= this.MAX_PROMPT_TOKENS)
      throw new Error("Messages too long to summarize")
  
    return lastMessages
  }

  protected async addSummary(messages: Message[]) {
    const summaryMessage = await this.queryAssistant(messages, SUMMARY_PROMPT)
  
    messages.push({
      name: SYSTEM_NAME,
      message: summaryMessage,
      type: "text",
      get date() {
        return Date()
      },
      tokens: this.countTokens(summaryMessage),
      checkpoint: true,
    })
  }
}
