import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Assistant } from "./assistant.ts"
import type { ChatSession, Message, MyContext } from "../context.ts"
import tiktoken, { type TiktokenModel } from "npm:tiktoken@1.0.10"
import type { ChatCompletionRequestMessage, CreateChatCompletionRequest, CreateChatCompletionResponse, CreateModerationResponse } from "npm:openai@3.3.0"
import { SYSTEM_NAME, BOT_NAME } from "../constants.ts"
import { debug, type Debug } from "https://deno.land/x/debug@0.2.0/mod.ts"
import { OPENAI_OVERLOADED_MESSAGE } from "../error-messages.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { findLastIndex, memoize } from "npm:lodash-es@4.17.21"
import { getSystemPrompt } from "../system-prompt.ts"
import { slugify as ogSlugify } from "https://deno.land/x/slugify@0.3.0/mod.ts"

const slugify = memoize(ogSlugify)

const { OPENAI_KEY } = Deno.env.toObject()

type ExtractGPT<T extends string> = T extends `gpt-${infer R}` ? `gpt-${R}` : never
type GPTModel = ExtractGPT<TiktokenModel>
type MaybeArray<T> = T | T[]
type SubChatMessage = Pick<ChatCompletionRequestMessage, "role" | "content" | "name">

function getChatGPTEncoding(
  messages: MaybeArray<SubChatMessage>,
  model: GPTModel
) {
  const isGpt3 = model.startsWith("gpt-3.5")

  const msgSep = isGpt3 ? "\n" : ""
  const roleSep = isGpt3 ? "\n" : "<|im_sep|>"

  let mapped: string = [messages]
    .flatMap(m => m)
    .map(({ name = "", role, content = "" }) => {
      if ([SYSTEM_NAME, BOT_NAME].includes(name)) name = ""

      return `<|im_start|>${name || role}${roleSep}${content}<|im_end|>`;
    })
    .join(msgSep)
  
  if (Array.isArray(messages)) mapped = [
    mapped,
    `<|im_start|>assistant${roleSep}`,
  ].join(msgSep)

  return mapped
}

const specialTokens = {
  "<|im_start|>": 100264,
  "<|im_end|>": 100265,
  "<|im_sep|>": 100266,
} as const

export abstract class GPTAssistant extends Assistant {
  log: Debug

  constructor(protected readonly model: GPTModel) {
    super(OPENAI_KEY)
    this.log = debug(`assistant:${model}`)
    // this.#tokenCounter = new TokenCounter("gpt-3.5-turbo")
  }

  countTokens(input?: string | SubChatMessage | SubChatMessage[]): number {
    if (input == null) return 0

    const tik = tiktoken.encoding_for_model(this.model, specialTokens)

    if (typeof input !== "string") {
      input = getChatGPTEncoding(input, this.model)
    }

    const encoded = tik.encode(input, Object.keys(specialTokens))
    tik.free()

    return encoded.length
  }

  getSystemPrompt(chatSession: ChatSession) {
    const names = chatSession.allMemberNames
    const chatIsPrivate = chatSession.type === "private"
    const { isEmpathyRequestGroup } = chatSession
    const request = chatIsPrivate
      ? "empathy"
      : isEmpathyRequestGroup
        ? "empathy_from_group"
        : "translation"
  
    const systemPrompt = getSystemPrompt({
      names,
      request,
      missingMemberCount: chatSession.missingGroupMemberCount,
    })
  
    return {
      type: "text",
      role: "system",
      name: SYSTEM_NAME,
      content: systemPrompt,
      get date() {
        return Date()
      },
      tokens: this.countTokens(systemPrompt),
    } as Message
  }

  async getMessagesFromLastCheckpoint(ctx: MyContext): Promise<Message[]> {
    const messages = [ ...ctx.chatSession.messages ]
    const i = findLastIndex(messages, message => !!message.checkpoint)
    const messagesFromLastCheckpoint = messages.slice(Math.max(i, 0))
  
    const systemMessage = this.getSystemPrompt(ctx.chatSession)
    if (systemMessage.content.slice(0, 100) !== messagesFromLastCheckpoint[0]?.content.slice(0, 100)) {
      messagesFromLastCheckpoint.unshift(systemMessage)
    }
  
    const lastMessages = this.needsNewCheckPoint(messagesFromLastCheckpoint)
  
    if (lastMessages.length) {
      ctx.chatSession.messages = messagesFromLastCheckpoint.slice(1)
      await this.summarize(ctx)
      ctx.chatSession.messages.push(...lastMessages)
      ctx.chatSession.messages = [
        ...messages.slice(0, i),
        ...ctx.chatSession.messages
      ]
  
      return this.getMessagesFromLastCheckpoint(ctx)
    }
  
    return messagesFromLastCheckpoint
  }

