import type { Prisma } from "../../generated/prisma/client"

/** 无 Auth 阶段的匿名租户 ID；接入 session 后从此处解析真实 userId */
export const DEFAULT_USER_ID = "default_user_id"

/**
 * 解析当前请求所属用户 ID。
 * TODO: 接入 Auth 后从 session / JWT 读取。
 */
export function resolveUserId(): string {
  return DEFAULT_USER_ID
}

/** 会话列表/详情查询：兼容历史数据中 userId 为 null 的行 */
export function conversationOwnerWhere(userId: string): Prisma.ConversationWhereInput {
  if (userId === DEFAULT_USER_ID) {
    return { OR: [{ userId }, { userId: null }] }
  }
  return { userId }
}
