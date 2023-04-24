import ffmpeg from 'npm:fluent-ffmpeg@2.1.2'
import { Writable } from "node:stream"
import { Buffer } from "node:buffer"
import { roundToSeconds } from "./utils.ts";

export const convertOggOpusToWebm = async (opusAudioData: Buffer | ArrayBuffer) => {
  const buffer = opusAudioData instanceof Buffer
    ? opusAudioData : Buffer.from(opusAudioData)

  const chunks: BlobPart[] = []

  const filename = await Deno.makeTempFile({ suffix: '.ogg' })
  const writeVoiceFileStart = performance.now()
  await Deno.writeFile(filename, buffer)
  const writeVoiceFileEnd = performance.now()
  console.log(`Wrote voice file in ${roundToSeconds(writeVoiceFileEnd - writeVoiceFileStart)} seconds`)

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
  // But still this takes a very long time on Google Cloud Run.
  // I'm not sure if it's because of the ffmpeg library, or because
  // or that the cpu I get access to on Google Cloud Run is just slow.
  // On my Macbook Pro this file conversion is actually not slow at all.
  return new Promise<Blob>((resolve, reject) => {
    ffmpeg(filename)
			.format('webm')
			.noVideo()
      .withAudioCodec('copy')
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
