import { encode } from "npm:gpt-3-encoder@1.1.4"

export function getTokens(input?: string | null): number {
	return encode(input || "").length
}

export const MAX_TOKENS = 4096
export const TOKENS_LEFT_FOR_SUMMARY = MAX_TOKENS / 8
export const MAX_PROMPT_TOKENS = MAX_TOKENS - TOKENS_LEFT_FOR_SUMMARY
