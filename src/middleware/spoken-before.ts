// @deno-types="npm:@types/lodash-es@4.17.6"
import { set } from "npm:lodash-es@4.17.21"
import { type ContextWithSession } from "./session/session.ts"

export const rememberWeHaveSpokenBeforeMiddleware = async (ctx: ContextWithSession, next: () => Promise<void>) => {
	await next()
	set(ctx.session, "metaData.haveSpokenBefore", true)
}
