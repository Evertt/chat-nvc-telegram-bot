import GPT3TokenizerImport from 'npm:gpt3-tokenizer@1.1.5'

interface GPT3Tokenizer {
	encode(text: string): {
		bpe: number[]
		text: string[]
	}
}

interface GPT3TokenizerClass {
	new (options: { type: 'gpt3' }): GPT3Tokenizer
}

const gpt3TokenizerClass: GPT3TokenizerClass =
	typeof GPT3TokenizerImport === 'function'
		? GPT3TokenizerImport
		: GPT3TokenizerImport.default

const tokenizer = new gpt3TokenizerClass({ type: 'gpt3' })

export function getTokens(input?: string): number {
	if (!input) return 0
	const tokens = tokenizer.encode(input)
	return tokens.text.length
}
