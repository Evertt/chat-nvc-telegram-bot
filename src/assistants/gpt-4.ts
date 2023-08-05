import { GPTAssistant } from "./gpt.ts"

export class GPT_4 extends GPTAssistant {
  readonly MAX_TOKENS = 8e3
  readonly TOKENS_LEFT_FOR_SUMMARY = this.MAX_TOKENS / 8

  get wholesaleCostPerCredit() {
    return 30 / 5e5
  }

  constructor() {
    super("gpt-4")
  }
}
