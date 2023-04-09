import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { convertOggOpusToWebm } from "./audio-converter.ts"
import { roundToSeconds } from "./utils.ts"

const { OPENAI_KEY } = Deno.env.toObject()

export async function getTranscription(voiceLink: URL) {
  const randomFilename = Math.random().toString(36).substring(2)
  const filePath = `${randomFilename}.mp3`

  const downloadStart = performance.now()
  const voiceRespFile = await fetch(voiceLink)
  const downloadEnd = performance.now()
  console.log(`Downloaded voice file in ${roundToSeconds(downloadEnd - downloadStart)} seconds`)

  const convertStart = performance.now()
  const voiceOggBuffer = await voiceRespFile.arrayBuffer()
  const voiceWebmBlob = await convertOggOpusToWebm(voiceOggBuffer)
  const convertEnd = performance.now()
  console.log(`Converted voice file in ${roundToSeconds(convertEnd - convertStart)} seconds`)

  const transcriptionStart = performance.now()
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
  const transcriptionEnd = performance.now()
  console.log(`Transcribed voice file in ${roundToSeconds(transcriptionEnd - transcriptionStart)} seconds`)

  return transcriptionResponse.text()
}