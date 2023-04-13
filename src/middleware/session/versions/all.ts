import type { Union2Tuple, FixedLengthArray } from "../../../utils.ts"
import type { LastArrayElement, Simplify } from "npm:type-fest@3.6.1"
import { sessions as sessionsV1 } from "./v1.ts"
import { sessions as sessionsV2 } from "./v2.ts"

export const sessionVersions = [
  sessionsV1,
  sessionsV2,
] as const

export type AllSessions = typeof sessionVersions[number]
export type AllNextSessions = Exclude<AllSessions, typeof sessionVersions[0]>
export type NextSessions = Readonly<
  Union2Tuple<AllNextSessions> extends [never]
  ? FixedLengthArray<AllSessions, 0>
  : Union2Tuple<AllNextSessions>
>

export type LatestSessions = Simplify<LastArrayElement<typeof sessionVersions>>

export type LatestSession = ReturnType<LatestSessions["session"]>

export type SceneSessionData = LatestSession["__scenes"]

export const latestSessions = sessionVersions.at(-1) as LatestSessions
