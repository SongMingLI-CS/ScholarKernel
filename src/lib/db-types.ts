import type { Message as PrismaMessage } from "../../generated/prisma/client"

import type { ChatMessage, RuntimeKeys, ThemeMode } from "@/store/useAgentStore"

/** Sidebar list item — no messages payload (JSON dates are ISO strings) */
export type ConversationSummary = {
  id: string
  title: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

/** Full conversation with messages for chat panel hydration */
export type ConversationDetail = ConversationSummary & {
  messages: Array<Omit<PrismaMessage, "createdAt"> & { createdAt: string }>
}

export type SettingsResponse = {
  userId: string
  theme: ThemeMode
  runtimeKeys: RuntimeKeys | null
  updatedAt: string
}

export type SettingsPatchBody = {
  theme?: ThemeMode
  runtimeKeys?: Partial<RuntimeKeys> | null
}

export type ConversationPatchBody = {
  title?: string
  isPinned?: boolean
}

export type CreateMessageBody = {
  id?: string
  role: ChatMessage["role"]
  content: string
}

export function prismaMessageToChat(m: { id: string; role: string; content: string }): ChatMessage {
  return {
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
  }
}

export function chatMessageToCreateBody(m: ChatMessage): CreateMessageBody {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
  }
}
