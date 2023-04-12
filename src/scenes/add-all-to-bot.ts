// deno-lint-ignore-file no-explicit-any
import { Telegraf, Scenes } from "npm:telegraf@4.12.3-canary.1"
import { type MyContext } from "../bot.ts"
import { settingsScene } from "./settings.ts"
import { rolePlayScene } from "./role-play.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

export const addScenesToBot = (bot: Telegraf<MyContext>) => {
  console.log("Setting up bot scenes...")

  const stage = new Scenes.Stage<MyContext>(
    [
      settingsScene,
      rolePlayScene as any,
    ],
    {
      ttl: 3600, // 1 hour
    }
  )
  
  bot.use(stage.middleware())

  bot.command("settings", ctx => ctx.scene.enter(settingsScene.id))

  bot.command("role_play", ctx => {
    if (ctx.chat.type !== "private")
      return ctx.reply(oneLine`
        For now I can only do role plays in private chats, sorry. 🙏
      `)
    
    return ctx.scene.enter(rolePlayScene.id)
  })

  bot.command("stop_role_play", async ctx => {
    await bot.telegram.deleteMyCommands(
      { scope: { type: "chat", chat_id: ctx.chat!.id } }
    )

    await ctx.scene.leave()
  })

  console.log("Bot scenes set up.")
}
