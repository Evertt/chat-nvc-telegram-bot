import { NamedMessage as Message } from "../context.ts"
import { Assistant } from "./assistant.ts"

export class Claude extends Assistant {
  readonly MAX_TOKENS = 4096
  readonly TOKENS_LEFT_FOR_SUMMARY = this.MAX_TOKENS / 8

  constructor(apiKey: string) {
    super(apiKey)
  }

  countTokens(input?: string) {
    return 0
  }

  calcPromptTokens(messages: Message[]) {
    return [] as Message[]
  }

  async getNextResponse(messages: Message[]) {
    return ""
  }
}