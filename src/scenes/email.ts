// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { bot } from "../bot.ts"
import type { MyContext } from "../context.ts"
import { Scenes } from "npm:telegraf@4.12.3-canary.1"
import { message } from "npm:telegraf@4.12.3-canary.1/filters"
import { oneLine, stripIndents } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { type Modify, errorMessage } from "../utils.ts"
import { SMTPClient, type SendConfig } from "https://deno.land/x/denomailer@1.6.0/mod.ts"
import { delay } from "https://deno.land/std@0.184.0/async/delay.ts"
import { EMAIL_SCENE_ID } from "../constants.ts"

const {
	DEBUG = "",
	EMAIL_HOST,
	EMAIL_USERNAME,
	EMAIL_PASSWORD,
	EMAIL_PORT,
	DEVELOPER_CHAT_ID,
} = Deno.env.toObject()

type SceneState = {
  emailAddress?: string
}

type Session = MyContext["session"]
type SceneSessionData = Modify<Session["__scenes"], {
  state?: SceneState
}>
type NewSession = Modify<Session, {
  __scenes: SceneSessionData
}>

export type NewContext = Omit<MyContext, "scene">
  & Modify<MyContext, { session: NewSession }>
  & { scene: Scenes.SceneContextScene<NewContext, SceneSessionData> }

export const emailScene = new Scenes.BaseScene<NewContext>(EMAIL_SCENE_ID)

emailScene.enter(async ctx => {
  await bot.telegram.setMyCommands(
    [{ command: "stop", description: "Stop the email sending process." }],
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )

	await ctx.replyWithHTML(oneLine`
		Okay, I will send you an email with your chat history.
		Please write your email address.
  `)
})

type EmailHandlerConfig = SendConfig & {
	ctx: MyContext
	timeout?: number // ms
}

const emailHandler = async ({ ctx, timeout = 9_000, ...sendConfig }: EmailHandlerConfig) => {
	console.log("Sending email...", sendConfig)

	const smtpClient = new SMTPClient({
		connection: {
			hostname: EMAIL_HOST,
			port: +EMAIL_PORT,
			tls: true,
			auth: {
				username: EMAIL_USERNAME,
				password: EMAIL_PASSWORD,
			},
		},
		pool: {
			size: 1,
			timeout
		},
		debug: {
			log: !!DEBUG,
		}
	})

	await ctx.reply(oneLine`
		I just want to let you know that the email
		feature has been very unreliable,
		and I haven't yet figured out why.
		So I'm going to try to send you the email,
		but it might not work. I apologize for the inconvenience.
	`)

	const sendPromise = smtpClient.send(sendConfig)
		.then(async () => {
			console.log("Email sent, closing connection...")
		
			await ctx.reply(oneLine`
				Okay, I sent you an email with your chat history.
				Please check your inbox and / or spambox.
			`)

			return true
		})
		.catch(async error => {
			console.log("Error sending email, trying to notify developer")

			await ctx.telegram.sendMessage(DEVELOPER_CHAT_ID, stripIndents`
				A user tried to send themself an email, but it failed.
				Here's the error message:
				
				\`\`\`
				${errorMessage(error)}
				\`\`\`

				And here are the email addresses that were used:
				From: ${sendConfig.from}
				To: ${sendConfig.to}
			`, { parse_mode: "Markdown" })
			.catch(async (error: any) => {
				console.log("Error sending error message to developer.", error)

				await ctx.telegram.sendMessage(DEVELOPER_CHAT_ID, stripIndents`
					I tried to send you an error message about the email feature, but that failed too.
					Here's the last error message:

					${errorMessage(error)}
				`)

				return error
			})
			.then(
				async (error: any) => {
					console.log("Error sending email:", errorMessage(error))

					await ctx.reply(oneLine`
						Oh no, something went wrong while sending the email.
						My developer has been notified, and he will try to fix it as soon as possible.
					`)
				},
				async (error: any) => {
					console.log("Error both sending email AND error message:", errorMessage(error))

					await ctx.reply(oneLine`
						Oh no, something went wrong while sending the email.
						I tried to notify my developer, but that failed too.
						I apologize for the inconvenience.
					`)
				}
			)
			.catch((error: any) => {
				console.log(stripIndents`
					Everything that could go wrong
					with the email feature, did go wrong...
					Here's the latest error I was able to get:
				`, errorMessage(error))
			})
		})
		.finally(async () => {
			try {
				await smtpClient.close()
			} catch {
				// ignore
			}
		})

	const timeoutPromise = delay(timeout + 1000)
		.then(() => false)

	// Still using a race here, because this github issue
	// seems to suggest that the normal timeout doesn't always work:
	// @see https://github.com/EC-Nordbund/denomailer/issues/70
	return Promise.race([sendPromise, timeoutPromise])
		.then(async (success) => {
			if (success) return
			console.log("SMTP client couldn't timeout, so I'm closing it manually.")

			await ctx.telegram.sendMessage(DEVELOPER_CHAT_ID, stripIndents`
				The SMTP client didn't timeout, so I'm closing it manually.
			`)

			await ctx.reply(oneLine`
				Sorry, the email failed to send.
				I apologize for the inconvenience.
			`)
		})
		.catch(error => {
			console.log("Error while trying to send telegram messages.", errorMessage(error))
		})
		.finally(() => smtpClient.close())
		.catch(error => {
			console.log("Couldn't even close the SMTP client...", errorMessage(error))
		})
}

emailScene.action("stop", async ctx => {
	await ctx.reply("Okay, I won't send you an email.")
	return ctx.scene.leave()
})

emailScene.on(message("text"), async ctx => {
	if (ctx.chat.type !== "private") return

  if (!ctx.scene.state.emailAddress) {
    const emailEntity = ctx.message.entities?.find(
      entity => entity.type === "email"
    )

    if (!emailEntity) {
      return await ctx.reply(oneLine`
				I'm sorry, but I couldn't find a valid email
				address in that message. Please try again.
			`)
    }

    ctx.scene.state.emailAddress = ctx.message.text.slice(
      emailEntity.offset, emailEntity.offset + emailEntity.length
    )
  }

	await ctx.reply(oneLine`
		Okay, I'm preparing the email...
	`)

	const email = ctx.scene.state.emailAddress!

	const messages = "<h1>Your Chat History</h1>\n<p>" + ctx.chatSession.messages.map(
		msg => `<strong>${ctx.chatSession.getName(msg.user_id)}:</strong> ${msg.message}`
	).join("</p>\n<p>") + "</p>"

	await emailHandler({
		ctx,
		from: `ChatNVC <${EMAIL_USERNAME}>`,
		to: `${ctx.from!.first_name} <${email}>`,
		subject: "ChatNVC - Chat History",
		content: "auto",
		html: messages,
	})

	return ctx.scene.leave()
})

emailScene.leave(async ctx => {
  await bot.telegram.deleteMyCommands(
    { scope: { type: "chat", chat_id: ctx.chat!.id } }
  )
})
