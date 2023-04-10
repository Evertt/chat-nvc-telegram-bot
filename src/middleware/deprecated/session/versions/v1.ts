import type { NewSession } from "../new-session.ts"

export type Message = {
	name: string
	message: string
	timestamp: number
	type: "text" | "voice"
}

export class Session implements NewSession {
	readonly version = 1
  messages: Message[] = []
}
