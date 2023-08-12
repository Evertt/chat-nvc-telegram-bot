import { MenuAction, type CurrentCtx } from "./types.ts"
import { initVoiceMenu } from "./voices.ts";
import { RegularMenu, KeyboardButton, MenuFilters } from "npm:telegraf-menu@1.7.2"

const START_MENU_FILTERS: MenuFilters<MenuAction>[] = [
  [
    new KeyboardButton('voice', MenuAction.VOICE),
  ],
]

export const initStartMenu = (ctx: CurrentCtx) => {
  new RegularMenu<CurrentCtx, MenuAction>(
    {
      action: MenuAction.START,
      message: 'Start',
      filters: START_MENU_FILTERS,
      replaceable: true,
      debug: true,
      menuGetter: (menuCtx) => menuCtx.session.keyboardMenu,
      menuSetter: (menuCtx, menu) => menuCtx.session.keyboardMenu = menu,
      onChange(changeCtx, state) {
        switch (state) {
          case MenuAction.VOICE:
            return initVoiceMenu(changeCtx)
        }
      },
    },
    ).sendMenu(ctx);
  };