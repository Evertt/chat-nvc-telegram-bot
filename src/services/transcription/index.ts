import type { credits } from "../../types.ts"

export interface TranscriptionService {
  getTranscription(voiceLink: URL): Promise<string>
  getCostForDuration(seconds: number): credits
}

export * from "./whisper.ts"
