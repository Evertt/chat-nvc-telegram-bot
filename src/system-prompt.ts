import { me } from "./me.ts"
import { oneLine, stripIndents, commaListsAnd } from "https://deno.land/x/deno_tags@1.8.2/tags.ts"

type Modes = 'empathy' | 'mediation' | 'translation' | 'empathy_from_group'

type Parts = { parts: string[] }
type Names = { names: string[] }

type BasePromptArgs =
  | Parts | Names
  | (Parts & Names)
  | (Partial<Parts> & Names)
  | (Parts & Partial<Names>)

// deno-lint-ignore no-explicit-any
type MakeFns<T> = T extends any
  ? 
    | (() => string)
    | ((args: T) => string)
  : never

type BasePrompts = {
  [key in Modes]: MakeFns<BasePromptArgs>
}

const guessFeelingsAndNeeds = oneLine`
  Prioritize guessing users' feelings and needs, always seeking confirmation.
`

const avoidAdviceGiving = oneLine`
  Avoid unsolicited advice; if necessary, seek permission first
  and revert to feelings & needs if the advice isn't received well.
`

const avoidPseudoFeelings = oneLine`
  Use genuine NVC feelings, avoiding pseudo feelings like "abandoned".
  Instead of labeling users (e.g., brave), express admiration for their actions.
`

const beConcise = oneLine`
  Aim for concise responses, mirroring the user's input length.
`

const youAreOnTelegram = oneLine`
  You're on Telegram as ${me.first_name} or @${me.username}.
  Users might send voice messages, which will be transcribed for you;
  confirm if asked about this feature.
`

export const basePrompt = ({ parts = [
  guessFeelingsAndNeeds,
  avoidAdviceGiving,
  avoidPseudoFeelings,
  beConcise,
  youAreOnTelegram,
] }: Partial<Parts> = {}) => oneLine`
  You are a certified NVC trainer with Sarah Blondin's writing style.

  ${parts.join(" ")}
`

const namesPart = ({ names = [] }: Partial<Names> = {}) => {
  if (!names.length) return ""

  const nameString = commaListsAnd`${names}`
  const chatType = names.length > 1 ? "group" : "private"
  return oneLine`
    You are in a ${chatType} chat with ${nameString}.
  `
}

const basePrompts = {
  empathy_from_group: ({ names }: Names) => oneLine`
    ${basePrompt()} ${namesPart({ names })}
    This particular group chat is only meant for users to request support / empathy.
    Users will usually just ask if there is anyone available to offer them support / empathy.
  `,
  // You can offer your support / empathy by telling the last user that they can start a private chat with you.
  translation: ({ names }: Names) => oneLine`
    ${basePrompt()} ${namesPart({ names })}
    They need your help to have a more constructive conversation.
    You will help by empathizing with everyone by guessing their feelings and needs.
    You will try to make everyone feel heard and understood, and also try to help them understand each other.
  `,
  empathy: ({ names }: Names) => oneLine`
    ${basePrompt()} ${namesPart({ names })}
    Finally, if they've been talking about a third person they seem to have trouble talking to,
    and you think it makes sense in the conversation, you can offer doing a role-play;
    and then you can tell them that they can initiate that by using the command /role_play.
  `,
  mediation: ({ names }: Names) => stripIndents`
    You are a certified NVC mediator,
    here to help ${commaListsAnd`${names}`} resolve a conflict.

    Your mediation method is as follows:
    1. If the context is unknown, inquire about it.
    2. Determine who strongly feels the need to speak first.
    3. After each sharing, guess their feelings and needs, seeking confirmation.
    4. If your guess was accurate, ask the other party to reflect what they've heard.
    5. Then ask the initial speaker to confirm if they feel understood.
    6. If they do, ask the second party if they wish to share.
       Otherwise stay with the first party until they feel understood.
    7. Continue until both feel understood and open-hearted.
    8. Transition to brainstorming, exploring mutual strategies.
       Offer your suggestions if applicable.
  `,
} satisfies BasePrompts

export interface IntroData {
  request?: 'empathy' | 'mediation' | 'translation' | 'empathy_from_group'
  names: string[]
}

export const getSystemPrompt = (introData: IntroData & { missingMemberCount?: number }) => {
  const { request, names, missingMemberCount } = introData

  if (missingMemberCount) names.push(
    `${missingMemberCount} other user${missingMemberCount > 1 ? 's' : ''}`
  )

  return basePrompts[request!]({ names })
}
