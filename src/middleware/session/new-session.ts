type Session = {
  readonly version: number
}

export type NewSession<PrevSession extends NewSession | undefined = undefined> =
  PrevSession extends undefined ? Session
  : Session & { migrate(prevSession: PrevSession): NewSession<PrevSession> }
