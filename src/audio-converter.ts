import ffmpeg from 'npm:fluent-ffmpeg@2.1.2'
import { Writable } from "node:stream"
import { Buffer } from "node:buffer"

export const convertOggOpusToWebm = async (opusAudioData: Buffer | ArrayBuffer) => {
  const buffer = opusAudioData instanceof Buffer
    ? opusAudioData : Buffer.from(opusAudioData)

  const chunks: BlobPart[] = []

  const filename = await Deno.makeTempFile({ suffix: '.ogg' })
  const writeVoiceFileStart = performance.now()
  await Deno.writeFile(filename, buffer)
  const writeVoiceFileEnd = performance.now()
  console.log(`Wrote voice file in ${writeVoiceFileEnd - writeVoiceFileStart}ms`)

	const writable = new Writable({
    write(chunk, _, callback) {
      chunks.push(chunk)
      callback()
    }
  })

  return new Promise<Blob>((resolve, reject) => {
    ffmpeg(filename)
			.format('mp3')
			// .noVideo()
      // .withAudioCodec('copy')
      .on('end', function (err: Error) {
        if (!err) {
          console.log('audio conversion Done')

          resolve(new Blob(chunks, { type: 'audio/webm' }))
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
