import { Message } from "../context.ts"
import { SYSTEM_NAME, SUMMARY_PROMPT, MAKE_SUMMARY_MESSAGE } from "../constants.ts"

type TokenCounter = (input?: string) => number

type CalcCheckPointArgs = {
  messages: Message[]
  chatMessages: Message[]
}

export abstract class Assistant {
  abstract readonly MAX_TOKENS: number
  abstract readonly TOKENS_LEFT_FOR_SUMMARY: number
  abstract getExtraTokensForChatMessage(message: Message): number

  get MAX_PROMPT_TOKENS() {
    return this.MAX_TOKENS - this.TOKENS_LEFT_FOR_SUMMARY
  }

  private static makeSummaryMessage(tokenCounter: TokenCounter): Message {
    return {
      role: "system",
      name: SYSTEM_NAME,
      content: SUMMARY_PROMPT,
      type: "text",
      date: Date(),
      tokens: tokenCounter(SUMMARY_PROMPT),
    }
  }

  readonly SUMMARY_MESSAGE = Assistant.makeSummaryMessage(this.countTokens.bind(this))
  readonly SUMMARY_CHAT_MESSAGE = {
    ...this.SUMMARY_MESSAGE,
    tokens: this.SUMMARY_MESSAGE.tokens + this.getExtraTokensForChatMessage(this.SUMMARY_MESSAGE),
  }

  constructor(protected apiKey: string) {}

  abstract countTokens(input?: string | Message[]): number
  abstract getNextResponse(messages: Message[]): Promise<string>
  abstract queryAssistant(messages: Message[], query: string): Promise<string>

  protected needsNewCheckPoint(messages: Message[]) {
    let tokenCount = messages.reduce((sum, msg) =>
      sum + msg.tokens + this.getExtraTokensForChatMessage(msg),
      0
    )
    if (tokenCount < this.MAX_PROMPT_TOKENS) return []
    tokenCount += this.SUMMARY_CHAT_MESSAGE.tokens
    const lastMessages: Message[] = []
  
    while (tokenCount >= this.MAX_PROMPT_TOKENS && messages.length) {
      // I thought this should actually be .push() instead of .unshift()
      // but apparently .push() retults in lastMessages being in the reversed order.
      const deletedMessage = messages.pop()!
      lastMessages.unshift(deletedMessage)
      tokenCount -= deletedMessage.tokens
        + this.getExtraTokensForChatMessage(deletedMessage)
    }
    
    if (tokenCount >= this.MAX_PROMPT_TOKENS)
      throw new Error("Messages too long to summarize")
  
    return lastMessages
  }

  protected async addSummary(messages: Message[]) {
    const summaryMessage = await this.queryAssistant(messages, SUMMARY_PROMPT)
  
    messages.push({
      role: "system",
      name: SYSTEM_NAME,
      content: summaryMessage,
      type: "text",
      date: Date(),
      tokens: this.countTokens(summaryMessage),
      checkpoint: true,
    })
  }
}
