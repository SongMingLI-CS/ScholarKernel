import type { Prisma } from "../../generated/prisma/client"

import {
  isAuthEnabled,
  resolveSessionUserIdFromRequest,
} from "@/lib/session-auth"

/** 无 Auth 阶段的匿名租户 ID；历史会话可能为 null userId */
export const DEFAULT_USER_ID = "default_user_id"

/**
 * @deprecated 请改用 resolveUserIdFromRequest(req)。仅在 Auth 未启用时用于兼容。
 */
export function resolveUserId(): string {
  return DEFAULT_USER_ID
}

/** 从请求 session 解析用户；Auth 未启用时返回 DEFAULT_USER_ID */
export function resolveUserIdFromRequest(req: Request): string | null {
  if (!isAuthEnabled()) return DEFAULT_USER_ID
  return resolveSessionUserIdFromRequest(req)
}

/** 会话列表/详情查询：兼容历史数据中 userId 为 null 的行 */
export function conversationOwnerWhere(userId: string): Prisma.ConversationWhereInput {
  if (userId === DEFAULT_USER_ID) {
    return { OR: [{ userId }, { userId: null }] }
  }
  return { userId }
}
