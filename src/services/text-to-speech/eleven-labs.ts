import type { TextToSpeechService } from "./index.ts"
import type { credits, OpusBuffer } from "../../types.ts"
import { ELEVENLABS_KEY } from "../../constants.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { Buffer } from "node:buffer"
import { Writable, Readable } from "node:stream"
import ffmpeg from "npm:fluent-ffmpeg@2.1.2"
import { CREDITS_PER_USD } from "../../constants.ts"
import { logPerformance } from "../../utils.ts"

const voiceIdMap = {
  "Sarah Blondin": "otQcjLx4cSFCPsPiKFhp",
  "Cara Crisler": "1l9nLjymHqj9JnBwlW83",
}

export class ElevenLabs implements TextToSpeechService {
  getCost(characters: number) {
    const usdPerCharacter = 3e-4
    const usd = characters * usdPerCharacter
    const credits = usd * CREDITS_PER_USD
    return Math.ceil(credits) as credits
  }

  async convertToSpeech(text: string, voice: keyof typeof voiceIdMap = "Cara Crisler") {
    const voiceID = voiceIdMap[voice]
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`

    const mp3ArrayBuffer = await logPerformance(
      "Converted text to speech",
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_KEY
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              style: 0.5,
              stability: 0.5,
              similarity_boost: 0.8,
              use_speaker_boost: true,
              optimize_streaming_latency: 0
            }
          })
        })

        if (!response.ok) {
          throw new Error(oneLine`
            Failed to convert text to speech:
            ${await response.text()}
          `)
        }

        return response.arrayBuffer()
      })

    return logPerformance(
      "Converted mp3 to opus",
      () => this.convertMp3ToOpus(mp3ArrayBuffer)
    )
  }

  private convertMp3ToOpus(mp3ArrayBuffer: ArrayBuffer) {
    const buffer = Buffer.from(mp3ArrayBuffer)
    const readable = Readable.from(buffer)
    const chunks: Buffer[] = []

    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk)
        callback()
      }
    })

    return new Promise<OpusBuffer>((resolve, reject) => {
      const rejectOnError = (error: Error) =>
        reject(new Error(oneLine`
          Failed to convert mp3 to opus:
          ${error.message}
        `))

      ffmpeg(readable)
        .audioCodec("libopus")
        .format("ogg")
        .on("end", (error?: Error) => {
          if (error) return rejectOnError(error)
          resolve(Buffer.concat(chunks) as OpusBuffer)
        })
        .on("error", rejectOnError)
        .output(writable)
        .run()
    })
  }
}
