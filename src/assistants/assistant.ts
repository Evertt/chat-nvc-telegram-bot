import type { MyContext, Message } from "../context.ts"
import { SUMMARY_PROMPT, MAKE_SUMMARY_MESSAGE, MARKUP } from "../constants.ts"

export abstract class Assistant {
  abstract readonly MAX_TOKENS: number
  abstract readonly TOKENS_LEFT_FOR_SUMMARY: number

  abstract readonly wholesaleCostPerCredit: number
  
  get retailPricePerCredit() {
    return this.wholesaleCostPerCredit * (1 + MARKUP)
  }

  wholesaleCostForCredits(tokens: number) {
    return tokens * this.wholesaleCostPerCredit
  }

  retailPriceForCredits(tokens: number) {
    return tokens * this.retailPricePerCredit
  }

  // abstract getExtraTokesForChatMessage(message: Message): number

  get MAX_PROMPT_TOKENS() {
    return this.MAX_TOKENS - this.TOKENS_LEFT_FOR_SUMMARY
  }

  get SUMMARY_MESSAGE() {
    return MAKE_SUMMARY_MESSAGE(this.countTokens.bind(this))
  }

  constructor(protected apiKey: string) {}

  abstract countTokens(input?: string | Message | Message[]): number
  abstract getNextResponse(ctx: MyContext, saveInSession?: boolean, temperature?: number): Promise<string>
  abstract queryAssistant(ctx: MyContext, question: string, saveInSession?: boolean): Promise<string>

  protected needsNewCheckPoint(messages: Message[]) {
    let tokenCount = this.countTokens(messages)
    if (tokenCount < this.MAX_PROMPT_TOKENS) return []
    tokenCount += this.countTokens(this.SUMMARY_MESSAGE)
    const lastMessages: Message[] = []
  
    while (tokenCount >= this.MAX_PROMPT_TOKENS && messages.length) {
      // I thought this should actually be .push() instead of .unshift()
      // but apparently .push() retults in lastMessages being in the reversed order.
      const deletedMessage = messages.pop()!
      lastMessages.unshift(deletedMessage)
      tokenCount -= this.countTokens(deletedMessage)
    }
    
    if (tokenCount >= this.MAX_PROMPT_TOKENS)
      throw new Error("Messages too long to summarize")
  
    return lastMessages
  }

  protected async summarize(ctx: MyContext) {
    const summaryMessage = await this.queryAssistant(
      ctx, SUMMARY_PROMPT, true
    )
  
    ctx.chatSession.messages.at(-1)!.checkpoint = true
  
    return summaryMessage
  }
}
