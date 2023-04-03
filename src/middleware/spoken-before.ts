import { type ContextWithMultiSession } from "./session/session.ts"

export const rememberWeHaveSpokenBeforeMiddleware = async (ctx: ContextWithMultiSession, next: () => Promise<void>) => {
	await next()
	if (!ctx.from || ctx.chat?.type !== "private") return
	if (!ctx.userSession) return
	ctx.userSession.haveSpokenBefore = true
}
