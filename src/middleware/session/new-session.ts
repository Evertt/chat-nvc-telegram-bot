type Concat<T extends unknown[], U extends unknown[]> = [...T, ...U]

type NumericTuple<N extends number, R extends number[] = []> =
  R['length'] extends N ? R : NumericTuple<N, Concat<[0], R>>

type Increment<TupleT extends unknown[]> = Concat<TupleT, [0]>['length']

type AddOne<N extends number> = Increment<NumericTuple<N>> extends infer L
  ? L extends number ? L : never : never
type Session<Version extends number> =
  { readonly version: Version }

export type NewSession<PrevSession extends NewSession | undefined = undefined> =
  PrevSession extends undefined
    ? Session<1>
    : PrevSession extends Session<infer PrevVersion>
      ? Session<AddOne<PrevVersion>> &
        {
          migrate(prevSession: PrevSession): NewSession<PrevSession>
        }
      : never
