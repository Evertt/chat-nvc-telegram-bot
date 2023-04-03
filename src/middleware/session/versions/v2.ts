// @deno-types="npm:@types/lodash-es@4.17.6"
import { omit } from "npm:lodash-es@4.17.21"
import { Modify } from "../../../utils.ts"
import type { NewSession } from "../new-session.ts"
import { Message as PrevMessage, Session as PrevSession } from "./v1.ts";

export type Message = Modify<PrevMessage, {
  timestamp: never
  date: string
  checkpoint?: boolean
}>

export class Session implements NewSession<PrevSession> {
  readonly version = 2
  messages: Message[] = []

  migrate(prevSession: PrevSession) {
    this.messages = prevSession.messages.map(message => ({
      ...omit(message, 'timestamp'),
      date: new Date(message.timestamp).toString()
    }))

    return this
  }
}
