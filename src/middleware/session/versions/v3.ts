import { Scenes } from "npm:telegraf@4.12.2"
import type { NewSession } from "../new-session.ts"
import { Message, Session as PrevSession } from "./v2.ts";

export type MetaData = {
  haveSpokenBefore: boolean
}

export type Settings = {
  receiveVoiceTranscriptions: boolean
  askForDonation?: boolean
}

type MySceneSessionData = Scenes.SceneSessionData & {
  settingsMessageId?: number
}

type Location = {
  latitude: number
  longitude: number
}

interface SessionV3 extends
  NewSession<PrevSession>,
  Scenes.SceneSession<MySceneSessionData>
  {
    location: Location | undefined
    settings: Settings
  }

export class Session implements SessionV3 {
  readonly version = 3

  messages: Message[] = []

  settings: Settings = {
    receiveVoiceTranscriptions: false,
  }

  metaData: MetaData = {
    haveSpokenBefore: false
  }

  __scenes: MySceneSessionData = {}

  location: Location | undefined

  migrate(prevSession: PrevSession) {
    this.messages = prevSession.messages

    return this
  }
}
