import { MenuAction, type CurrentCtx } from "./types.ts"
import { initStartMenu } from "./start.ts"
import { RadioMenu, KeyboardButton, MenuFilters } from "npm:telegraf-menu@1.7.2"

export enum Voice {
  FEMALE = "female",
  MALE = "male",
  NONE = "none",
}

const VOICE_FILTERS: MenuFilters<Voice> = [
  new KeyboardButton(Voice.NONE, Voice.NONE, true),
  new KeyboardButton(Voice.FEMALE, Voice.FEMALE),
  new KeyboardButton(Voice.MALE, Voice.MALE),
]

export const initVoiceMenu = (ctx: CurrentCtx) => {
  new RadioMenu<CurrentCtx, Voice>(
      {
          action: MenuAction.VOICE,
          message: "Select with which voice you want me to talk to you?",
          submitMessage: "Submit voice preference",
          filters: VOICE_FILTERS,
          state: ctx.userSession.settings.voice,
          replaceable: true,
          debug: true,
          menuGetter: (menuCtx) => menuCtx.session.keyboardMenu,
          menuSetter: (menuCtx, menu) => menuCtx.session.keyboardMenu = menu,
          beforeChange(changeCtx, voice) {
            changeCtx.userSession.settings.voice = voice
          },
          onSubmit(submitCtx) {
            initStartMenu(submitCtx);
          },
      },
  ).sendMenu(ctx);
}