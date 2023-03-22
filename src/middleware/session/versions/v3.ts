import { Scenes } from "npm:telegraf@4.12.2"
import type { NewSession } from "../new-session.ts"
import { Message, Session as PrevSession } from "./v2.ts";

export type MetaData = {
  haveSpokenBefore: boolean
}

export type Settings = {
  receiveVoiceTranscriptions: boolean
}

type MySceneSessionData = Scenes.SceneSessionData & {
  settingsMessageId?: number
}

export interface Session extends
  NewSession<PrevSession>,
  Scenes.SceneSession<MySceneSessionData>
  { }

export class Session implements Session {
  readonly version = 3

  messages: Message[] = []

  settings: Settings = {
    receiveVoiceTranscriptions: false
  }

  metaData: MetaData = {
    haveSpokenBefore: false
  }

  __scenes: MySceneSessionData = {
    current: undefined,
    expires: undefined,
    state: undefined,
    settingsMessageId: undefined,
  }

  migrate(prevSession: PrevSession) {
    this.messages = prevSession.messages

    return this
  }
}
