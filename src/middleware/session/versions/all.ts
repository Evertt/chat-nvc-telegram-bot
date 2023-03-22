import type { Union2Tuple, FixedLengthArray } from "../../../utils.ts"
import type { LastArrayElement } from "npm:type-fest@3.6.1"
import { Session as SessionV1 } from "./v1.ts"
import { Session as SessionV2 } from "./v2.ts"
import { Session as SessionV3 } from "./v3.ts"

export const sessionVersions = [
  () => new SessionV1(),
  () => new SessionV2(),
  () => new SessionV3(),
] as const

export type Session = ReturnType<typeof sessionVersions[number]>
export type NextSession = Exclude<Session, ReturnType<typeof sessionVersions[0]>>
export type NextSessions = Readonly<
  Union2Tuple<NextSession> extends [never]
  ? FixedLengthArray<Session, 0>
  : Union2Tuple<NextSession>
>

export type LatestSession = ReturnType<LastArrayElement<typeof sessionVersions>>

export const newLatestSession = sessionVersions.at(-1) as () => LatestSession

export type SceneSessionData = LatestSession["__scenes"]