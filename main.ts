// deno-lint-ignore-file no-explicit-any
import "npm:redis@4.6.5"
import ffmpeg from 'npm:fluent-ffmpeg@2.1.2'

import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { connect } from "https://deno.land/x/redis@v0.29.2/mod.ts"
import { Telegraf, session, type Context } from "npm:telegraf@4.12.2"

import { Writable } from "node:stream"
import { Buffer } from "node:buffer"
import { Redis } from 'npm:@telegraf/session@2.0.0-beta.6/redis'
import type { Update } from "npm:telegraf@4.12.2/types"
import { oneLine, oneLineCommaListsAnd } from 'npm:common-tags@1.8.2'
import { message } from 'npm:telegraf@4.12.2/filters'
import { getSystemPrompt } from './handleAnswers.ts'
import type {
	CreateModerationResponse,
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	ChatCompletionRequestMessage,
} from 'npm:openai@3.2.1'

const {
  OPENAI_KEY,
  TELEGRAM_KEY,
  TELEGRAM_WEBBOOK_TOKEN,
  DOMAIN = '',
  PORT,
  REDIS_USERNAME,
  REDIS_PASSWORD,
} = Deno.env.toObject()

interface Message {
	name: string
	message: string
	timestamp: number
	type: 'text' | 'voice'
}

interface Session {
	messages: Message[]
}

interface ContextWithSession <U extends Update = Update> extends Context<U> {
	session: Session,
}

const BOT_NAME = 'ChatNVC'

console.log('Instantiating Telegraf bot...')
const bot = new Telegraf<ContextWithSession>(TELEGRAM_KEY, {
	telegram: { webhookReply: false }
})

const redis = await connect({
  hostname: "redis-13943.c251.east-us-mz.azure.cloud.redislabs.com",
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
  port: 13943,
})

console.log('Instantiating Redis store...')
const store = Redis<Session>({ client: redis as any })

console.log('Setting up the bot with a session using the Redis store...')
bot.use(session({
	store,
	defaultSession: () => ({
		messages: [] as Message[]
	})
}))
console.log('Bot set up.')

const convertOggOpusToWebm = async (opusAudioData: Buffer | ArrayBuffer) => {
  const buffer = opusAudioData instanceof Buffer
    ? opusAudioData : Buffer.from(opusAudioData)

  const chunks: BlobPart[] = []

  const filename = await Deno.makeTempFile({ suffix: '.ogg' })
  await Deno.writeFile(filename, buffer)

	const writable = new Writable({
    write(chunk, _, callback) {
      chunks.push(chunk)
      callback()
    }
  })

  return new Promise<Blob>((resolve, reject) => {
    ffmpeg(filename)
			.format('webm')
			.noVideo()
      .withAudioCodec('copy')
      .on('end', function (err: Error) {
        if (!err) {
          console.log('audio conversion Done')

          resolve(new Blob(chunks, { type: 'audio/webm' }))
        }
      })
      .on('error', function (err: Error) {
        console.log('audio conversion error:', err)
        reject(err)
      })
      .output(writable)
      .run()
  })
  .finally(() => {
    Deno.remove(filename)
  })
}

bot.start(async ctx => {
	console.log('start command')

	if (ctx.chat.type !== 'private')
		return ctx.reply('Please write to me in a private chat 🙏')

	const greeting = `Hi ${ctx.from.first_name}, what would you like empathy for today?`

	console.log('Resetting session to start with greeting.')
	ctx.session.messages = [
		{
			type: 'text',
			name: BOT_NAME,
			message: greeting,
			timestamp: Date.now()
		}
	]

	console.log('Sending greeting.')
	await ctx.reply(greeting)
	console.log('Greeting sent.')
})

bot.help(ctx => ctx.reply(oneLine`
	I'm ChatNVC, a bot that tries to listen to you empathically.
	You can make me forget our conversation by typing /start,
  in case you want to start fresh.
`))