  async queryAssistant(ctx: MyContext, question: string, saveInSession = false) {
    ctx.chatSession.addMessage({
      name: SYSTEM_NAME,
      content: question,
    })
  
    this.log(`Asking assistant: ${question}`)
    const answer = await this.getNextResponse(ctx, saveInSession, 0.2)
      .then(answer => {
        this.log(`Assistant answered: ${answer}`)
        return answer
      })
      .catch((errorAnswer: string) => {
        console.error("Error response:", errorAnswer)
        return errorAnswer
      })
  
    return answer
  }

  async getNextResponse(ctx: MyContext, saveInSession = ctx.chatSession?.storeMessages ?? true, temperature = 0.9) {
    const messages = await this.getMessagesFromLastCheckpoint(ctx)
  
    let resetCreditsTo = -1
    if (ctx.chatSession.isEmpathyRequestGroup) {
      resetCreditsTo = ctx.userSession.credits.used
    }
  
    // const moderationResult = await moderate(chatMessages.at(-1)!.content || "")
    // ctx.userSession.credits.used += chatMessages.at(-1)!.tokens
    
    // if (moderationResult) {
    //   ctx.chatSession.messages.pop()
  
    //   throw oneLineCommaListsAnd`
    //     Your message was flagged by OpenAI for ${moderationResult}.
    //     Please try to rephrase your message. 🙏
    //   `
    // }
  
    const estimatedPromptTokenCount = this.countTokens(messages)
    // log(`estimatedPromptTokenCount: ${estimatedPromptTokenCount}`)
  
    const chatRequestOpts: CreateChatCompletionRequest = {
      model: this.model,
      temperature,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        name: slugify(msg.name.slice(0, 64), {
          replacement: "_",
          remove: /[^a-zA-Z0-9 _-]/,
        }) || undefined,
      })),
      max_tokens: this.MAX_TOKENS - estimatedPromptTokenCount,
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
      this.log(`messages.length: ${messages.length}`)
  
      const errorText = await chatResponse.json()
        .then(({ error }) => error.message as string)
        .catch(() => chatResponse.text())
        .catch(() => OPENAI_OVERLOADED_MESSAGE)
      
      this.log(`OpenAI error: ${errorText}`)
  
      throw errorText || OPENAI_OVERLOADED_MESSAGE
    }
  
    const completionResponse = await chatResponse.json() as CreateChatCompletionResponse
    const assistantMessage = completionResponse.choices[0]?.message
    const finishReason = completionResponse.choices[0]?.finish_reason
  
    // TODO: figure out what to do when `completionResponse.usage` is actually undefined
    const actualPromptTokenCount = completionResponse.usage?.prompt_tokens ?? estimatedPromptTokenCount
    // log("actual prompt token count:", actualPromptTokenCount)
    const errorPerMessage = (actualPromptTokenCount - estimatedPromptTokenCount) / messages.length
    this.log("error per message: %s", errorPerMessage)
    const { averageTokenErrorPerMessage, requests } = ctx.userSession
  
    const newAverageTokenErrorPerMessage =
      (averageTokenErrorPerMessage * requests + errorPerMessage) / (requests + 1)
  
    ctx.userSession.averageTokenErrorPerMessage = newAverageTokenErrorPerMessage
    ctx.userSession.requests++
  
    ctx.userSession.credits.used = Math.max(
      ctx.userSession.credits.used,
      actualPromptTokenCount,
    )
  
    ctx.userSession.credits.used += completionResponse.usage?.total_tokens
      ?? ctx.userSession.credits.used + this.countTokens(assistantMessage?.content)
  
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
  
    if (!assistantMessage || !assistantMessage.content) {
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
        content,
        tokens: this.countTokens(content),
      })
    }
  
    return content
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