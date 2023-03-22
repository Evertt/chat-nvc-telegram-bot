import { Telegraf, Scenes } from "npm:telegraf@4.12.2"
import { type MyContext } from "../bot.ts"
import { settingsScene } from "./settings.ts"

export const addScenesToBot = (bot: Telegraf<MyContext>) => {
  console.log("Setting up bot scenes...")

  const stage = new Scenes.Stage<MyContext>(
    [settingsScene],
    { ttl: 100000 },
  )
  
  bot.use(stage.middleware())
  console.log("Bot scenes set up.")
}
