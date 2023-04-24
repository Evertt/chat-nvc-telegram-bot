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
    // TODO: figure out why sometimes session.version === 0
    // when it should actually be 4, for example...
    // because this "fix" of setting version to 1
    // with `|| 1` obviously doesn't really fix it.
    // The `: 1` however does serve a purpose.
    // if a session does not contain a version property,
    // then it is definitely from a time when I didn't use versioning yet.
    // And therefor it's pretty much guaranteed that it's the first version.
    const version = "version" in session ? (session.version as number || 1) : 1
    const newSession = sessionVersions[version - 1][key](ctx)
    session = Object.assign(newSession, session)

    // Some sessions have a restore method that needs to be called
    // because Object.assign may have corrupted their class instance.
    if ("restore" in session && typeof session.restore === "function") {
      session.restore()
    }
  }

  const versions = sessionVersions.map(v => v[key](ctx))
  const i = versions.findIndex(
    version => version instanceof session.constructor
  )

  if (i === -1) {
    console.error("Session version not found", session)
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
