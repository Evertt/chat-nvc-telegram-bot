// // deno-lint-ignore-file no-explicit-any
// import {
//   Session,
//   NextSessions,
//   LatestSession,
//   sessionVersions,
// } from "../session/versions/all.ts"
// import type { ContextWithMultiSession } from "../session/session.ts"

// export const migrate = (session: Session): LatestSession => {
//   if (session.constructor.name === "Object") {
//     const version = session.version || 1
//     const newSession = sessionVersions[version - 1]()
//     session = Object.assign(newSession, session)
//   }

//   const versions = sessionVersions.map(v => v())
//   const i = versions.findIndex(
//     version => version instanceof session.constructor
//   )

//   if (i === -1) {
//     throw new Error('Session version not found')
//   }

//   if (i === sessionVersions.length - 1) {
//     return session as LatestSession
//   }

//   const nextVersions = versions.slice(i + 1) as unknown as NextSessions

//   return nextVersions.reduce((prevVersion, nextVersion) => {
//     return (nextVersion as any).migrate(prevVersion)
//   }, session) as LatestSession
// }

// export const migrateSessionMiddleware = (ctx: ContextWithMultiSession, next: () => Promise<void>) => {
//   if (ctx.session) {
//     ctx.session = migrate(ctx.session)
//   }

//   return next()
// }