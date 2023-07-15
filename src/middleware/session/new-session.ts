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
export type WithVersion<Version extends number> =
  { readonly version: Version }

// type WithVersionClass<WV extends WithVersion<number>, UsesCtx extends boolean> =
//   UsesCtx extends false
//     ? Class<WV, []>
//     : Class<WV, [Context]>

// export type NextVersion<WV extends WithVersion<number>> =
//   WV extends WithVersion<infer V>
//     ? V extends number
//       ? Omit<WV, "version"> & WithVersion<AddOne<V>>
//       : never
//     : never

// type NextVersionClass<WVC extends WithVersionClass<WithVersion<number>, boolean>,
// > = WVC extends WithVersionClass<infer WV, infer UsesCtx>
//     ? WithVersionClass<NextVersion<WV>, UsesCtx>
//     : never

// export function New<
//   NS extends NewSession<WithVersion<number>>,
//   UsesCtx extends boolean,
//   NSC extends WithVersionClass<NS, UsesCtx> = WithVersionClass<NS, UsesCtx>,
//   WVC extends WithVersionClass<WithVersion<number>, UsesCtx> = WithVersionClass<WithVersion<number>, UsesCtx>,
// >(wvc: WVC): NSC {
//   return wvc as unknown as NSC
// }

export type NewSession<PrevSession extends WithVersion<number> = WithVersion<0>> =
  PrevSession extends WithVersion<infer V>
    ? V extends 0
      ? WithVersion<AddOne<V>>
      : WithVersion<AddOne<V>> & {
        migrate(prevSession: NewSession<WithVersion<SubtractOne<V>>>): NewSession<WithVersion<V>>
      }
    : never
