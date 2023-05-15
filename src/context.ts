import type { ContextWithScene } from "./scenes/add-all-to-bot.ts"

// I could still change it here, but for now the type is good enough
export type MyContext = ContextWithScene
export type ChatSession = MyContext["chatSession"]
export type Message = ChatSession["messages"][number]
export type NamedMessage = ChatSession["messagesFromLastCheckpoint"][number]
export type SubMessage = Parameters<ChatSession["addMessage"]>[0]
export type GroupMembers = ChatSession["groupMembers"]
