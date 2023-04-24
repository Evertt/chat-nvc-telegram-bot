// import { type Context } from "npm:telegraf@4.12.3-canary.1"
// import type { Class } from "npm:type-fest@3.6.1"

type Concat<T extends unknown[], U extends unknown[]> = [...T, ...U]

type NumericTuple<N extends number, R extends number[] = []> =
  R['length'] extends N ? R : NumericTuple<N, Concat<[0], R>>

type Increment<TupleT extends unknown[]> = Concat<TupleT, [0]>['length']

type AddOne<N extends number> = Increment<NumericTuple<N>> extends infer L
  ? L extends number ? L : never : never

type Pop<T extends unknown[]> = T extends [...infer U, unknown] ? U : never

type Decrement<TupleT extends unknown[]> = Pop<TupleT>['length']

type SubtractOne<N extends number> = Decrement<NumericTuple<N>> extends infer L
  ? L extends number ? L : never : never
type WithVersion<Version extends number> =
  { readonly version: Version }

export type NewSession<PrevSession extends WithVersion<number> = WithVersion<0>> =
  PrevSession extends WithVersion<infer V>
    ? V extends 0
      ? WithVersion<AddOne<V>>
      : WithVersion<AddOne<V>> & {
        migrate(prevSession: NewSession<WithVersion<SubtractOne<V>>>): NewSession<WithVersion<V>>
      }
    : never
