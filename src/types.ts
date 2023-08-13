import type { Buffer } from "node:buffer"
import type { Opaque } from "npm:type-fest@3.6.1"

export type credits = Opaque<number, "credits">
export type OpusBuffer = Opaque<Buffer, "Opus">