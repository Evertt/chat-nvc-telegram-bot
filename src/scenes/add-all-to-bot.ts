import { Telegraf, Scenes } from "npm:telegraf@4.12.3-canary.1"
import type { MyContext } from "../context.ts"
import type {
  SceneSessionData,
  ContextWithMultiSession,
} from "../middleware/session/session.ts"
import { settingsScene } from "./settings.ts"
import { rolePlayScene } from "./role-play.ts"
import { feedbackScene } from "./feedback.ts"
import { buyCreditsScene } from "./buy-credits.ts"
import { welcomeScene } from "./welcome.ts"
import { emailScene } from "./email.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

export type ContextWithScene = ContextWithMultiSession & {
	scene: Scenes.SceneContextScene<ContextWithScene, SceneSessionData>
}

export const addScenesToBot = (bot: Telegraf<MyContext>) => {
  console.log("Setting up bot scenes...")

  const stage = new Scenes.Stage<MyContext>([
    settingsScene,
    rolePlayScene,
    feedbackScene,
    buyCreditsScene,
    welcomeScene,
    emailScene,
  ])
  
  bot.use(stage.middleware())

  bot.command("settings", ctx => ctx.scene.enter(settingsScene.id))

  bot.command("role_play", ctx => {
    if (ctx.chat.type !== "private")
      return ctx.reply(oneLine`
        For now I can only do role plays in private chats, sorry. 🙏
      `)
    
    return ctx.scene.enter(rolePlayScene.id)
  })

  bot.command("feedback", ctx => ctx.scene.enter(feedbackScene.id))
  bot.command("email", ctx => ctx.scene.enter(emailScene.id))
  bot.command("buy_credits", ctx => ctx.scene.enter(buyCreditsScene.id))

  bot.command(["stop", "done"], async ctx => {
    await bot.telegram.deleteMyCommands(
      { scope: { type: "chat", chat_id: ctx.chat!.id } }
    )

    await ctx.scene.leave().catch(() => {})
  })

  console.log("Bot scenes set up.")
}
