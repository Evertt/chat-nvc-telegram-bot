import "https://deno.land/std@0.179.0/dotenv/load.ts"
import { convertOggOpusToWebm } from "./audio-converter.ts"

const { OPENAI_KEY } = Deno.env.toObject()

export async function getTranscription(voiceLink: URL) {
  const randomFilename = Math.random().toString(36).substring(2)
  const filePath = `${randomFilename}.webm`

  const voiceRespFile = await fetch(voiceLink)
  const voiceOggBuffer = await voiceRespFile.arrayBuffer()
  const voiceWebmBlob = await convertOggOpusToWebm(voiceOggBuffer)

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

  return transcriptionResponse.text()
}