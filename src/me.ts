import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { Telegram } from "npm:telegraf@4.12.3-canary.1"

const { TELEGRAM_KEY } = Deno.env.toObject()
const telegram = new Telegram(TELEGRAM_KEY)
export const me = await telegram.getMe()