const moderate = async (input: string) => {
	const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${OPENAI_KEY}`
		},
		method: 'POST',
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

const sleep = (ms: number) => new Promise<string>(
	resolve => setTimeout(() => resolve('timeout'), ms)
)

const repeat = (fn: () => Promise<any>, ms: number) => {
	let stop = false

	const innerFn = async () => {
		while (!stop) {
			await fn()
			await sleep(ms)
		}
	}

	innerFn()

	return () => stop = true
}

const getReply = async (messages: Message[], name: string, text: string, type: 'text' | 'voice') => {
	console.log('Generating reply to:', text)

	let moderationResult = await moderate(text)
	if (moderationResult) return oneLineCommaListsAnd`
		Your message was flagged by OpenAI for ${moderationResult}.
		Please try to rephrase your message. 🙏
	`

	messages.push({
		type,
		name: name,
		message: text,
		timestamp: Date.now()
	})
	
	const chatMessages: ChatCompletionRequestMessage[] = messages.map(msg => (
		{ role: msg.name === BOT_NAME ? 'assistant' : 'user', content: msg.message }
	))

	const systemPrompt = getSystemPrompt({
		request: 'empathy',
		names: [name],
	})

	chatMessages.unshift({ role: 'system', content: systemPrompt })

	const chatRequestOpts: CreateChatCompletionRequest = {
		model: 'gpt-3.5-turbo',
		temperature: 0.9,
		messages: chatMessages,
	}

	const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
		headers: {
			Authorization: `Bearer ${OPENAI_KEY}`,
			'Content-Type': 'application/json'
		},
		method: 'POST',
		body: JSON.stringify(chatRequestOpts)
	})

	if (!chatResponse.ok) {
		const err = await chatResponse.text()
		throw new Error(err)
	}

	const completionResponse: CreateChatCompletionResponse = await chatResponse.json()
	
	const assistantResponse = completionResponse.choices[0]?.message?.content ?? ''

	if (assistantResponse === '') {
		throw new Error('OpenAI returned an empty response')
	}

	moderationResult = await moderate(assistantResponse)
	if (moderationResult) return oneLine`
		Sorry, I was about to say something potentially inappropriate.
		I don't know what happened.
		Could you maybe try to rephrase your last message differently?
		That might help me to formulate a more appropriate response.
		Thank you. 🙏
	`

	messages.push({
		type: 'text',
		name: BOT_NAME,
		message: assistantResponse,
		timestamp: Date.now()
	})

	return assistantResponse
}

bot.on(message('text'), async ctx => {
	if (ctx.chat.type !== 'private') return

	const stopTyping = repeat(
		() => ctx.sendChatAction('typing'),
		5100
	)

	const handleError = (error: any) => {
		console.log("Reply error:", error)
	
		ctx.reply(oneLine`
			Something went wrong. It's possible that OpenAI's servers are overloaded.
			Please try again in a few seconds or minutes. 🙏
		`)
	}

	await getReply(ctx.session.messages, ctx.from.first_name, ctx.message.text, 'text')
		.then(reply => ctx.replyWithHTML(reply))
    .catch(handleError)
    .finally(stopTyping)
})

bot.on(message('voice'), async ctx => {
	if (ctx.chat.type !== 'private') return

	const stopTyping = repeat(
		() => ctx.sendChatAction('typing'),
		5100
	)

	const voiceLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id)
  const randomFilename = Math.random().toString(36).substring(2)
	const filePath = `${randomFilename}.webm`

	const voiceRespFile = await fetch(voiceLink)
	const voiceOggBuffer = await voiceRespFile.arrayBuffer()
	const voiceWebmBlob = await convertOggOpusToWebm(voiceOggBuffer)

	const formData = new FormData()
	formData.append('model', 'whisper-1')
	formData.append('response_format', 'text')
  formData.append('file', voiceWebmBlob, filePath)

	const transcriptionResponse = await fetch(
		'https://api.openai.com/v1/audio/transcriptions',
		{
			headers: {
				Authorization: `Bearer ${OPENAI_KEY}`,
			},
			method: 'POST',
			body: formData
		}
	)

	const transcription = await transcriptionResponse.text()

	await ctx.replyWithHTML(oneLine`
		Thanks for sharing. I just want to share
		my transcription of your voice message,
		just so that you can check if I heard you correctly:
	` + `<i>${transcription}</i>`)

	const replyStub = await ctx.reply(oneLine`
		Now I'm going to process what you said, give me a sec...
	`)

	await getReply(ctx.session.messages, ctx.from.first_name, transcription, 'voice')
		.then(reply =>
			ctx.telegram.editMessageText(
				ctx.chat.id,
				replyStub.message_id,
				undefined,
				reply,
				{ parse_mode: 'HTML' }
			)
		)
		.catch(error => {
			console.log("Error:", error)

			return ctx.telegram.editMessageText(
				ctx.chat.id,
				replyStub.message_id,
				undefined,
				oneLine`
					Something went wrong. It's possible that OpenAI's servers are overloaded.
					Please try again in a few seconds or minutes. 🙏
				`,
			)
		})
		.finally(stopTyping)
})

const webhook: Telegraf.LaunchOptions["webhook"] = DOMAIN
  ? {
      domain: DOMAIN,
      port: +PORT,
      hookPath: '/',
      secretToken: TELEGRAM_WEBBOOK_TOKEN,
    }
  : undefined

// Enable graceful stop
Deno.addSignalListener('SIGINT', () => {
  bot.stop('SIGINT')
  Deno.exit()
})

Deno.addSignalListener('SIGTERM', () => {
  bot.stop('SIGTERM')
  Deno.exit()
})

await bot.launch({ webhook })
