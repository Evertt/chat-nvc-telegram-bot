import { type ContextWithMultiSession } from "./session/session.ts"

export const rememberWeHaveSpokenBeforeMiddleware = async (ctx: ContextWithMultiSession, next: () => Promise<void>) => {
	await next()
	if (!ctx.from || ctx.chat?.type !== "private") return
	if (!ctx.userSession) return
	
	if (!ctx.userSession.haveSpokenBefore) {
		ctx.userSession.totalTokensGifted = 200_000
	}

	ctx.userSession.haveSpokenBefore = true
}
