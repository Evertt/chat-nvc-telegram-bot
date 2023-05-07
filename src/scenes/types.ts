import type { MyContext } from "../context.ts"
import type { Modify } from "../utils.ts"
import type { WELCOME_SCENE_ID } from "../constants.ts"

export interface PiggyBank {
  id: number,
  credits: number,
  donors: string[],
  given_to: number | null,
}

type Session = MyContext["session"]

export type WelcomeSceneSession = Modify<Session, {
  __scenes: Modify<Session["__scenes"], {
    state?: {
      leavingIntentionally?: boolean
      waitingForPiggyBank?: number
      termsMessageId?: number
      writingFeedback?: boolean
      haveSentVoiceMessage?: boolean
    }
    current: typeof WELCOME_SCENE_ID
  }>,
}>
