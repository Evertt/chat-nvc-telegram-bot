// @deno-types="npm:@types/common-tags@1.8.1"
import { oneLine } from "npm:common-tags@1.8.1"

export const OPENAI_OVERLOADED_MESSAGE = oneLine`
  Something went wrong. It's possible that OpenAI's servers are overloaded.
  Please try again in a few seconds or minutes. 🙏
`

export default {
  OPENAI_OVERLOADED: OPENAI_OVERLOADED_MESSAGE,
}
