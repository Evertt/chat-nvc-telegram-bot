import { GPTAssistant } from "./gpt.ts"

// type ExtractGPT<T extends string> = T extends `gpt-${infer R}` ? `gpt-${R}` : never
// type GPTModel = ExtractGPT<TiktokenModel>

// class TokenCounter {
//   readonly model: GPTModel
//   readonly #tik: Tiktoken

//   constructor(model: GPTModel) {
//     this.model = model

//     this.#tik = tiktoken.encoding_for_model(model, {
//       "<|im_start|>": 100264,
//       "<|im_end|>": 100265,
//       "<|im_sep|>": 100266,
//     })
//   }

//   count(tokens?: string | Message[]): number {
//     return this.encode(tokens).length
//   }

//   encode(input?: string | Message[]): Uint32Array {
//     if (input == null) return new Uint32Array()

//     if (typeof input === "string")
//       return this.#tik.encode(input, "all", [])
    
//     const chatMessages: ChatCompletionRequestMessage[] =
//       input.map(({ role, content, name }) =>
//         ({ role, content, name })
//       )

//     return this.encode(this.getChatGPTEncoding(chatMessages))
//   }

//   getChatGPTEncoding(
//     messages: ChatCompletionRequestMessage[],
//   ) {
//     const isGpt3 = this.model.startsWith("gpt-3.5");
  
//     const msgSep = isGpt3 ? "\n" : "";
//     const roleSep = isGpt3 ? "\n" : "<|im_sep|>";
  
//     return [
//       messages
//         .map(({ name = "", role, content = "" }) => {
//           if ([SYSTEM_NAME, me.first_name].includes(name)) name = ""

//           return `<|im_start|>${name || role}${roleSep}${content}<|im_end|>`;
//         })
//         .join(msgSep),
//       `<|im_start|>assistant${roleSep}`,
//     ].join(msgSep);
//   }
// }

export class GPT_3_5 extends GPTAssistant {
  readonly MAX_TOKENS = 4e3
  readonly TOKENS_LEFT_FOR_SUMMARY = this.MAX_TOKENS / 8

  get wholesaleCostPerCredit() {
    return 1 / 5e5
  }

  // readonly #tokenCounter: TokenCounter

  constructor() {
    super("gpt-3.5-turbo")
    // this.#tokenCounter = new TokenCounter("gpt-3.5-turbo")
  }

  // countTokens(input?: string | Message[]): number {
  //   return this.#tokenCounter.count(input)
  // }

  // getExtraTokensForChatMessage(message: Message) {
  //   return [SYSTEM_NAME, BOT_NAME].includes(message.name)
  //     ? 5 // By default, every message gets 5 tokens added, for the name and boundaries
  //     : 4 + this.countTokens(message.name) // 4 tokens for the boundaries and then however many tokens the name is
  // }

  // async queryAssistant(messages: Message[], query: string) {
  //   return await ""
  // }

  // async getNextResponse(messages: Message[]): Promise<string> {
  //   const lastMessages = this.needsNewCheckPoint(messages)

  //   if (lastMessages.length) {
  //     await this.addSummary(messages)
  //     messages.push(...lastMessages)
  //     return this.getNextResponse(messages)
  //   }

  //   return ""
  // }
}
