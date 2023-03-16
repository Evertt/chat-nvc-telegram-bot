import { detectPlatform } from "npm:ffbinaries@1.1.2"

export default async () => {
  const version = '4.4.1'
  const platform = detectPlatform()
  const components = ['ffmpeg', 'ffprobe']
  const pwd = new URL('.', import.meta.url).pathname

  const unzip = (filename: string) => Deno.run({
    cmd: ['unzip', filename],
    stdout: 'piped',
    stderr: 'piped',
  }).status()

  for (const component of components) {
    const stat = await Deno.stat(component).catch(() => null)
    if (stat?.isFile) continue

    const url = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${version}/${component}-${version}-${platform}.zip`
    const response = await fetch(url)
  
    const filename = `${pwd}${component}.zip`
    await Deno.writeFile(filename, response.body!)
    await unzip(filename)
    await Deno.remove(filename)
  }

  return components.map(component => `${pwd}${component}`)
}
