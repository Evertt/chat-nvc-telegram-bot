import "https://deno.land/std@0.179.0/dotenv/load.ts"
import type { TranscriptionService } from "./index.ts"
import type { credits } from "../../types.ts"
import ffmpeg from "npm:fluent-ffmpeg@2.1.2"
import { Writable } from "node:stream"
import { Buffer } from "node:buffer"
import { logPerformance } from "../../utils.ts"
import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"
import { CREDITS_PER_USD } from "../../constants.ts"

const { OPENAI_KEY } = Deno.env.toObject()

export class Whisper implements TranscriptionService {
  // @see: https://openai.com/pricing
  getCostForDuration(seconds: number): credits {
    const usdPerSecond = 1e-4
    const usd = seconds * usdPerSecond
    const credits = usd * CREDITS_PER_USD
    return Math.ceil(credits) as credits
  }

  async getTranscription(voiceLink: URL) {
    const randomFilename = Math.random().toString(36).substring(2)
    const filePath = `${randomFilename}.webm`
  
    const voiceFileBuffer = await logPerformance(
      "Downloaded voice file",
      () => fetch(voiceLink).then(r => r.arrayBuffer())
    )
  
    const voiceWebmBlob = await logPerformance(
      "Converted voice file",
      () => this.convertOggOpusToWebm(voiceFileBuffer)
    )

    return logPerformance("Transcribed voice file", async () => {
      const formData = new FormData()
      formData.append("model", "whisper-1")
      formData.append("prompt", "ChatNVC")
      formData.append("response_format", "text")
      formData.append("file", voiceWebmBlob, filePath)
    
      const transcriptionResponse = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          headers: {
            Authorization: `Bearer ${OPENAI_KEY}`,
          },
          method: "POST",
          body: formData
        }
      )

      if (!transcriptionResponse.ok) {
        throw new Error(oneLine`
          Failed to transcribe voice message:
          ${await transcriptionResponse.text()}
        `)
      }

      return transcriptionResponse
        .text().then(text => text.trim())
    })
  }

  private async convertOggOpusToWebm(opusAudioData: Buffer | ArrayBuffer) {
    const buffer = opusAudioData instanceof Buffer
      ? opusAudioData : Buffer.from(opusAudioData)
  
    const chunks: BlobPart[] = []
  
    const filename = await Deno.makeTempFile({ suffix: '.ogg' })
    await Deno.writeFile(filename, buffer)
  
    const writable = new Writable({
      write(chunk, _, callback) {
        chunks.push(chunk)
        callback()
      }
    })
  
    // I'm choosing webm, because I've read that the webm container
    // can actually contain opus audio, so I'm hoping that ffmpeg
    // will just copy the opus audio into the webm container.
    // Because that would be the fastest way to convert the file.
    return new Promise<Blob>((resolve, reject) => {
      ffmpeg(filename)
        .format('webm')
        .noVideo()
        .withAudioCodec('copy')
        .on('end', function (err: Error) {
          if (!err) {
            console.log('audio conversion Done')
  
            resolve(new Blob(chunks, { type: 'audio/webm' }))
          } else {
            console.log('audio conversion error:', err)
            reject(err)
          }
        })
        .on('error', function (err: Error) {
          console.log('audio conversion error:', err)
          reject(err)
        })
        .output(writable)
        .run()
    })
    .finally(() => {
      Deno.remove(filename)
    })
  }
}
