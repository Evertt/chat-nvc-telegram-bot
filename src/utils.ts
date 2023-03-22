// deno-lint-ignore-file
import type { ConditionalExcept } from "npm:type-fest@3.6.1"

export type Modify<T, K> = Omit<T, keyof K> & ConditionalExcept<K, undefined>

export const sleep = (ms: number) => new Promise<void>(
	resolve => setTimeout(resolve, ms)
)

export const repeat = (fn: () => Promise<unknown>, ms: number) => {
	let stop = false

	const innerFn = async () => {
		while (!stop) {
			await fn()
			await sleep(ms)
		}
	}

	innerFn()

	return () => stop = true
}

type Contra<T> =
  T extends any 
		? (arg: T) => void 
		: never

type Cov<T> = 
  T extends any 
		? () => T
		: never

type InferCov<T> = 
  [T] extends [() => infer I]
		? I
		: never

type InferContra<T> = 
  [T] extends [(arg: infer I) => void] 
		? I
		: never

type PickOne<T> = InferContra<InferContra<Contra<Contra<T>>>>

export type Union2Tuple<T> =
    PickOne<T> extends infer U                  // assign PickOne<T> to U
    ? Exclude<T, U> extends never               // T and U are the same
        ? [T]
        : [...Union2Tuple<Exclude<T, U>>, U]    // recursion
    : never

type ArrayLengthMutationKeys = 'splice' | 'push' | 'pop' | 'shift' |  'unshift'
export type FixedLengthArray<T, L extends number, TObj = [T, ...Array<T>]> =
  Pick<TObj, Exclude<keyof TObj, ArrayLengthMutationKeys>>
  & {
    readonly length: L 
    [ I : number ] : T
    [Symbol.iterator]: () => IterableIterator<T>   
  }
