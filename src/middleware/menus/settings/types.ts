import type { AllMySessions } from "../../session/session.ts"
import type { Modify } from "../../../utils.ts"
import { DefaultCtx, GenericMenu } from "npm:telegraf-menu@1.7.2"

// TODO:
// - [ ] Add a menu for the user to select their preferred voice

export enum MenuAction {
  VOICE = 'voice',
  START = 'start',
}

export type CurrentCtx = DefaultCtx & Modify<AllMySessions, {
  session: AllMySessions["session"] & {
    keyboardMenu: GenericMenu<CurrentCtx>,
  },
}>

