import { oneLine } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

export const OPENAI_OVERLOADED_MESSAGE = oneLine`
  Something went wrong. It's possible that OpenAI's servers are overloaded.
  Please try again in a few seconds or minutes. 🙏
`

export default {
  OPENAI_OVERLOADED: OPENAI_OVERLOADED_MESSAGE,
}
