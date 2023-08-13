import type { credits, OpusBuffer } from "../../types.ts"

export interface TextToSpeechService {
  convertToSpeech(text: string, voice?: string): Promise<OpusBuffer>
  getCost(characters: number): credits
}

export * from "./eleven-labs.ts"
