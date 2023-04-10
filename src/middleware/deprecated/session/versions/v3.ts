import { Scenes } from "npm:telegraf@4.12.2"
import type { NewSession } from "../new-session.ts"
import { Message, Session as PrevSession } from "./v2.ts"
// @deno-types="npm:@types/lodash-es@4.17.6"
import { findLastIndex } from "npm:lodash-es@4.17.21"

export type MetaData = {
  haveSpokenBefore: boolean
}

export type Settings = {
  receiveVoiceTranscriptions: boolean
  askForDonation?: boolean
  storeMessagesInGroups?: boolean
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

  get messagesFromLastCheckpoint() {
    const i = findLastIndex(this.messages, message => !!message.checkpoint)
    return this.messages.slice(Math.max(i, 0))
  }

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
