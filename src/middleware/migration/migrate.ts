// deno-lint-ignore-file no-explicit-any
import {
  latestSessions,
  LatestSessions,
  sessionVersions,
} from "../session/versions/all.ts"
import type { ContextWithMultiSession } from "../session/session.ts"

type SessionKey = keyof LatestSessions

export const migrate = <
  Key extends SessionKey = SessionKey,
  Ctx extends ContextWithMultiSession = ContextWithMultiSession
>(key: Key, session: Ctx[Key], ctx: Ctx): Ctx[Key] => {
  if (session.constructor.name === "Object") {
    const version = "version" in session ? session.version as number : 1
    const newSession = sessionVersions[version - 1][key](ctx)
    session = Object.assign(newSession, session)
  }

  const versions = sessionVersions.map(v => v[key](ctx))
  const i = versions.findIndex(
    version => version instanceof session.constructor
  )

  if (i === -1) {
    throw new Error('Session version not found')
  }

  if (i === sessionVersions.length - 1) {
    return session as Ctx[Key]
  }

  const nextVersions = versions.slice(i + 1) // as unknown as NextSessions

  return nextVersions.reduce((prevVersion, nextVersion) => {
    if (nextVersion.constructor.name  === "UserSession")
      console.log('"migrate" in nextVersion', "migrate" in nextVersion)
    return "migrate" in nextVersion ? (nextVersion as any).migrate(prevVersion) : prevVersion
  }, session as any) as Ctx[Key]
}

export const migrateSessionMiddleware = <Ctx extends ContextWithMultiSession>(ctx: Ctx, next: () => Promise<void>) => {
  for (const property in latestSessions) {
    const key = property as keyof LatestSessions
    if (ctx[key]) {
      (ctx[key] as any) = migrate<typeof key>(key, ctx[key], ctx)
    }
  }

  return next()
}
